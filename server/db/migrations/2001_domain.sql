-- 2001_domain.sql — the entire property domain, uploads, and the search index.

CREATE TABLE properties (
  id                      TEXT PRIMARY KEY,
  name                    TEXT NOT NULL,
  address_line1           TEXT NOT NULL,
  address_line2           TEXT,
  city                    TEXT NOT NULL,
  state                   TEXT NOT NULL,
  postal_code             TEXT NOT NULL,
  country                 TEXT NOT NULL DEFAULT 'US',
  property_type           TEXT NOT NULL CHECK (property_type IN
                            ('single_family','duplex','triplex','fourplex','condo',
                             'townhouse','other')),
  year_built              INTEGER,
  sqft                    INTEGER,
  lot_sqft                INTEGER,
  parcel_number           TEXT,
  purchase_date           TEXT,
  purchase_price_cents    INTEGER,
  mortgage_lender         TEXT,
  mortgage_payment_cents  INTEGER,
  insurance_carrier       TEXT,
  insurance_policy_number TEXT,
  cover_upload_id         TEXT,
  notes                   TEXT,
  sort_order              INTEGER NOT NULL DEFAULT 0,
  archived_at             TEXT,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL,
  created_by              TEXT NOT NULL REFERENCES users(id),
  updated_by              TEXT NOT NULL REFERENCES users(id),
  version                 INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_properties_sort ON properties (archived_at, sort_order, name);

CREATE TABLE units (
  id                 TEXT PRIMARY KEY,
  property_id        TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  label              TEXT NOT NULL,
  bedrooms           INTEGER,
  bathrooms          REAL,
  sqft               INTEGER,
  floor              TEXT,
  market_rent_cents  INTEGER,
  status             TEXT NOT NULL DEFAULT 'vacant'
                       CHECK (status IN ('occupied','vacant','make_ready','offline')),
  notes              TEXT,
  sort_order         INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  created_by         TEXT NOT NULL REFERENCES users(id),
  updated_by         TEXT NOT NULL REFERENCES users(id),
  version            INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ux_units_label ON units (property_id, label);
CREATE INDEX ix_units_property ON units (property_id, sort_order);

CREATE TABLE notes (
  id          TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_id     TEXT REFERENCES units(id) ON DELETE SET NULL,
  title       TEXT,
  body        TEXT NOT NULL,
  pinned      INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0,1)),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  created_by  TEXT NOT NULL REFERENCES users(id),
  updated_by  TEXT NOT NULL REFERENCES users(id),
  version     INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_notes_property ON notes (property_id, pinned DESC, created_at DESC);

CREATE TABLE vendors (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  company              TEXT,
  trade                TEXT NOT NULL,
  phone                TEXT,
  email                TEXT,
  website              TEXT,
  address              TEXT,
  notes                TEXT,
  rating               INTEGER CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  preferred            INTEGER NOT NULL DEFAULT 0 CHECK (preferred IN (0,1)),
  license_number       TEXT,
  insurance_expires_on TEXT,
  archived_at          TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  created_by           TEXT NOT NULL REFERENCES users(id),
  updated_by           TEXT NOT NULL REFERENCES users(id),
  version              INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_vendors_name  ON vendors (archived_at, name);
CREATE INDEX ix_vendors_trade ON vendors (trade);

CREATE TABLE pm_templates (
  id                  TEXT PRIMARY KEY,
  property_id         TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_id             TEXT REFERENCES units(id) ON DELETE SET NULL,
  title               TEXT NOT NULL,
  description         TEXT,
  priority            TEXT NOT NULL DEFAULT 'normal'
                        CHECK (priority IN ('low','normal','high','urgent')),
  assignee_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
  vendor_id           TEXT REFERENCES vendors(id) ON DELETE SET NULL,
  frequency           TEXT NOT NULL CHECK (frequency IN
                        ('monthly','quarterly','semiannual','annual','custom_days')),
  interval_days       INTEGER,
  anchor_date         TEXT NOT NULL,
  lead_days           INTEGER NOT NULL DEFAULT 7,
  next_due_date       TEXT NOT NULL,
  last_generated_date TEXT,
  active              INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  created_by          TEXT NOT NULL REFERENCES users(id),
  updated_by          TEXT NOT NULL REFERENCES users(id),
  version             INTEGER NOT NULL DEFAULT 1,
  CHECK (frequency <> 'custom_days' OR interval_days IS NOT NULL)
);
CREATE INDEX ix_pm_due ON pm_templates (active, next_due_date);
CREATE INDEX ix_pm_property ON pm_templates (property_id);

CREATE TABLE work_orders (
  id             TEXT PRIMARY KEY,
  property_id    TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_id        TEXT REFERENCES units(id) ON DELETE SET NULL,
  number         INTEGER NOT NULL,
  title          TEXT NOT NULL,
  description    TEXT,
  status         TEXT NOT NULL DEFAULT 'new' CHECK (status IN
                   ('new','triaged','scheduled','in_progress','done','cancelled')),
  priority       TEXT NOT NULL DEFAULT 'normal'
                   CHECK (priority IN ('low','normal','high','urgent')),
  assignee_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  vendor_id      TEXT REFERENCES vendors(id) ON DELETE SET NULL,
  due_date       TEXT,
  scheduled_for  TEXT,
  completed_at   TEXT,
  estimate_cents INTEGER,
  cost_cents     INTEGER,
  source         TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','pm')),
  pm_template_id TEXT REFERENCES pm_templates(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  created_by     TEXT NOT NULL REFERENCES users(id),
  updated_by     TEXT NOT NULL REFERENCES users(id),
  version        INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ux_wo_number ON work_orders (property_id, number);
CREATE INDEX ix_wo_property_status ON work_orders (property_id, status, priority);
CREATE INDEX ix_wo_due      ON work_orders (status, due_date);
CREATE INDEX ix_wo_assignee ON work_orders (assignee_id, status);
-- Guarantees one generated work order per PM cycle.
CREATE UNIQUE INDEX ux_wo_pm_cycle ON work_orders (pm_template_id, due_date)
  WHERE pm_template_id IS NOT NULL;

CREATE TABLE work_order_comments (
  id            TEXT PRIMARY KEY,
  work_order_id TEXT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  body          TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT NOT NULL REFERENCES users(id),
  updated_by    TEXT NOT NULL REFERENCES users(id),
  version       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_woc_wo ON work_order_comments (work_order_id, created_at);

CREATE TABLE projects (
  id            TEXT PRIMARY KEY,
  property_id   TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT,
  status        TEXT NOT NULL DEFAULT 'idea' CHECK (status IN
                  ('idea','planning','quoted','approved','in_progress',
                   'blocked','done','cancelled')),
  priority      TEXT NOT NULL DEFAULT 'normal'
                  CHECK (priority IN ('low','normal','high','urgent')),
  owner_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  target_start  TEXT,
  target_end    TEXT,
  actual_start  TEXT,
  actual_end    TEXT,
  budget_cents  INTEGER,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT NOT NULL REFERENCES users(id),
  updated_by    TEXT NOT NULL REFERENCES users(id),
  version       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_projects_property ON projects (property_id, status);

CREATE TABLE project_lines (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('budget','expense')),
  label        TEXT NOT NULL,
  category     TEXT,
  amount_cents INTEGER NOT NULL,
  incurred_on  TEXT,
  vendor_id    TEXT REFERENCES vendors(id) ON DELETE SET NULL,
  note         TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  created_by   TEXT NOT NULL REFERENCES users(id),
  updated_by   TEXT NOT NULL REFERENCES users(id),
  version      INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_project_lines ON project_lines (project_id, kind);

CREATE TABLE tenants (
  id                       TEXT PRIMARY KEY,
  property_id              TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_id                  TEXT REFERENCES units(id) ON DELETE SET NULL,
  first_name               TEXT NOT NULL,
  last_name                TEXT NOT NULL,
  email                    TEXT,
  phone                    TEXT,
  emergency_contact_name   TEXT,
  emergency_contact_phone  TEXT,
  notes                    TEXT,
  is_primary               INTEGER NOT NULL DEFAULT 1 CHECK (is_primary IN (0,1)),
  moved_in_at              TEXT,
  moved_out_at             TEXT,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  created_by               TEXT NOT NULL REFERENCES users(id),
  updated_by               TEXT NOT NULL REFERENCES users(id),
  version                  INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_tenants_property ON tenants (property_id, moved_out_at);
CREATE INDEX ix_tenants_unit     ON tenants (unit_id);

CREATE TABLE leases (
  id                   TEXT PRIMARY KEY,
  property_id          TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_id              TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  start_date           TEXT NOT NULL,
  end_date             TEXT,
  rent_cents           INTEGER NOT NULL,
  deposit_cents        INTEGER NOT NULL DEFAULT 0,
  due_day              INTEGER NOT NULL DEFAULT 1 CHECK (due_day BETWEEN 1 AND 28),
  status               TEXT NOT NULL DEFAULT 'active'
                         CHECK (status IN ('upcoming','active','ended','terminated')),
  renewal_notice_days  INTEGER NOT NULL DEFAULT 60,
  document_upload_id   TEXT,
  notes                TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  created_by           TEXT NOT NULL REFERENCES users(id),
  updated_by           TEXT NOT NULL REFERENCES users(id),
  version              INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_leases_unit    ON leases (unit_id, status, start_date DESC);
CREATE INDEX ix_leases_expiry  ON leases (status, end_date);

CREATE TABLE lease_tenants (
  lease_id  TEXT NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  PRIMARY KEY (lease_id, tenant_id)
);

CREATE TABLE rent_entries (
  id                    TEXT PRIMARY KEY,
  property_id           TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_id               TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  lease_id              TEXT REFERENCES leases(id) ON DELETE SET NULL,
  period                TEXT NOT NULL,               -- 'YYYY-MM'
  amount_due_cents      INTEGER NOT NULL,
  amount_received_cents INTEGER NOT NULL DEFAULT 0,
  received_on           TEXT,
  method                TEXT,
  status                TEXT NOT NULL DEFAULT 'unpaid'
                          CHECK (status IN ('unpaid','partial','paid','late','waived')),
  note                  TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  created_by            TEXT NOT NULL REFERENCES users(id),
  updated_by            TEXT NOT NULL REFERENCES users(id),
  version               INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ux_rent_unit_period ON rent_entries (unit_id, period);
CREATE INDEX ix_rent_property ON rent_entries (property_id, period DESC);

CREATE TABLE property_expenses (
  id            TEXT PRIMARY KEY,
  property_id   TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_id       TEXT REFERENCES units(id) ON DELETE SET NULL,
  category      TEXT NOT NULL CHECK (category IN
                  ('repair','capex','utility','insurance','tax','management',
                   'supplies','legal','landscaping','other')),
  description   TEXT NOT NULL,
  amount_cents  INTEGER NOT NULL,
  incurred_on   TEXT NOT NULL,
  vendor_id     TEXT REFERENCES vendors(id) ON DELETE SET NULL,
  work_order_id TEXT REFERENCES work_orders(id) ON DELETE SET NULL,
  project_id    TEXT REFERENCES projects(id) ON DELETE SET NULL,
  note          TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT NOT NULL REFERENCES users(id),
  updated_by    TEXT NOT NULL REFERENCES users(id),
  version       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_expenses_property ON property_expenses (property_id, incurred_on DESC);
CREATE INDEX ix_expenses_category ON property_expenses (property_id, category);

CREATE TABLE spec_entries (
  id                   TEXT PRIMARY KEY,
  property_id          TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_id              TEXT REFERENCES units(id) ON DELETE SET NULL,
  category             TEXT NOT NULL CHECK (category IN
                         ('appliance','filter','paint','shutoff','code',
                          'warranty','utility','other')),
  label                TEXT NOT NULL,
  make                 TEXT,
  model                TEXT,
  serial               TEXT,
  value                TEXT,
  location             TEXT,
  is_secret            INTEGER NOT NULL DEFAULT 0 CHECK (is_secret IN (0,1)),
  installed_on         TEXT,
  warranty_expires_on  TEXT,
  vendor_id            TEXT REFERENCES vendors(id) ON DELETE SET NULL,
  notes                TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  created_by           TEXT NOT NULL REFERENCES users(id),
  updated_by           TEXT NOT NULL REFERENCES users(id),
  version              INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_specs_property ON spec_entries (property_id, category, label);
CREATE INDEX ix_specs_warranty ON spec_entries (warranty_expires_on);

CREATE TABLE compliance_items (
  id            TEXT PRIMARY KEY,
  property_id   TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_id       TEXT REFERENCES units(id) ON DELETE SET NULL,
  kind          TEXT NOT NULL CHECK (kind IN
                  ('insurance','tax','inspection','license','hoa','permit','other')),
  title         TEXT NOT NULL,
  authority     TEXT,
  reference     TEXT,
  due_date      TEXT NOT NULL,
  lead_days     INTEGER NOT NULL DEFAULT 30,
  recurrence    TEXT NOT NULL DEFAULT 'none' CHECK (recurrence IN
                  ('none','monthly','quarterly','semiannual','annual')),
  state         TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','done','waived')),
  completed_on  TEXT,
  cost_cents    INTEGER,
  vendor_id     TEXT REFERENCES vendors(id) ON DELETE SET NULL,
  notes         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT NOT NULL REFERENCES users(id),
  updated_by    TEXT NOT NULL REFERENCES users(id),
  version       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_compliance_due      ON compliance_items (state, due_date);
CREATE INDEX ix_compliance_property ON compliance_items (property_id, due_date);

CREATE TABLE turnovers (
  id                     TEXT PRIMARY KEY,
  property_id            TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_id                TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  phase                  TEXT NOT NULL DEFAULT 'move_out'
                           CHECK (phase IN ('move_out','make_ready','move_in','complete')),
  move_out_date          TEXT,
  target_ready_date      TEXT,
  move_in_date           TEXT,
  outgoing_lease_id      TEXT REFERENCES leases(id) ON DELETE SET NULL,
  incoming_lease_id      TEXT REFERENCES leases(id) ON DELETE SET NULL,
  deposit_held_cents     INTEGER NOT NULL DEFAULT 0,
  deposit_withheld_cents INTEGER NOT NULL DEFAULT 0,
  deposit_returned_cents INTEGER NOT NULL DEFAULT 0,
  deposit_returned_on    TEXT,
  deposit_notes          TEXT,
  condition_notes        TEXT,
  closed_at              TEXT,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL,
  created_by             TEXT NOT NULL REFERENCES users(id),
  updated_by             TEXT NOT NULL REFERENCES users(id),
  version                INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_turnovers_unit ON turnovers (unit_id, closed_at);
CREATE INDEX ix_turnovers_open ON turnovers (property_id, closed_at, phase);

CREATE TABLE turnover_items (
  id            TEXT PRIMARY KEY,
  turnover_id   TEXT NOT NULL REFERENCES turnovers(id) ON DELETE CASCADE,
  phase         TEXT NOT NULL CHECK (phase IN ('move_out','make_ready','move_in','complete')),
  label         TEXT NOT NULL,
  done          INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0,1)),
  done_at       TEXT,
  done_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  cost_cents    INTEGER,
  note          TEXT,
  work_order_id TEXT REFERENCES work_orders(id) ON DELETE SET NULL,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT NOT NULL REFERENCES users(id),
  updated_by    TEXT NOT NULL REFERENCES users(id),
  version       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_turnover_items ON turnover_items (turnover_id, phase, sort_order);

CREATE TABLE uploads (
  id           TEXT PRIMARY KEY,
  parent_type  TEXT NOT NULL CHECK (parent_type IN
                 ('property','unit','note','work_order','project','lease','tenant',
                  'property_expense','spec_entry','turnover','compliance_item','vendor')),
  parent_id    TEXT NOT NULL,
  property_id  TEXT REFERENCES properties(id) ON DELETE CASCADE,
  filename     TEXT NOT NULL,
  stored_path  TEXT NOT NULL,
  thumb_path   TEXT,
  mime         TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('image','pdf')),
  size_bytes   INTEGER NOT NULL,
  sha256       TEXT NOT NULL,
  width        INTEGER,
  height       INTEGER,
  caption      TEXT,
  uploaded_by  TEXT NOT NULL REFERENCES users(id),
  created_at   TEXT NOT NULL,
  deleted_at   TEXT
);
CREATE INDEX ix_uploads_parent   ON uploads (parent_type, parent_id, deleted_at);
CREATE INDEX ix_uploads_property ON uploads (property_id, created_at DESC);

-- ---------------------------------------------------------------- search ---
CREATE TABLE search_index (
  rowid_pk    INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  property_id TEXT,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  url         TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_search_entity ON search_index (entity_type, entity_id);
CREATE INDEX ix_search_property ON search_index (property_id);

CREATE VIRTUAL TABLE search_fts USING fts5(
  title, body,
  content='search_index',
  content_rowid='rowid_pk',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER trg_search_ai AFTER INSERT ON search_index BEGIN
  INSERT INTO search_fts(rowid, title, body) VALUES (new.rowid_pk, new.title, new.body);
END;
CREATE TRIGGER trg_search_ad AFTER DELETE ON search_index BEGIN
  INSERT INTO search_fts(search_fts, rowid, title, body)
  VALUES ('delete', old.rowid_pk, old.title, old.body);
END;
CREATE TRIGGER trg_search_au AFTER UPDATE ON search_index BEGIN
  INSERT INTO search_fts(search_fts, rowid, title, body)
  VALUES ('delete', old.rowid_pk, old.title, old.body);
  INSERT INTO search_fts(rowid, title, body) VALUES (new.rowid_pk, new.title, new.body);
END;
