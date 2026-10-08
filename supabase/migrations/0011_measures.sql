-- Measured check lines placed with the measure tool (გაზომვა).
--
-- An annotation, not a component: a free line with a length, in the same plan
-- world centimetres as `pieces` and `sketch`. It never reaches the bill of
-- materials - nobody delivers a measurement - so it lives beside the sketch.
--
-- Defaulted and NOT NULL so every drawing saved before this reads back as no
-- measurements rather than a null. The client guards anyway
-- (`Array.isArray(row.measures)`), and until this has been run it saves
-- drawings without the column and says so, rather than failing every save.
--
-- An older client that does not know the column leaves it untouched on update:
-- PostgREST only writes the columns it is sent.
--
-- Safe to re-run.

alter table public.documents
  add column if not exists measures jsonb not null default '[]'::jsonb;

comment on column public.documents.measures is
  'Measured check lines in plan world cm: [{id, a:{x,y}, b:{x,y}}]. '
  'Never billed - an annotation the user placed, not formwork.';
