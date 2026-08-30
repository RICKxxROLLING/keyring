-- 2002_property_hero_color.sql — the Keyring hero colour, per property.
--
-- The design language gives every property a hero colour that follows it
-- everywhere it appears: sidebar key tag, card band, occupancy bar, status
-- dots, detail-page header wash. The handoff is explicit that this is
--
--   "a stored attribute of the property record (assigned when the key is cut),
--    not derived at render time — it must be stable across sessions and
--    surfaces."
--
-- That is the right call and worth stating plainly: deriving it from list
-- position or a hash of the id would mean the colours reshuffle when you
-- reorder the ring or rename a property, which destroys the whole point. The
-- colour IS the property's identity, so it lives in the row.
--
-- Stored as a raw CSS colour string rather than a palette index, so a property
-- can take a colour outside the six shipped defaults without a schema change.
-- Nullable: an un-assigned property renders with a neutral key, and the API
-- assigns one from the palette on create.
--
-- IMPORTANT: this is a NEW file, not an edit to 2001_domain.sql. Migrations are
-- immutable once applied — editing one makes runMigrations() refuse to boot on
-- a checksum mismatch, which on a live deployment presents as a boot loop.
-- See server/db/migrations.immutable.test.ts.

ALTER TABLE properties ADD COLUMN hero_color TEXT;

-- Backfill existing rows deterministically by sort_order, cycling the six
-- palette colours from the design handoff. Deterministic so that two people
-- running this migration get the same assignment, and so re-running against a
-- restored backup reproduces the same ring.
--
--   terracotta  oklch(0.665 0.125 42)
--   olive       oklch(0.655 0.085 128)
--   ochre       oklch(0.755 0.110 82)
--   brick       oklch(0.615 0.115 28)
--   sage        oklch(0.665 0.060 175)
--   heather     oklch(0.650 0.070 320)
--
-- Lightness is held at 0.61-0.76 across the palette so every hero reads
-- legibly on warm paper AND on dark slate without a per-theme variant.
UPDATE properties
SET hero_color = (
  SELECT color FROM (
    SELECT 0 AS idx, 'oklch(0.665 0.125 42)'  AS color UNION ALL
    SELECT 1,        'oklch(0.655 0.085 128)' UNION ALL
    SELECT 2,        'oklch(0.755 0.110 82)'  UNION ALL
    SELECT 3,        'oklch(0.615 0.115 28)'  UNION ALL
    SELECT 4,        'oklch(0.665 0.060 175)' UNION ALL
    SELECT 5,        'oklch(0.650 0.070 320)'
  ) palette
  WHERE palette.idx = (
    -- Position of this property in the ring, modulo the palette size.
    (SELECT COUNT(*) FROM properties p2
      WHERE p2.sort_order < properties.sort_order
         OR (p2.sort_order = properties.sort_order AND p2.id < properties.id)
    ) % 6
  )
)
WHERE hero_color IS NULL;
