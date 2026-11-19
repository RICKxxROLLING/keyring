-- 2012_deal_build_stories.sql
--
-- "A 4,000 sq ft condo building at $250 a sq ft — over a million dollars —
-- seems very high. My guess is there's some type of discount in price per
-- square foot when building up."
--
-- There is. The foundation and the roof are sized by the building's footprint,
-- not its floor area, so stacking units three high puts three floors on one
-- foundation and under one roof. `stories` records how many floors the units
-- are stacked on, and the build cost per sq ft is now read as the one-story
-- rate, discounted for stacking — see storyFactor in shared/deal-analysis.ts.
--
-- Three is the most: past that a building leaves light wood-frame residential
-- construction, and its costs are a builder's to quote, not this model's.
--
-- Existing rows get 1, which is exactly the arithmetic they were saved with:
-- one story is no discount. Nothing saved moves until someone says the
-- building is taller.

ALTER TABLE property_deal_inputs ADD COLUMN stories INTEGER NOT NULL DEFAULT 1
  CHECK (stories BETWEEN 1 AND 3);
