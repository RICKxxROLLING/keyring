import { useState, type ReactElement, type ReactNode } from "react";
import type { DealInputs, DealScenario, ScenarioResult } from "../../../shared/deal-analysis";
import { compareScenarios, type DealOverrides } from "../../../shared/deal-compare";
import { formatCents } from "../../lib/format";
import { Button } from "../../components/Button";
import { TextInput } from "../../components/Form";
import { hero } from "../../components/KeyGlyph";

/**
 * Plan A against plan B on the numbers tab.
 *
 * The question these answer is narrower than "which plan looks better", which B
 * nearly always does — it is the one with more rent. It is whether the EXTRA
 * money B needs earns its keep: how much more goes in, how much more comes
 * back, and how long before the extra is repaid. So the comparison leads with
 * the increment, and the two plans' own figures sit underneath for reference.
 */

/** Plan B as edited locally: a name and the fields that differ from A. */
export interface PlanB {
  label: string;
  overrides: DealOverrides;
}

/* ----------------------------------------------------------------- switch -- */

/**
 * Which plan the page is showing, and the controls to start or drop B.
 *
 * Full width above everything, because it changes what EVERY figure on the page
 * refers to. A switch tucked inside the inputs column would let you read B's
 * cash flow believing it was A's.
 */
export function PlanSwitch(props: {
  color: string | null;
  editing: "a" | "b";
  planB: PlanB | null;
  onEdit: (plan: "a" | "b") => void;
  onCreate: (label: string) => void;
  onRename: (label: string) => void;
  onRemove: () => void;
  removing: boolean;
}): ReactElement {
  const [naming, setNaming] = useState(false);
  const [draft, setDraft] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const { color, editing, planB } = props;

  if (!planB) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          marginBottom: 18,
          padding: "10px 14px",
          borderRadius: 13,
          border: "1px dashed var(--line)",
          background: "var(--panel-2)",
        }}
      >
        {naming ? (
          <>
            <div style={{ flex: 1, minWidth: 200 }}>
              <TextInput
                autoFocus
                aria-label="Name plan B"
                value={draft}
                placeholder="Add a bedroom"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    props.onCreate(draft.trim() || "Add a bedroom");
                    setNaming(false);
                  }
                }}
              />
            </div>
            <Button
              type="button"
              onClick={() => {
                props.onCreate(draft.trim() || "Add a bedroom");
                setNaming(false);
              }}
            >
              Start plan B
            </Button>
            <Button type="button" variant="secondary" onClick={() => setNaming(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <span style={{ flex: 1, minWidth: 220, fontSize: 13, color: "var(--ink-2)" }}>
              Weighing a change — adding a bedroom, a different layout? Compare it against these
              numbers as plan B.
            </span>
            <Button type="button" variant="secondary" onClick={() => setNaming(true)}>
              + Compare a plan B
            </Button>
          </>
        )}
      </div>
    );
  }

  const tab = (plan: "a" | "b", title: string, sub: string): ReactElement => {
    const on = editing === plan;
    return (
      <button
        type="button"
        aria-pressed={on}
        onClick={() => props.onEdit(plan)}
        style={{
          flex: 1,
          minWidth: 150,
          textAlign: "left",
          padding: "10px 14px",
          borderRadius: 12,
          cursor: "pointer",
          border: `1px solid ${on ? hero.border(color, 0.55) : "var(--line)"}`,
          background: on ? hero.tint(color, 16) : "var(--panel)",
          color: "var(--ink)",
        }}
      >
        <span className="kr-label" style={{ display: "block", fontSize: 9 }}>
          {title}
        </span>
        <span style={{ display: "block", fontSize: 14, fontWeight: 600, marginTop: 2 }}>{sub}</span>
      </button>
    );
  };

  return (
    <div style={{ marginBottom: 18 }}>
      <div role="group" aria-label="Which plan to show" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {tab("a", "Plan A", "Current numbers")}
        {tab("b", "Plan B", planB.label || "Plan B")}
      </div>

      {editing === "b" && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            marginTop: 10,
            padding: "10px 14px",
            borderRadius: 12,
            background: hero.tint(color, 8),
            border: `1px solid ${hero.border(color, 0.3)}`,
          }}
        >
          <span style={{ flex: 1, minWidth: 220, fontSize: 12.5, color: "var(--ink-2)" }}>
            <strong>Editing plan B.</strong> Anything you change here applies to B only; everything
            you leave alone follows plan A — including the price.
          </span>
          <div style={{ width: 200 }}>
            <TextInput
              aria-label="Plan B name"
              value={planB.label}
              onChange={(e) => props.onRename(e.target.value)}
            />
          </div>
          {confirmRemove ? (
            <>
              <Button
                type="button"
                variant="danger"
                onClick={() => {
                  setConfirmRemove(false);
                  props.onRemove();
                }}
                disabled={props.removing}
              >
                {props.removing ? "Removing…" : "Yes, remove B"}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setConfirmRemove(false)}>
                Keep it
              </Button>
            </>
          ) : (
            <Button type="button" variant="secondary" onClick={() => setConfirmRemove(true)}>
              Remove plan B
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- comparison -- */

type Kind = "money" | "pct" | "count" | "sqft" | "bool" | "text";

/**
 * How to name and print each input when listing what B changes. Every key of
 * DealInputs is here: an override with no entry would be a change B makes that
 * the comparison cannot show you.
 */
const FIELDS: Record<keyof DealInputs, { label: string; kind: Kind }> = {
  priceCents: { label: "Purchase price", kind: "money" },
  closingCostsCents: { label: "Closing costs", kind: "money" },
  rehabCents: { label: "Upfront repairs", kind: "money" },
  arvCents: { label: "After-repair value", kind: "money" },
  arvMode: { label: "After-repair value basis", kind: "text" },
  downPaymentMode: { label: "Down payment in", kind: "text" },
  downPayment: { label: "Down payment", kind: "count" },
  interestRatePct: { label: "Interest rate", kind: "pct" },
  termYears: { label: "Loan term (years)", kind: "count" },
  financeCosts: { label: "Roll costs into the loan", kind: "bool" },
  monthlyRentCents: { label: "Monthly rent", kind: "money" },
  monthlyOtherIncomeCents: { label: "Other income / mo", kind: "money" },
  vacancyPct: { label: "Vacancy", kind: "pct" },
  taxRatePct: { label: "Property tax rate", kind: "pct" },
  insuranceAnnualCents: { label: "Insurance / yr", kind: "money" },
  baseHazardCents: { label: "Base hazard insurance", kind: "money" },
  windPerSqftCents: { label: "Wind per sq ft", kind: "money" },
  floodAnnualCents: { label: "Flood insurance", kind: "money" },
  sqft: { label: "Square feet", kind: "sqft" },
  monthlyHoaCents: { label: "HOA / mo", kind: "money" },
  monthlyUtilitiesCents: { label: "Utilities / mo", kind: "money" },
  maintenancePct: { label: "Repairs & maintenance", kind: "pct" },
  capexPct: { label: "CapEx reserve", kind: "pct" },
  managementPct: { label: "Management", kind: "pct" },
  taxBracketPct: { label: "Income tax bracket", kind: "pct" },
  landPct: { label: "Land share", kind: "pct" },
  appreciationPct: { label: "Appreciation", kind: "pct" },
  rentGrowthPct: { label: "Rent increase / yr", kind: "pct" },
  expenseGrowthPct: { label: "Expense growth", kind: "pct" },
  sellingCostPct: { label: "Selling costs", kind: "pct" },
};

function show(key: keyof DealInputs, value: unknown, inputs: DealInputs): string {
  const { kind } = FIELDS[key];
  if (value === null) return key === "arvCents" ? "derived" : key === "insuranceAnnualCents" ? "coastal build-up" : "—";
  if (key === "downPayment") {
    return inputs.downPaymentMode === "percent" ? `${String(value)}%` : formatCents(value as number);
  }
  switch (kind) {
    case "money":
      return formatCents(value as number);
    case "pct":
      return `${String(value)}%`;
    case "sqft":
      return `${(value as number).toLocaleString("en-US")} sq ft`;
    case "bool":
      return value ? "yes" : "no";
    default:
      return String(value);
  }
}

/** A signed dollar figure: "+$6,000" / "−$1,200". */
function signed(cents: number): string {
  if (cents === 0) return formatCents(0);
  return `${cents > 0 ? "+" : "−"}${formatCents(Math.abs(cents))}`;
}

export function PlanComparison(props: {
  scenario: DealScenario;
  planA: DealInputs;
  planB: PlanB;
  a: ScenarioResult;
  b: ScenarioResult;
  onReset: (key: keyof DealInputs) => void;
}): ReactElement {
  const { a, b, planA, planB } = props;
  const c = compareScenarios(a, b);
  const bInputs = { ...planA, ...planB.overrides };
  const changed = (Object.keys(planB.overrides) as (keyof DealInputs)[]).filter((k) => k in FIELDS);

  const tone =
    c.verdict === "b_better"
      ? { fg: "var(--ok)", bg: "var(--ok-fill)", label: "B comes out ahead" }
      : c.verdict === "a_better"
        ? { fg: "var(--crit)", bg: "var(--crit-fill)", label: "A comes out ahead" }
        : { fg: "var(--warn)", bg: "var(--warn-fill)", label: "About even" };

  return (
    <section
      aria-label="Plan A against plan B"
      style={{
        border: `1px solid ${tone.fg}`,
        borderRadius: 14,
        background: "var(--panel)",
        overflow: "hidden",
      }}
    >
      <div style={{ padding: "12px 16px", background: tone.bg }}>
        <span className="kr-label" style={{ display: "block", fontSize: 9, color: tone.fg }}>
          A vs B · {planB.label || "Plan B"} · {props.scenario === "financed" ? "financed" : "all cash"}
        </span>
        <span style={{ display: "block", fontSize: 14.5, fontWeight: 600, marginTop: 3 }}>
          {tone.label}. {c.verdictLine}
        </span>
      </div>

      <div style={{ padding: "14px 16px 16px" }}>
        {changed.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: "var(--ink-2)" }}>
            Plan B is identical to A so far. Switch to <strong>Plan B</strong> above and change what
            the plan changes — the extra repairs, the higher rent, the bigger square footage for the
            wind premium.
          </p>
        ) : (
          <>
            {/* The increment: what B's extra money buys. */}
            <div
              style={{
                display: "grid",
                gap: 10,
                gridTemplateColumns: "repeat(auto-fit, minmax(min(150px, 100%), 1fr))",
              }}
            >
              <Figure label="Extra cash up front" value={signed(c.extraInvestedCents)} />
              <Figure
                label="Extra cash flow"
                value={`${signed(c.extraMonthlyCashFlowCents)}/mo`}
                tone={c.extraMonthlyCashFlowCents >= 0 ? "ok" : "bad"}
              />
              <Figure
                label="Extra rent repays it in"
                value={
                  c.paybackYears === null
                    ? "Not in 10 yrs"
                    : c.paybackYears === 0
                      ? "Nothing to repay"
                      : `${c.paybackYears.toFixed(1)} yrs`
                }
                tone={c.paybackYears === null ? "bad" : "ok"}
              />
              <Figure
                label="Return on the extra"
                value={c.returnOnExtraPct === null ? "—" : `${c.returnOnExtraPct.toFixed(1)}%`}
                note="yr-1 extra cash flow ÷ extra cash"
              />
              <Figure
                label="10-year profit"
                value={signed(c.extraTotalProfitCents)}
                note="incl. sale"
                tone={c.extraTotalProfitCents >= 0 ? "ok" : "bad"}
              />
              <Figure
                label="IRR"
                value={
                  c.irrDeltaPts === null
                    ? "—"
                    : `${c.irrDeltaPts >= 0 ? "+" : "−"}${Math.abs(c.irrDeltaPts).toFixed(1)} pts`
                }
                tone={c.irrDeltaPts === null ? undefined : c.irrDeltaPts >= 0 ? "ok" : "bad"}
              />
            </div>

            {/* Both plans, for reference. */}
            <div className="kr-scroll-x" style={{ marginTop: 14 }}>
              <table style={{ width: "100%", minWidth: 340, borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    <Th />
                    <Th align="right">A</Th>
                    <Th align="right">B</Th>
                  </tr>
                </thead>
                <tbody>
                  <Line label="Cash invested" a={formatCents(a.investedCents)} b={formatCents(b.investedCents)} />
                  <Line
                    label="Monthly cash flow"
                    a={formatCents(a.monthlyCashFlowCents)}
                    b={formatCents(b.monthlyCashFlowCents)}
                  />
                  <Line
                    label="Cash-on-cash"
                    a={`${a.cashOnCashPct.toFixed(1)}%`}
                    b={`${b.cashOnCashPct.toFixed(1)}%`}
                  />
                  <Line label="Cap rate" a={`${a.capRatePct.toFixed(1)}%`} b={`${b.capRatePct.toFixed(1)}%`} />
                  <Line
                    label="10-year profit"
                    a={formatCents(a.totalProfitCents)}
                    b={formatCents(b.totalProfitCents)}
                  />
                  <Line
                    label="IRR"
                    a={a.irrPct === null ? "—" : `${a.irrPct.toFixed(1)}%`}
                    b={b.irrPct === null ? "—" : `${b.irrPct.toFixed(1)}%`}
                  />
                </tbody>
              </table>
            </div>

            {/* What B actually changes, so a surprising result can be traced. */}
            <h4 className="kr-label" style={{ margin: "16px 0 6px", fontSize: 9.5 }}>
              What plan B changes
            </h4>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
              {changed.map((key) => (
                <li
                  key={key}
                  style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, flexWrap: "wrap" }}
                >
                  <span style={{ flex: 1, minWidth: 140, color: "var(--ink-2)" }}>{FIELDS[key].label}</span>
                  <span className="kr-tabular" style={{ color: "var(--ink-3)" }}>
                    {show(key, planA[key], planA)}
                  </span>
                  <span aria-hidden="true" style={{ color: "var(--ink-3)" }}>
                    →
                  </span>
                  <span className="kr-tabular" style={{ fontWeight: 600 }}>
                    {show(key, planB.overrides[key], bInputs)}
                  </span>
                  <button
                    type="button"
                    className="kr-quiet-action"
                    onClick={() => props.onReset(key)}
                    aria-label={`Put ${FIELDS[key].label} back to plan A`}
                  >
                    Use A&apos;s
                  </button>
                </li>
              ))}
            </ul>

            {/* The one assumption most likely to flatter B. */}
            {bInputs.arvCents === null && bInputs.arvMode === "fixed" && (planB.overrides.rehabCents ?? 0) > planA.rehabCents && (
              <p style={{ margin: "12px 0 0", fontSize: 12, lineHeight: 1.5, color: "var(--ink-3)" }}>
                B&apos;s resale value is price + repairs, so every renovation dollar is assumed to come
                back at sale. If a fourth bedroom would not add that much to what this house sells
                for, set B&apos;s after-repair value manually — the 10-year figure depends on it; the
                payback does not.
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function Figure(props: { label: string; value: string; note?: string; tone?: "ok" | "bad" }): ReactElement {
  return (
    <div style={{ padding: "10px 12px", borderRadius: 11, background: "var(--panel-2)" }}>
      <span className="kr-label" style={{ display: "block", fontSize: 9 }}>
        {props.label}
      </span>
      <span
        className="kr-tabular"
        style={{
          display: "block",
          marginTop: 4,
          fontSize: 17,
          fontWeight: 600,
          color: props.tone === "ok" ? "var(--ok)" : props.tone === "bad" ? "var(--crit)" : "var(--ink)",
        }}
      >
        {props.value}
      </span>
      {props.note && (
        <span style={{ display: "block", fontSize: 11, color: "var(--ink-3)", marginTop: 2 }}>{props.note}</span>
      )}
    </div>
  );
}

function Th(props: { children?: ReactNode; align?: "right" }): ReactElement {
  return (
    <th
      className="kr-label"
      style={{ textAlign: props.align ?? "left", fontSize: 9, padding: "4px 6px", fontWeight: 500 }}
    >
      {props.children}
    </th>
  );
}

function Line(props: { label: string; a: string; b: string }): ReactElement {
  return (
    <tr style={{ borderTop: "1px solid var(--line-soft)" }}>
      <td style={{ padding: "6px", color: "var(--ink-2)" }}>{props.label}</td>
      <td className="kr-tabular" style={{ padding: "6px", textAlign: "right" }}>
        {props.a}
      </td>
      <td className="kr-tabular" style={{ padding: "6px", textAlign: "right", fontWeight: 600 }}>
        {props.b}
      </td>
    </tr>
  );
}
