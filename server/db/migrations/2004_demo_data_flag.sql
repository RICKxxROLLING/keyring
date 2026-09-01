-- 2004_demo_data_flag.sql
--
-- "I would like to be able to toggle demo data on and off without wiping the
-- database of users."
--
-- The problem this solves: the only way to get rid of the demo portfolio was
-- to delete the database file, which took the accounts, the TOTP enrolments
-- and the invites with it. Evaluating the app and then starting for real meant
-- setting everyone up a second time.
--
-- The fix is to know which rows are demo. A flag on properties and vendors is
-- enough for all of it:
--
--   - Everything property-scoped (units, notes, work orders, PM templates,
--     projects, tenants, leases, rent, expenses, specs, compliance, turnovers,
--     uploads) already has ON DELETE CASCADE to properties(id), so deleting a
--     demo property takes its whole dossier with it. See 2001_domain.sql.
--   - Vendors are portfolio-wide, not property-scoped, so they need their own
--     flag or the five demo trades would outlive the demo.
--   - Users are deliberately NOT flagged. They are never demo data — the seed
--     adopts whatever owner account already exists rather than creating one,
--     and a real person's account must survive removing the demo, which is the
--     entire point of this change.
--
-- Defaulting to 0 means everything that exists right now — including anything
-- typed into a demo build in earnest — is treated as real and is never removed
-- by the toggle. Rows seeded before this migration are not identifiable as
-- demo after the fact, and guessing would risk deleting real work.

ALTER TABLE properties ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0;

ALTER TABLE vendors ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0;

-- Both lookups are "which rows are demo", over small tables, but the answer is
-- needed on every dashboard load to decide whether to offer removing it.
CREATE INDEX ix_properties_demo ON properties (is_demo);
CREATE INDEX ix_vendors_demo ON vendors (is_demo);
