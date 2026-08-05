-- ═══════════════════════════════════════════════════════════════════════════
-- Reusable assemblies.
--
-- The same column and wall types repeat across a job and between jobs. Without
-- this, each one is re-generated from the wizard or copied between drawings by
-- hand — and any correction someone works out has to be rediscovered next time.
--
-- Company-wide rather than per-user: a template is how this firm builds that
-- detail, not a personal preference.
--
-- Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.templates (
  id          text primary key,
  name        text not null,
  /**
   * Pieces stored relative to their own top-left corner, so a template can be
   * dropped anywhere. Same JSON shape as documents.pieces.
   */
  pieces      jsonb not null default '[]'::jsonb,
  /** plan footprint in cm, for the preview list */
  width       numeric not null default 0,
  height      numeric not null default 0,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists templates_name_idx on public.templates (name);

alter table public.templates enable row level security;

-- Everyone signed in can use a template; whoever may draw may also save one.
drop policy if exists templates_select on public.templates;
create policy templates_select on public.templates
  for select to authenticated using (true);

drop policy if exists templates_write on public.templates;
create policy templates_write on public.templates
  for all to authenticated using (public.can_edit()) with check (public.can_edit());

grant select, insert, update, delete on public.templates to authenticated;
grant select, insert, update, delete on public.templates to service_role;

drop trigger if exists templates_touch_updated_at on public.templates;
create trigger templates_touch_updated_at
  before update on public.templates
  for each row execute function public.touch_updated_at();
