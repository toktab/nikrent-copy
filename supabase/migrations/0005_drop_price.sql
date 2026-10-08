-- ═══════════════════════════════════════════════════════════════════════════
-- Drop the price column.
--
-- Costing is out of scope for this app: it plans and counts formwork, and the
-- money side is handled elsewhere. Keeping an unused column invites half-filled
-- data and a total on screen that nobody maintains and everybody misreads.
--
-- Destructive and irreversible — any prices entered are gone. Nothing in the
-- app has read this column since the release that ships this migration.
--
-- Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.materials drop column if exists price;
