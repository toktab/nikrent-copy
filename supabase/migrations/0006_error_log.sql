-- ═══════════════════════════════════════════════════════════════════════════
-- Somewhere for crashes to land.
--
-- Several places in the app deliberately swallow a failure to avoid taking the
-- whole editor down with it. That is right for the user and wrong for whoever
-- has to fix it: today a crash is visible only to the person it happened to,
-- who reports it as "it stopped working" a week later, if at all.
--
-- This is a table rather than a third-party service on purpose — the data is
-- the company's own, there is no extra vendor, account or bill, and Postgres is
-- already here. A hosted tracker buys stack-trace grouping and alerting, which
-- is worth revisiting if the volume ever justifies it.
--
-- Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.error_log (
  id          bigint generated always as identity primary key,
  message     text not null,
  stack       text not null default '',
  /** where in the app it happened: 'render', 'window', 'promise', 'sync', … */
  source      text not null default 'unknown',
  /** current drawing, app version, viewport — whatever helps reproduce it */
  context     jsonb not null default '{}'::jsonb,
  user_agent  text not null default '',
  url         text not null default '',
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists error_log_created_at_idx on public.error_log (created_at desc);

alter table public.error_log enable row level security;

-- Anyone signed in may report a crash they hit: refusing the write would mean
-- losing exactly the reports that matter.
drop policy if exists error_log_insert on public.error_log;
create policy error_log_insert on public.error_log
  for insert to authenticated with check (true);

-- Only admins read them. A stack trace can carry fragments of whatever the
-- user was working on, so it is not something the whole company should browse.
drop policy if exists error_log_admin_read on public.error_log;
create policy error_log_admin_read on public.error_log
  for select to authenticated using (public.is_admin());

drop policy if exists error_log_admin_delete on public.error_log;
create policy error_log_admin_delete on public.error_log
  for delete to authenticated using (public.is_admin());

grant select, insert, delete on public.error_log to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant select, insert, update, delete on public.error_log to service_role;
