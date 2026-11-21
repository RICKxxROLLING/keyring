-- 2014_appraisal_import.sql
--
-- "Can you add an appraisal importer that autofills data."
--
-- Two changes, both following from reading the GSE UAD 3.6 delivery
-- specification (Appendix A-1) rather than a summary of it.
--
-- 1. The recommended action on a defect. 2013 offered none / repair / replace
--    / inspect. The URAR's own list (DefectItemRecommendedActionType) is
--    Completion | Inspection | None | Repair: there is no "replace", and
--    "completion" (work begun and not finished) was missing. An importer that
--    reads the appraiser's value straight out of the report has to be able to
--    store it, so the column now takes the report's four, and any saved
--    "replace" becomes "repair" — a replacement is a repair, in the report's
--    terms.
--
--    SQLite cannot alter a CHECK constraint, so the table is rebuilt. Care is
--    needed because migrations run in a transaction with foreign keys ON:
--    dropping appraisal_items directly would cascade-delete every file link in
--    appraisal_item_uploads. So the links are copied aside first, the link
--    table is dropped before the item table, and both are put back.
--
-- 2. appraisal_reports — one row per imported appraisal: the date, the
--    opinion of value, the ratings, and the report itself. A property's
--    appraisal history is worth having in one place, and the PDF is the
--    document an appraiser or lender will ask for next time.

CREATE TABLE appraisal_items_v2 (
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
  as_of              TEXT,
  recommended_action TEXT CHECK (recommended_action IS NULL OR recommended_action IN
                       ('none', 'repair', 'inspect', 'completion')),
  estimate_cents     INTEGER CHECK (estimate_cents IS NULL OR estimate_cents >= 0),
  project_id         TEXT REFERENCES projects(id) ON DELETE SET NULL,
  sort_order         INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  created_by         TEXT NOT NULL REFERENCES users(id),
  updated_by         TEXT NOT NULL REFERENCES users(id),
  version            INTEGER NOT NULL DEFAULT 1
);

INSERT INTO appraisal_items_v2
  SELECT id, property_id, label, section, kind, status, detail, finding, as_of,
         CASE recommended_action WHEN 'replace' THEN 'repair' ELSE recommended_action END,
         estimate_cents, project_id, sort_order, created_at, updated_at, created_by,
         updated_by, version
    FROM appraisal_items;

CREATE TABLE appraisal_item_uploads_keep AS SELECT * FROM appraisal_item_uploads;
DROP TABLE appraisal_item_uploads;
DROP TABLE appraisal_items;
ALTER TABLE appraisal_items_v2 RENAME TO appraisal_items;
CREATE INDEX ix_appraisal_property ON appraisal_items (property_id, sort_order, created_at);
CREATE INDEX ix_appraisal_project  ON appraisal_items (project_id);

CREATE TABLE appraisal_item_uploads (
  item_id    TEXT NOT NULL REFERENCES appraisal_items(id) ON DELETE CASCADE,
  upload_id  TEXT NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (item_id, upload_id)
);
CREATE INDEX ix_appraisal_uploads_upload ON appraisal_item_uploads (upload_id);
INSERT INTO appraisal_item_uploads SELECT item_id, upload_id, created_at, created_by
  FROM appraisal_item_uploads_keep;
DROP TABLE appraisal_item_uploads_keep;

-- ----------------------------------------------------------- appraisal_reports --
--
-- `source_format` says how much to trust the row: 'uad36_xml' was read field
-- by field from the GSE data; 'pdf' was read off the page's text and checked
-- by a person before it was saved.
--
-- `effective_date` and `opinion_of_value_cents` are nullable because a PDF
-- that could not be read for them is still worth filing.
CREATE TABLE appraisal_reports (
  id                      TEXT PRIMARY KEY,
  property_id             TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  effective_date          TEXT,
  opinion_of_value_cents  INTEGER CHECK (opinion_of_value_cents IS NULL OR opinion_of_value_cents >= 0),
  assignment_type         TEXT,
  value_condition         TEXT,
  overall_condition       TEXT,
  overall_quality         TEXT,
  source_format           TEXT NOT NULL CHECK (source_format IN ('uad36_xml', 'pdf')),
  source_filename         TEXT NOT NULL,
  upload_id               TEXT REFERENCES uploads(id) ON DELETE SET NULL,
  -- How many checklist items and defects the import filled, for the history line.
  items_filled            INTEGER NOT NULL DEFAULT 0,
  defects_added           INTEGER NOT NULL DEFAULT 0,
  created_at              TEXT NOT NULL,
  created_by              TEXT NOT NULL REFERENCES users(id)
);
CREATE INDEX ix_appraisal_reports_property ON appraisal_reports (property_id, effective_date DESC);
