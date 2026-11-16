-- ═══════════════════════════════════════════════════════════════════════════
-- შაბლონები: a price per template, and the drawn lines that came with it.
--
-- Templates are mostly columns, and each column type has a price of its own
-- (the user, 2026-11-16) - the export multiplies it by how many were dropped
-- in, as the კომპლექტის ფასი. The lines are kept so a template saved off a
-- drawn column brings its outline back with it.
--
-- Safe to re-run. Until it runs, templates still list and save - without the
-- price and the lines.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.templates add column if not exists price numeric;
alter table public.templates add column if not exists sketch jsonb not null default '[]'::jsonb;

-- PostgREST caches the table's shape; tell it the columns are there.
notify pgrst, 'reload schema';
