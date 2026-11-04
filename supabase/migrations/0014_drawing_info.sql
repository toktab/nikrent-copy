-- A drawing's own details, outside the formwork: who it is for, so far
-- (the drawing-info window beside the drawing's name).
--
-- One jsonb object rather than a column per field, because more fields are
-- coming and each one would otherwise need a migration of its own:
--   { "clientName": "..." }
--
-- Defaulted and NOT NULL so every drawing saved before this reads back as no
-- details rather than a null. Until this has been run, the app saves drawings
-- without the column and says so in the window.
--
-- Safe to re-run.

alter table public.documents
  add column if not exists info jsonb not null default '{}'::jsonb;

comment on column public.documents.info is
  'The job''s own details from the drawing-info window: {clientName}. '
  'Not formwork - never billed.';
