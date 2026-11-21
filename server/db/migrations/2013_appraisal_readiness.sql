-- 2013_appraisal_readiness.sql
--
-- "Property appraisals are adopting new rules, UAD 3.6 — can you build the
-- property checklists, budgeting and document storage with this in mind."
--
-- UAD 3.6 and the redesigned URAR replace the old fixed forms (1004, 1073,
-- 1025 and friends) with one dynamic report, mandatory for GSE appraisals
-- submitted on or after November 2, 2026. Much of what used to be appraiser
-- narrative is now structured data: measured area to ANSI Z765, a sketch or
-- floor plan, photos of every kitchen and bathroom, a defects table with a
-- recommended action for each, energy-efficient features, disaster mitigation,
-- ADUs, outbuildings and vehicle storage as their own records.
--
-- An owner cannot fill in the URAR — the appraiser does, and the ratings are
-- theirs. What an owner can do is have every answer, and the paper behind it,
-- ready before the appraiser arrives. That is this table.
--
-- `section` follows the shape of the report rather than this app's other
-- modules, so the list reads in the order the appraiser will ask.
--
-- `kind` decides what an item IS:
--   document — a piece of paper to have on file (elevation certificate, permit)
--   photo    — something to photograph, or make ready to be photographed
--   fact     — a value to know and write down (roof year, measured area)
--   defect   — a defect, damage or deficiency, with a recommended action and a
--              cost to cure. Defects are what the budget is built from.
--
-- `finding` is what you have — "1,842 sq ft above grade, measured 2026-10" —
-- and is kept apart from `detail`, which is what the appraiser is looking for,
-- for the same reason as on the diligence list: the question is what makes the
-- answer readable a year later.
--
-- `project_id` is the budget tie. Open defects with an estimate are rolled
-- into a project's budget lines in one step, and from there actual spend
-- reaches the ledger the way every other project's does.
CREATE TABLE appraisal_items (
  id                 TEXT PRIMARY KEY,
  property_id        TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  label              TEXT NOT NULL,
  section            TEXT NOT NULL DEFAULT 'other' CHECK (section IN
                       ('site', 'measurement', 'dwelling', 'updates', 'defects',
                        'energy', 'mitigation', 'additional', 'photos', 'income',
                        'project', 'other')),
  kind               TEXT NOT NULL DEFAULT 'document' CHECK (kind IN
                       ('document', 'photo', 'fact', 'defect')),
  status             TEXT NOT NULL DEFAULT 'todo' CHECK (status IN
                       ('todo', 'in_progress', 'ready', 'not_applicable')),
  detail             TEXT,
  finding            TEXT,
  -- When the fact was true: the date measured, installed, inspected, updated.
  as_of              TEXT,
  -- Defects only. Null everywhere else.
  recommended_action TEXT CHECK (recommended_action IS NULL OR recommended_action IN
                       ('none', 'repair', 'replace', 'inspect')),
  estimate_cents     INTEGER CHECK (estimate_cents IS NULL OR estimate_cents >= 0),
  project_id         TEXT REFERENCES projects(id) ON DELETE SET NULL,
  sort_order         INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  created_by         TEXT NOT NULL REFERENCES users(id),
  updated_by         TEXT NOT NULL REFERENCES users(id),
  version            INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_appraisal_property ON appraisal_items (property_id, sort_order, created_at);
CREATE INDEX ix_appraisal_project  ON appraisal_items (project_id);

-- Many files per item, not one. "A photo of every bathroom" is three photos in
-- a three-bathroom house, and a renovation is a permit plus a receipt.
--
-- The uploads themselves are filed against the PROPERTY, exactly as diligence
-- documents are, so every one of them is in Files with the deed and the
-- survey. Removing an item, or detaching a file from it, never removes the
-- file: an elevation certificate does not stop being yours because a
-- checklist row was tidied away.
CREATE TABLE appraisal_item_uploads (
  item_id    TEXT NOT NULL REFERENCES appraisal_items(id) ON DELETE CASCADE,
  upload_id  TEXT NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (item_id, upload_id)
);
CREATE INDEX ix_appraisal_uploads_upload ON appraisal_item_uploads (upload_id);
