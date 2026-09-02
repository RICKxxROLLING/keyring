-- 2007_prospect_workspace.sql
--
-- What a property you are CONSIDERING needs, which an owned one does not.
--
-- A prospect has no tenants and no maintenance queue, so those two tabs are
-- hidden on it. What it has instead is a decision in progress, and a decision
-- needs three things this schema was missing:
--
--   1. Somewhere to argue about it.  A buy is a conversation, not a form. Two
--      or three people look at the same house and come back with a list of
--      likes and dislikes, and that list is the actual artefact of deciding.
--      `property_comments` is that thread.
--
--   2. Somewhere to chase the paperwork.  "Is the septic permitted for four
--      bedrooms" and "what does the elevation certificate say" are not notes,
--      they are errands with a status: you have not asked yet, you have asked,
--      it arrived, you read it and it is fine. `diligence_items` is that list.
--
--   3. Renovation money that reaches the ledger.  That one needed no schema at
--      all — property_expenses.project_id has existed since 2001 and nothing
--      ever wrote to it. See server/domain/projects/repo.ts.
--
-- Neither table is restricted to prospects. An owned property with a long
-- discussion thread or an insurance certificate to chase is a perfectly normal
-- thing; the UI simply surfaces them where they earn their place.

-- --------------------------------------------------------------- discussion --
--
-- A flat thread, deliberately. Replies and nesting are what you build when
-- strangers are talking; three people who know each other read top to bottom.
--
-- `sentiment` is the one piece of structure worth having. Tagging a message as
-- a plus or a minus costs one click and turns a scroll-back into a pros-and-cons
-- list you can read at a glance — which is the exact question being asked of a
-- prospect. NULL is the common case: most messages are neither.
CREATE TABLE property_comments (
  id          TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  sentiment   TEXT CHECK (sentiment IS NULL OR sentiment IN ('like', 'dislike')),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  created_by  TEXT NOT NULL REFERENCES users(id),
  updated_by  TEXT NOT NULL REFERENCES users(id),
  version     INTEGER NOT NULL DEFAULT 1
);
-- Ascending: a conversation reads oldest first, unlike notes.
CREATE INDEX ix_property_comments ON property_comments (property_id, created_at);

-- ---------------------------------------------------------------- diligence --
--
-- The errand list for verifying a property before buying it.
--
-- `status` is the whole point. A checkbox would say "done" for both "the county
-- sent the permit" and "I read the permit and the bedroom count is wrong", and
-- those are opposite outcomes. So: not asked, asked, arrived, checked — plus
-- the two ways an item leaves the list without being satisfied.
--
-- `finding` is separate from `detail` for the same reason. `detail` is what to
-- go and get; `finding` is what came back. Overwriting the first with the
-- second loses the question that was being asked.
--
-- Documents attach through `upload_id` rather than a new uploads.parent_type,
-- and the upload itself is filed against the property. That is not a shortcut:
-- a septic permit IS a property document, and it should appear in Papers with
-- the deed and the survey rather than being buried behind a checklist row that
-- someone later marks not-applicable.
CREATE TABLE diligence_items (
  id          TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'other' CHECK (category IN
                ('permits', 'land', 'structure', 'financial', 'legal', 'other')),
  status      TEXT NOT NULL DEFAULT 'todo' CHECK (status IN
                ('todo', 'requested', 'received', 'verified', 'blocked', 'not_applicable')),
  -- What to ask for, and who from.
  detail      TEXT,
  -- What it said once it arrived.
  finding     TEXT,
  source_url  TEXT,
  due_date    TEXT,
  assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  upload_id   TEXT REFERENCES uploads(id) ON DELETE SET NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  created_by  TEXT NOT NULL REFERENCES users(id),
  updated_by  TEXT NOT NULL REFERENCES users(id),
  version     INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_diligence_property ON diligence_items (property_id, sort_order, created_at);
CREATE INDEX ix_diligence_due ON diligence_items (status, due_date);

-- The ledger tie for renovation spend. project_id already exists on
-- property_expenses; this is the index that makes rolling a project's actual
-- cost up out of the ledger cheap enough to do on every dossier load.
CREATE INDEX ix_expenses_project ON property_expenses (project_id);
