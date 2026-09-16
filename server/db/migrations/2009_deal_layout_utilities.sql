-- 2009_deal_layout_utilities.sql
--
-- "Include bedroom and bathroom count, and build in an automated utility
-- calculator based on typical usage of renters and the local rates."
--
-- Bedrooms and bathrooms are inputs to the analysis rather than read live from
-- the property's units, because the point of having them here is that plan B
-- can change them. A property's units describe the house as it is; an analysis
-- is allowed to describe it as it might be.
--
-- Existing rows get utilities_auto = 0. They were saved with a utilities figure
-- somebody typed, and switching them to an estimate on upgrade would change a
-- saved analysis's cash flow without anyone touching it. New analyses start on
-- the estimate (see defaultDealInputs).
--
-- The 3-bed / 2-bath default on existing rows only sizes the estimate, which
-- those rows are not using until someone turns it on — at which point the
-- counts are right there on the screen to correct.
--
-- utility_payer is stored as the chosen arrangement, not as per-bill flags:
-- the three arrangements are how the question is actually decided, and a set
-- of five independent booleans invites combinations nobody has.

ALTER TABLE property_deal_inputs ADD COLUMN bedrooms INTEGER NOT NULL DEFAULT 3;
ALTER TABLE property_deal_inputs ADD COLUMN bathrooms REAL NOT NULL DEFAULT 2;
ALTER TABLE property_deal_inputs ADD COLUMN utilities_auto INTEGER NOT NULL DEFAULT 0
  CHECK (utilities_auto IN (0, 1));
ALTER TABLE property_deal_inputs ADD COLUMN utility_payer TEXT NOT NULL DEFAULT 'tenant_utilities'
  CHECK (utility_payer IN ('tenant_utilities', 'owner_all', 'tenant_all'));
