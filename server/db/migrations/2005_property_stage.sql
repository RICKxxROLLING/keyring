-- 2005_property_stage.sql
--
-- "A tag for a prospect property — not part of the current portfolio, but with
-- projects, renovation and budgeting."
--
-- A property you are considering is not the same object as one you own. It has
-- no tenants, no rent roll, no occupancy and no compliance obligations, and
-- counting it in the portfolio totals would quietly overstate what you have. It
-- DOES have the things you are weighing the decision on: scope of work,
-- projects, estimated costs, photos and notes.
--
-- So this is a stage on the property, not a separate kind of record:
--
--   owned    — on the ring. Everything applies.
--   prospect — being considered. Everything still WORKS, because the point is
--              to plan the renovation before you buy, but it is excluded from
--              portfolio rollups and shown apart from the keys you hold.
--
-- One column rather than a `prospects` table on purpose: buying it must not
-- mean re-entering it. Deciding to go ahead is `stage = 'owned'`, and every
-- project, estimate, note and photo you built up while deciding comes with it.
--
-- Defaults to 'owned' so every existing property — all of which are owned — is
-- correct without a backfill.

ALTER TABLE properties ADD COLUMN stage TEXT NOT NULL DEFAULT 'owned'
  CHECK (stage IN ('owned', 'prospect'));

-- The ring, the dashboard and every portfolio total filter on this.
CREATE INDEX ix_properties_stage ON properties (stage, archived_at, sort_order);
