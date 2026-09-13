-- The leg thickness of an L-shaped corner (ფეხის სისქე).
--
-- Every L used to take its leg from the panel it sits against - 9 cm - which is
-- right for the შიდა კუთხე and wrong for the გარე კუთხე: that one is a thin
-- steel angle, 10 × 10 cm with a 0.1 cm leg, as the architect drew it. The
-- thickness is a property of the part, so it lives on the material and the
-- component form edits it.
--
-- Nullable on purpose: null means "the panel-thickness rule", which is what
-- every material saved before this has been drawn with, so nothing already in
-- the catalog changes shape by running it.
--
-- The built-in outer corner is corrected here too, but only where it still has
-- the old 24 cm size - a company that already changed it by hand keeps its own.
-- The app makes the same correction when it loads a catalog.
--
-- An older client that does not know the column leaves it untouched on update:
-- PostgREST only writes the columns it is sent. Until this has been run, the
-- app saves materials without it and says so, rather than failing every save.
--
-- Safe to re-run.

alter table public.materials
  add column if not exists leg numeric check (leg is null or leg > 0);

comment on column public.materials.leg is
  'L-profile leg thickness in cm; null = the 9 cm panel-thickness rule. '
  'The outer corner (გარე კუთხე) is a thin angle, 0.1 cm by default.';

update public.materials
   set w = 10, depth = 10, leg = 0.1, updated_at = now()
 where id = 'corner-outer-300'
   and builtin
   and w = 24;
