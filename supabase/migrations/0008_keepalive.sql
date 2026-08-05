-- ═══════════════════════════════════════════════════════════════════════════
-- A callable heartbeat, so the scheduled keepalive really reaches the database.
--
-- A free project pauses after a week without activity, and a paused project
-- has to be restored by hand before anyone can sign in. The obvious keepalive
-- — read some table as the anonymous role — is refused by row-level security
-- and returns 401 without necessarily ever executing SQL, which makes it a
-- coin flip on the single thing the keepalive exists to prevent.
--
-- This gives the pinger something it is genuinely allowed to run. It reads no
-- application data and returns a timestamp, so exposing it to the anonymous
-- role costs nothing: anyone can already learn the current time.
--
-- `security definer` with a pinned search_path, matching the other functions
-- here — an unqualified name inside a definer function is otherwise resolved
-- against the caller's path, which is a way in.
--
-- Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.keepalive()
returns timestamptz
language sql
security definer
set search_path = public, pg_temp
as $$
  select now();
$$;

comment on function public.keepalive() is
  'Heartbeat for the scheduled keepalive job. Reads no data.';

revoke all on function public.keepalive() from public;
grant execute on function public.keepalive() to anon, authenticated, service_role;
