-- 2003_rent_reference_expense_recurring.sql
--
-- Two fields the tracking list asked for that had nowhere to live.
--
-- 1. rent_entries.reference — "possibly a bill number or check number for
--    tracking". `method` already exists but means HOW it was paid (check, ACH,
--    cash); the reference is WHICH payment, and you need both to reconcile a
--    bank statement. Free text on purpose: check numbers, Zelle confirmations
--    and money-order stubs have nothing in common but being a string someone
--    needs to find later.
--
-- 2. property_expenses.is_recurring — "should expand info to include if its
--    recurring". Deliberately a flag rather than a full recurrence engine like
--    pm_templates: the ask is to SEE that an expense repeats (insurance,
--    landscaping, the mortgage), not to have the app generate them. A real
--    generator can come later and would supersede this without invalidating
--    the data, because the flag is a statement about the expense, not a
--    schedule.
--
--    recurrence_note carries the cadence in the words the user would say —
--    "monthly", "every spring", "quarterly, billed in arrears" — because a
--    fixed enum would be wrong for half of them.
--
-- New file, not an edit to 2001/2002: migrations are immutable once applied.
-- See server/db/migrations.immutable.test.ts.

ALTER TABLE rent_entries ADD COLUMN reference TEXT;

ALTER TABLE property_expenses ADD COLUMN is_recurring INTEGER NOT NULL DEFAULT 0;
ALTER TABLE property_expenses ADD COLUMN recurrence_note TEXT;

-- Finding "that $2,310 payment" by its check number is the whole point, and
-- the reconciling happens per property.
CREATE INDEX ix_rent_reference ON rent_entries (property_id, reference);

-- The dossier's expense list filters recurring vs one-off often enough to be
-- worth an index on a small table.
CREATE INDEX ix_expense_recurring ON property_expenses (property_id, is_recurring);
