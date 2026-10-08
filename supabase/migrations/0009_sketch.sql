-- The drawn layout a drawing's formwork is set out to.
--
-- Reference geometry, not components: an orthogonal polyline per path, in the
-- same plan world centimetres as `pieces`. It never reaches the bill of
-- materials — nobody delivers a line — so it lives beside the pieces rather
-- than among them.
--
-- Defaulted and NOT NULL so every drawing made before the pen existed reads
-- back as an empty sketch rather than a null the client has to guard on. The
-- client guards anyway (`Array.isArray(row.sketch)`), because a column can be
-- added faster than every open tab reloads.

alter table public.documents
  add column if not exists sketch jsonb not null default '[]'::jsonb;

comment on column public.documents.sketch is
  'Orthogonal reference polylines in plan world cm: [{id, points:[{x,y}], closed}]. '
  'Never billed — this is the layout the formwork is set out to, not formwork.';
