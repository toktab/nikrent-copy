-- ═══════════════════════════════════════════════════════════════════════════
-- Du formwork editor — initial backend schema
--
-- Single company: every authenticated user shares one catalog, one stock pool
-- and one set of drawings, so there is no tenant column anywhere. Access is
-- controlled by role instead: admin / editor / viewer.
--
-- Safe to re-run: every statement is idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── roles ──────────────────────────────────────────────────────────────────

-- Mirrors auth.users, which we cannot add columns to. Holds the role and the
-- display name.
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  full_name  text not null default '',
  role       text not null default 'viewer' check (role in ('admin', 'editor', 'viewer')),
  created_at timestamptz not null default now()
);

-- A profile must exist for every account or the user has no role and can see
-- nothing. Created by trigger so it cannot be forgotten, and SECURITY DEFINER
-- because the signing-up user has no rights to public.profiles yet.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Reading the caller's role from inside a policy ON profiles would recurse, so
-- this reads it with the owner's rights and stays out of the recursion.
create or replace function public.user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.user_role() = 'admin', false);
$$;

-- Whoever may change drawings. Catalog and stock stay admin-only.
create or replace function public.can_edit()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.user_role() in ('admin', 'editor'), false);
$$;

-- ── catalog ────────────────────────────────────────────────────────────────

create table if not exists public.warehouses (
  id         text primary key,
  name       text not null,
  created_at timestamptz not null default now()
);

-- Ids stay text so the slugs already in the app ('main', built-in material
-- ids) survive the import from localStorage unchanged.
create table if not exists public.materials (
  id         text primary key,
  name       text not null,
  category   text not null check (category in ('panel','waler','corner','post','filler','rod','acc')),
  w          numeric not null check (w > 0),
  h          numeric not null check (h > 0),
  depth      numeric not null check (depth > 0),
  shape      text not null check (shape in ('rect','L','line')),
  color      text not null default '#888888',
  builtin    boolean not null default false,
  price      numeric not null default 0 check (price >= 0),
  weight     numeric not null default 0 check (weight >= 0),
  article    text not null default '',
  supplier   text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── stock ──────────────────────────────────────────────────────────────────

-- Stock is a table, not the JSON blob it was on the client. The old shape made
-- every save an absolute overwrite of the whole map, so two people counting
-- stock at once silently lost one of the counts. Here a quantity is one row,
-- and it may only be changed through the functions below.
create table if not exists public.stock (
  material_id  text not null references public.materials (id) on delete cascade,
  warehouse_id text not null references public.warehouses (id) on delete cascade,
  quantity     integer not null default 0 check (quantity >= 0),
  updated_at   timestamptz not null default now(),
  primary key (material_id, warehouse_id)
);

-- Append-only history of every change. Answers "who moved these and when",
-- which is also what the rental features will need later.
create table if not exists public.stock_movements (
  id           bigint generated always as identity primary key,
  material_id  text not null references public.materials (id) on delete cascade,
  warehouse_id text not null references public.warehouses (id) on delete cascade,
  delta        integer not null,
  reason       text not null default 'adjust',
  note         text not null default '',
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists stock_movements_material_idx
  on public.stock_movements (material_id, created_at desc);

-- Atomic relative change. The upsert and the ledger entry share one
-- transaction, so a concurrent caller can never read a stale quantity and
-- write it back.
create or replace function public.adjust_stock(
  p_material_id  text,
  p_warehouse_id text,
  p_delta        integer,
  p_reason       text default 'adjust',
  p_note         text default ''
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quantity integer;
begin
  if not public.is_admin() then
    raise exception 'only an admin may change stock' using errcode = '42501';
  end if;

  insert into public.stock (material_id, warehouse_id, quantity)
  values (p_material_id, p_warehouse_id, greatest(0, p_delta))
  on conflict (material_id, warehouse_id) do update
    set quantity   = greatest(0, stock.quantity + p_delta),
        updated_at = now()
  returning quantity into v_quantity;

  insert into public.stock_movements (material_id, warehouse_id, delta, reason, note, created_by)
  values (p_material_id, p_warehouse_id, p_delta, p_reason, p_note, auth.uid());

  return v_quantity;
end;
$$;

-- Absolute set, kept because the stocktake UI naturally works that way: you
-- count what is on the shelf and type the number. The delta is derived inside
-- the transaction so the ledger still records the movement rather than a bare
-- overwrite.
create or replace function public.set_stock(
  p_material_id  text,
  p_warehouse_id text,
  p_quantity     integer,
  p_note         text default ''
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current integer;
  v_target  integer := greatest(0, p_quantity);
begin
  if not public.is_admin() then
    raise exception 'only an admin may change stock' using errcode = '42501';
  end if;

  -- Ensure the row exists before locking it. Without this, two first-time
  -- stocktakes of the same material both read "no row", both compute a delta
  -- equal to the full count, and the upsert adds them together — turning two
  -- counts of 40 into 80. Creating the row first gives FOR UPDATE something to
  -- serialise on.
  insert into public.stock (material_id, warehouse_id, quantity)
  values (p_material_id, p_warehouse_id, 0)
  on conflict (material_id, warehouse_id) do nothing;

  select quantity into v_current
    from public.stock
   where material_id = p_material_id and warehouse_id = p_warehouse_id
     for update;

  update public.stock
     set quantity = v_target, updated_at = now()
   where material_id = p_material_id and warehouse_id = p_warehouse_id;

  -- Logged as the movement it represents, so the ledger still adds up to the
  -- quantity rather than containing an unexplained jump.
  insert into public.stock_movements (material_id, warehouse_id, delta, reason, note, created_by)
  values (p_material_id, p_warehouse_id, v_target - v_current, 'stocktake', p_note, auth.uid());

  return v_target;
end;
$$;

-- ── drawings ───────────────────────────────────────────────────────────────

-- Pieces stay a JSON array rather than becoming a row each. There is no live
-- co-editing of one canvas, so per-piece rows would buy nothing and cost a
-- rewrite of the editor. Concurrent saves are handled by `version` instead:
-- a save carries the version it read, and hits zero rows if someone saved
-- first — which the client reports rather than silently overwriting.
create table if not exists public.documents (
  id           text primary key,
  name         text not null default 'ნახაზი',
  project_name text not null default '',
  revision     text not null default '',
  scale        integer not null default 50 check (scale > 0),
  pieces       jsonb not null default '[]'::jsonb,
  version      integer not null default 1,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Bumps the version on every save so the optimistic check above has something
-- to compare against, and keeps callers from setting it themselves.
create or replace function public.bump_document_version()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  new.version = old.version + 1;
  return new;
end;
$$;

drop trigger if exists documents_bump_version on public.documents;
create trigger documents_bump_version
  before update on public.documents
  for each row execute function public.bump_document_version();

drop trigger if exists materials_touch_updated_at on public.materials;
create trigger materials_touch_updated_at
  before update on public.materials
  for each row execute function public.touch_updated_at();

-- ── row-level security ─────────────────────────────────────────────────────
-- Every table denies by default; the policies below are the only way in.

alter table public.profiles        enable row level security;
alter table public.warehouses      enable row level security;
alter table public.materials       enable row level security;
alter table public.stock           enable row level security;
alter table public.stock_movements enable row level security;
alter table public.documents       enable row level security;

-- profiles: everyone signed in can see the team; only admins change roles.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (true);

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid() and role = public.user_role());

drop policy if exists profiles_admin_all on public.profiles;
create policy profiles_admin_all on public.profiles
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- catalog: everyone reads, admins write.
drop policy if exists warehouses_select on public.warehouses;
create policy warehouses_select on public.warehouses
  for select to authenticated using (true);

drop policy if exists warehouses_admin_all on public.warehouses;
create policy warehouses_admin_all on public.warehouses
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists materials_select on public.materials;
create policy materials_select on public.materials
  for select to authenticated using (true);

drop policy if exists materials_admin_all on public.materials;
create policy materials_admin_all on public.materials
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- stock: readable by all, but deliberately has NO write policy. The only way
-- to change a quantity is adjust_stock/set_stock, which guarantees a matching
-- ledger entry. A direct UPDATE from the client is refused.
drop policy if exists stock_select on public.stock;
create policy stock_select on public.stock
  for select to authenticated using (true);

drop policy if exists stock_movements_select on public.stock_movements;
create policy stock_movements_select on public.stock_movements
  for select to authenticated using (true);

-- drawings: everyone reads, admins and editors write.
drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents
  for select to authenticated using (true);

drop policy if exists documents_write on public.documents;
create policy documents_write on public.documents
  for all to authenticated using (public.can_edit()) with check (public.can_edit());

-- ── grants ─────────────────────────────────────────────────────────────────
-- Explicit because "automatically expose new tables" is off. RLS still decides
-- every row; these only make the tables reachable through the Data API at all.

grant usage on schema public to authenticated;

grant select                         on public.profiles        to authenticated;
grant update                         on public.profiles        to authenticated;
grant select, insert, update, delete on public.warehouses      to authenticated;
grant select, insert, update, delete on public.materials       to authenticated;
grant select                         on public.stock           to authenticated;
grant select                         on public.stock_movements to authenticated;
grant select, insert, update, delete on public.documents       to authenticated;

grant execute on function public.adjust_stock(text, text, integer, text, text) to authenticated;
grant execute on function public.set_stock(text, text, integer, text)          to authenticated;
grant execute on function public.user_role()                                   to authenticated;
grant execute on function public.is_admin()                                    to authenticated;
grant execute on function public.can_edit()                                    to authenticated;

-- The Edge Function connects as service_role. With "automatically expose new
-- tables" off, it gets no privileges by default either, so it has to be
-- granted them explicitly — bypassing row-level security is no help to a role
-- that cannot reach the table in the first place.
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- Signed-out visitors get nothing at all.
revoke all on all tables in schema public from anon;
