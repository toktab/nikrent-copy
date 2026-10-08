-- ═══════════════════════════════════════════════════════════════════════════
-- Profile pictures.
--
-- Files live in Storage, not in the database: a bytea column would be pulled
-- into every profile query and bloat the row for no reason. The table keeps
-- only the path.
--
-- Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.profiles
  add column if not exists avatar_url text not null default '';

-- Public-read bucket. The contents are staff headshots inside one company, and
-- a public bucket means an <img src> just works — no signed URL to mint and
-- refresh on every render. Writes are still restricted below.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

-- Anyone signed in can see colleagues' pictures.
drop policy if exists avatars_read on storage.objects;
create policy avatars_read on storage.objects
  for select using (bucket_id = 'avatars');

-- Writes are confined to a folder named after the user's own id, so nobody can
-- overwrite somebody else's picture. Files are stored as `<uid>/avatar.<ext>`.
drop policy if exists avatars_insert_own on storage.objects;
create policy avatars_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists avatars_update_own on storage.objects;
create policy avatars_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists avatars_delete_own on storage.objects;
create policy avatars_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- A user may edit their own display name and picture. The existing
-- profiles_update_self policy already pins `role` to its current value, so
-- this cannot become a way to grant yourself admin.
grant update (full_name, avatar_url) on public.profiles to authenticated;
