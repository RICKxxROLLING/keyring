-- 2011_deal_build.sql
--
-- "An option in the numbers model for a property or lot bought for land only,
-- with a unit built on it new. It needs the cost of building in $/sqft and the
-- land price, and then how many units on the land are needed to make a profit
-- — so rent per unit as well."
--
-- deal_kind says which of the two the analysis is. Every existing row is a
-- 'buy', which is what they all were, so nothing saved changes its numbers.
--
-- The land price is the existing price_cents: on a build, the thing you pay the
-- seller for IS the land, and keeping one price column means the "what it's
-- worth paying" solver answers "what the land is worth paying" with no second
-- code path. Construction is costed per square foot of finished unit, times
-- the unit size, times the count — the three things a builder quotes and the
-- one (the count) the question is about.
--
-- The defaults describe one 1,200 sq ft unit at $250/sq ft. They only take
-- effect once someone switches an analysis to 'build', and are on screen to be
-- replaced with a real quote.

ALTER TABLE property_deal_inputs ADD COLUMN deal_kind TEXT NOT NULL DEFAULT 'buy'
  CHECK (deal_kind IN ('buy', 'build'));
ALTER TABLE property_deal_inputs ADD COLUMN build_cost_per_sqft_cents INTEGER NOT NULL DEFAULT 25000;
ALTER TABLE property_deal_inputs ADD COLUMN unit_sqft INTEGER NOT NULL DEFAULT 1200;
ALTER TABLE property_deal_inputs ADD COLUMN unit_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE property_deal_inputs ADD COLUMN rent_per_unit_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE property_deal_inputs ADD COLUMN site_work_cents INTEGER NOT NULL DEFAULT 0;
