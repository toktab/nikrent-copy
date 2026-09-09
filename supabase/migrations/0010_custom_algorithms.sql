-- ═══════════════════════════════════════════════════════════════════════════
-- User-uploaded detection algorithms (.ts detectors), synced per account.
--
-- Unlike templates — which are company knowledge shared by everyone — a custom
-- detector is personal: the code a user pastes or writes is theirs. So the
-- table is user-scoped, every row carries the owning account, and row-level
-- security lets each signed-in user see and change only their own rows.
--
-- The client mirrors its rows into localStorage as an offline cache, so the
-- same algorithms are still loadable on this device with no network.
--
-- Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.custom_algorithms (
  id          text primary key,
  -- Filled from the client; the insert policy below insists it matches the
  -- caller, so it can never be pointed at someone else's account.
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  source      text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Saving under the same name overwrites (the client saves by name), so the
  -- pair must be unique per account or the upsert has no conflict target.
  unique (user_id, name)
);

create index if not exists custom_algorithms_user_idx
  on public.custom_algorithms (user_id, updated_at desc);

alter table public.custom_algorithms enable row level security;

-- Strictly the owner: one account cannot even see another's algorithms, let
-- alone change them.
drop policy if exists custom_algorithms_select on public.custom_algorithms;
create policy custom_algorithms_select on public.custom_algorithms
  for select to authenticated using (user_id = auth.uid());

drop policy if exists custom_algorithms_insert on public.custom_algorithms;
create policy custom_algorithms_insert on public.custom_algorithms
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists custom_algorithms_update on public.custom_algorithms;
create policy custom_algorithms_update on public.custom_algorithms
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists custom_algorithms_delete on public.custom_algorithms;
create policy custom_algorithms_delete on public.custom_algorithms
  for delete to authenticated using (user_id = auth.uid());

drop trigger if exists custom_algorithms_touch_updated_at on public.custom_algorithms;
create trigger custom_algorithms_touch_updated_at
  before update on public.custom_algorithms
  for each row execute function public.touch_updated_at();

-- Explicit grants: "automatically expose new tables" is off, so the Data API
-- and the Edge Functions (service_role) get nothing by default.
grant select, insert, update, delete on public.custom_algorithms to authenticated;
grant select, insert, update, delete on public.custom_algorithms to service_role;

comment on table public.custom_algorithms is
  'User-scoped .ts detection algorithms. Each account sees only its own rows; '
  'the client keeps a localStorage mirror for offline use.';
