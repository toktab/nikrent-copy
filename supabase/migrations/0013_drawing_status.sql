-- A drawing's status as a job (სტატუსი), and so whether it holds stock.
--
--   active      - a real job. What it places is spoken for: every other
--                 drawing sees that much less in the yard.
--   unimportant - a what-if or an offer. Drawn as if the yard were
--                 bottomless; holds nothing back from anyone.
--   finished    - the job is back. Its parts count as returned.
--
-- Stock itself is NOT changed by any of this. `stock` stays what the company
-- owns, set only through set_stock() as before; what a drawing may still use
-- is worked out by the app as owned minus the other active drawings' pieces.
-- That is why finishing a job gives its parts back at once, and why a status
-- set by mistake undoes cleanly - nothing was ever subtracted to add back.
--
-- Defaulted to active, so every drawing saved before this keeps holding its
-- parts exactly as it always has, and nothing in the yard moves by running it.
-- A drawing that is really done is marked finished from the app.
--
-- Until this has been run, the app saves drawings without their status and
-- says so, rather than failing every save. An older client that does not know
-- the column leaves it untouched on update.
--
-- Safe to re-run.

alter table public.documents
  add column if not exists status text not null default 'active';

alter table public.documents
  drop constraint if exists documents_status_check;
alter table public.documents
  add constraint documents_status_check
  check (status in ('unimportant', 'active', 'finished'));

comment on column public.documents.status is
  'Job status: active holds its pieces against stock; unimportant draws on an '
  'unlimited yard and holds nothing; finished has returned everything.';
