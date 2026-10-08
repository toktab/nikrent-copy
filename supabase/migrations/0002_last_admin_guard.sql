-- ═══════════════════════════════════════════════════════════════════════════
-- Never let the company lock itself out.
--
-- Roles, stock and the catalog can only be changed by an admin. If the last
-- admin is demoted or deleted, nobody can appoint another one and the only way
-- back is the Supabase dashboard — so the database refuses instead.
--
-- Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.protect_last_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admins integer;
begin
  -- Only demotion and deletion of an existing admin are dangerous.
  if tg_op = 'UPDATE' and (old.role <> 'admin' or new.role = 'admin') then
    return new;
  end if;
  if tg_op = 'DELETE' and old.role <> 'admin' then
    return old;
  end if;

  select count(*) into v_admins from public.profiles where role = 'admin';

  if v_admins <= 1 then
    raise exception 'ბოლო ადმინისტრატორის წაშლა ან უფლების ჩამორთმევა შეუძლებელია'
      using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_last_admin_update on public.profiles;
create trigger profiles_protect_last_admin_update
  before update on public.profiles
  for each row execute function public.protect_last_admin();

drop trigger if exists profiles_protect_last_admin_delete on public.profiles;
create trigger profiles_protect_last_admin_delete
  before delete on public.profiles
  for each row execute function public.protect_last_admin();

-- Admins manage the team from inside the app, so they need to be able to
-- remove a profile. The existing `profiles_admin_all` policy already covers
-- DELETE, so only the grant is missing.
--
-- No policy is added to stop an admin deleting their own row: policies are
-- permissive and OR together, so a second one could only widen access, never
-- narrow it. Self-deletion is blocked in the Edge Function, and the trigger
-- above is what actually guarantees an administrator always remains.
grant delete on public.profiles to authenticated;
