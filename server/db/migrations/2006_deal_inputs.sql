-- 2006_deal_inputs.sql
--
-- "invest.hireclan.org is a calculator for seeing if a property is profitable.
-- I want to merge the two sites into one — maybe a new section that is only on
-- a prospective property."
--
-- One row per property, holding ONLY the inputs.
--
-- Nothing computed is stored: not cap rate, not cash-on-cash, not the ten-year
-- projection. Those are functions of these columns, so a stored copy would go
-- stale the moment an assumption changed and there would be no way to tell
-- which number was current. Same reasoning that makes hero_color stored (it is
-- identity, and must survive a rename) and this derived (it is arithmetic, and
-- must not survive an edit). See shared/deal-analysis.ts.
--
-- Money is in cents like every other money column in this schema. Percentages
-- are REAL because rates genuinely have fractions — Dare County's effective
-- rate is 0.5432%, and rounding it to a whole number moves the annual tax by
-- hundreds of dollars.
--
-- property_id is the primary key: a property has one working analysis, and
-- alternatives are explored by editing it rather than accumulating a pile of
-- near-identical scenarios nobody can tell apart later.

CREATE TABLE property_deal_inputs (
  property_id             TEXT PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,

  -- purchase
  price_cents             INTEGER NOT NULL DEFAULT 0,
  closing_costs_cents     INTEGER NOT NULL DEFAULT 0,
  rehab_cents             INTEGER NOT NULL DEFAULT 0,
  -- NULL means "derive from price, rehab and arv_mode".
  arv_cents               INTEGER,
  arv_mode                TEXT NOT NULL DEFAULT 'fixed'
                            CHECK (arv_mode IN ('fixed','conservative','aggressive')),

  -- financing
  down_payment_mode       TEXT NOT NULL DEFAULT 'percent'
                            CHECK (down_payment_mode IN ('percent','amount')),
  down_payment            REAL NOT NULL DEFAULT 20,
  interest_rate_pct       REAL NOT NULL DEFAULT 7,
  term_years              INTEGER NOT NULL DEFAULT 30,
  finance_costs           INTEGER NOT NULL DEFAULT 1 CHECK (finance_costs IN (0,1)),

  -- income
  monthly_rent_cents      INTEGER NOT NULL DEFAULT 0,
  monthly_other_income_cents INTEGER NOT NULL DEFAULT 0,
  vacancy_pct             REAL NOT NULL DEFAULT 8,

  -- operating expenses
  tax_rate_pct            REAL NOT NULL DEFAULT 0.5432,
  -- NULL means build it from the three coastal fields below.
  insurance_annual_cents  INTEGER,
  base_hazard_cents       INTEGER NOT NULL DEFAULT 180000,
  wind_per_sqft_cents     INTEGER NOT NULL DEFAULT 130,
  flood_annual_cents      INTEGER NOT NULL DEFAULT 250000,
  sqft                    INTEGER NOT NULL DEFAULT 0,
  monthly_hoa_cents       INTEGER NOT NULL DEFAULT 0,
  monthly_utilities_cents INTEGER NOT NULL DEFAULT 0,
  maintenance_pct         REAL NOT NULL DEFAULT 5,
  capex_pct               REAL NOT NULL DEFAULT 5,
  management_pct          REAL NOT NULL DEFAULT 10,

  -- tax treatment
  tax_bracket_pct         REAL NOT NULL DEFAULT 24,
  land_pct                REAL NOT NULL DEFAULT 20,

  -- projection assumptions
  appreciation_pct        REAL NOT NULL DEFAULT 3,
  rent_growth_pct         REAL NOT NULL DEFAULT 2,
  expense_growth_pct      REAL NOT NULL DEFAULT 3,
  selling_cost_pct        REAL NOT NULL DEFAULT 6,

  -- Which column the verdict is judged on. Two people can disagree about
  -- whether to finance, and the headline changes completely between them.
  scenario                TEXT NOT NULL DEFAULT 'financed'
                            CHECK (scenario IN ('financed','cash')),

  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL,
  created_by              TEXT NOT NULL REFERENCES users(id),
  updated_by              TEXT NOT NULL REFERENCES users(id),
  version                 INTEGER NOT NULL DEFAULT 1
);
