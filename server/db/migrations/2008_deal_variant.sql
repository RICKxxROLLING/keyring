-- 2008_deal_variant.sql
--
-- "An A/B comparison of two different scenarios — to see if doing a renovation
-- to add a bedroom could be worth the extra upfront cost to increase rent."
--
-- 2006 deliberately allowed ONE analysis per property, on the grounds that
-- alternatives explored as a pile of near-identical scenarios become impossible
-- to tell apart. That still holds, so this adds exactly one alternative: plan
-- B. Two is a comparison. Five is the pile.
--
-- B is stored as OVERRIDES of A — a JSON object holding only the fields that
-- differ — not as a second full row of inputs. The question is always "this
-- house, with a change", and a full copy would keep A's old purchase price the
-- moment A's was edited, quietly turning the comparison into two different
-- houses. See shared/deal-compare.ts.
--
-- JSON rather than a column per input because B changes two or three fields
-- out of thirty; a mirror of property_deal_inputs would be thirty nullable
-- columns that are almost always NULL, and would need a migration every time
-- an input is added to the analyzer. The JSON is validated against the same
-- schema as A on every write, and re-validated on read.
--
-- Deleting B is a real delete, not an archive: the audit log records what it
-- was, and a discarded plan kept around is exactly the pile 2006 avoided.

CREATE TABLE property_deal_variants (
  property_id TEXT PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  overrides   TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  created_by  TEXT NOT NULL REFERENCES users(id),
  updated_by  TEXT NOT NULL REFERENCES users(id),
  version     INTEGER NOT NULL DEFAULT 1
);
