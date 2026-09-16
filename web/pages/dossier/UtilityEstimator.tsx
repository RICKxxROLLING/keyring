import type { ReactElement } from "react";
import type { DealInputs } from "../../../shared/deal-analysis";
import { estimateUtilities, type UtilityPayer } from "../../../shared/utility-estimate";
import { formatCents } from "../../lib/format";
import { Field, Select } from "../../components/Form";
import { MoneyInput } from "../../components/NumericInput";

const PAYERS: { value: UtilityPayer; label: string }[] = [
  { value: "tenant_utilities", label: "Long-term — tenant pays electric & internet" },
  { value: "owner_all", label: "Furnished / vacation — owner pays everything" },
  { value: "tenant_all", label: "Tenant pays every bill" },
];

/**
 * Utilities, estimated from the house or entered by hand.
 *
 * The estimate is the default for a reason specific to this page: plan B
 * usually changes the bedroom count, and a figure typed once would not follow
 * it. On "estimate" the number is recomputed for whichever plan is on screen.
 *
 * Every bill is listed, including the ones the tenant pays, and those are shown
 * but not counted. Hiding them would make a long-term let look cheaper to run
 * than the house actually is, which matters the day it sits empty.
 */
export function UtilityEstimator(props: {
  inputs: DealInputs;
  postalCode: string | null;
  onChange: (change: Partial<DealInputs>) => void;
}): ReactElement {
  const { inputs } = props;
  const estimate = estimateUtilities(inputs, props.postalCode);
  const auto = inputs.utilitiesAuto;
  const someUnknown = estimate.lines.some((l) => l.unknown && l.ownerPays);

  return (
    <div style={{ gridColumn: "1 / -1", display: "grid", gap: 10 }}>
      <div style={{ display: "flex", gap: 6 }} role="group" aria-label="How to set utilities">
        {([
          [true, "Estimate from the house"],
          [false, "Enter my own"],
        ] as const).map(([value, label]) => (
          <button
            key={label}
            type="button"
            aria-pressed={auto === value}
            onClick={() =>
              props.onChange(
                value
                  ? { utilitiesAuto: true }
                  : // Switching to manual starts from the estimate, not from
                    // zero or a stale figure — the number on screen stays put.
                    { utilitiesAuto: false, monthlyUtilitiesCents: estimate.ownerMonthlyCents },
              )
            }
            style={{
              flex: 1,
              padding: "7px 10px",
              borderRadius: 10,
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
              border: `1px solid ${auto === value ? "var(--ink-3)" : "var(--line)"}`,
              background: auto === value ? "var(--panel-2)" : "var(--panel)",
              color: "var(--ink)",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {auto ? (
        <>
          <Field label="Who pays the bills">
            <Select
              value={inputs.utilityPayer}
              onChange={(e) => props.onChange({ utilityPayer: e.target.value as UtilityPayer })}
            >
              {PAYERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>

          <div
            role="table"
            aria-label="Estimated utilities"
            style={{ border: "1px solid var(--line)", borderRadius: 11, overflow: "hidden" }}
          >
            {estimate.lines.map((l) => (
              <div
                key={l.key}
                role="row"
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: "2px 10px",
                  padding: "7px 10px",
                  borderTop: "1px solid var(--line-soft)",
                  opacity: l.ownerPays ? 1 : 0.55,
                }}
              >
                <span role="cell" style={{ fontSize: 13, fontWeight: 600 }}>
                  {l.label}
                  <span className="kr-label" style={{ marginLeft: 6, fontSize: 8.5 }}>
                    {l.ownerPays ? "owner" : "tenant"}
                  </span>
                </span>
                <span
                  role="cell"
                  className="kr-tabular"
                  style={{
                    fontSize: 13,
                    textAlign: "right",
                    color: l.unknown ? "var(--warn)" : "var(--ink)",
                  }}
                >
                  {l.unknown ? "not known" : formatCents(l.monthlyCents)}
                </span>
                <span role="cell" style={{ gridColumn: "1 / -1", fontSize: 11, color: "var(--ink-3)" }}>
                  {l.basis}
                </span>
              </div>
            ))}
            <div
              role="row"
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "8px 10px",
                borderTop: "1px solid var(--line)",
                background: "var(--panel-2)",
                fontWeight: 700,
                fontSize: 13.5,
              }}
            >
              <span role="cell">Owner pays / mo</span>
              <span role="cell" className="kr-tabular">
                {formatCents(estimate.ownerMonthlyCents)}
              </span>
            </div>
          </div>

          <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.5, color: "var(--ink-3)" }}>
            {estimate.occupants} people for {inputs.bedrooms} bedroom
            {inputs.bedrooms === 1 ? "" : "s"}, rates for {estimate.rates.label}. {estimate.rates.note}
            {someUnknown &&
              " A bill marked “not known” counts as $0 — switch to “Enter my own” to include it."}
          </p>
        </>
      ) : (
        <Field
          label="Utilities / other / mo"
          hint={`The estimate for this house would be ${formatCents(estimate.ownerMonthlyCents)}.`}
        >
          <MoneyInput
            valueCents={inputs.monthlyUtilitiesCents}
            onChange={(v) => props.onChange({ monthlyUtilitiesCents: v })}
          />
        </Field>
      )}
    </div>
  );
}
