-- ═══════════════════════════════════════════════════════════════════════════
-- Give `service_role` access to the tables.
--
-- With "automatically expose new tables" switched off, Supabase's default
-- privileges no longer apply, so a newly created table starts with no grants
-- for ANY role — including service_role. 0001 granted `authenticated` what it
-- needs and stopped there, which is why the app worked but the admin-users
-- Edge Function failed with "permission denied for table profiles": it is the
-- only thing that connects as service_role.
--
-- service_role also bypasses row-level security, but that is a separate
-- mechanism from table privileges — bypassing the policies does not help if
-- the role cannot touch the table at all.
--
-- Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

grant usage on schema public to service_role;

grant select, insert, update, delete on public.profiles        to service_role;
grant select, insert, update, delete on public.warehouses      to service_role;
grant select, insert, update, delete on public.materials       to service_role;
grant select, insert, update, delete on public.stock           to service_role;
grant select, insert, update, delete on public.stock_movements to service_role;
grant select, insert, update, delete on public.documents       to service_role;

-- stock_movements has an identity column; its sequence is reached implicitly
-- on insert, so it needs to be usable too.
grant usage, select on all sequences in schema public to service_role;

grant execute on all functions in schema public to service_role;

-- Signed-out visitors still get nothing.
revoke all on all tables in schema public from anon;
