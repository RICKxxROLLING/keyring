import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPut } from "../../lib/api";
import { useDossier } from "../../lib/dossier-context";
import { formatCents } from "../../lib/format";
import { Button } from "../../components/Button";
import { Field, Select, Spinner, TextInput } from "../../components/Form";
import { hero } from "../../components/KeyGlyph";
import {
  analyzeDeal,
  FLOOD_ZONE_ANNUAL_CENTS,
  maxPriceForCashFlow,
  rentNeededForCashFlow,
  type DealAnalysis,
  type DealInputs,
  type DealScenario,
} from "../../../shared/deal-analysis";

interface DealPayload {
  inputs: DealInputs;
  scenario: DealScenario;
  version: number;
  saved: boolean;
  analysis: DealAnalysis;
}

/**
 * Will this one make money?
 *
 * Laid out as the original analyzer was, because that shape is right for the
 * task: assumptions down the left, consequences down the right, so you change a
 * number and watch the answer move without either column jumping. On a phone
 * the two stack and the answers come FIRST — you open this to see where you
 * stand, not to fill in a form.
 *
 * Everything recomputes locally on each keystroke. It is pure arithmetic on
 * data already in the browser, so a round trip to see what half a point of
 * interest does would be the wrong shape entirely. The server recomputes
 * independently on save, and its copy is the one of record.
 */
export function DealTab(): ReactElement {
  const dossier = useDossier();
  const propertyId = dossier.property.id;
  const color = dossier.property.heroColor;
  const queryClient = useQueryClient();

  const saved = useQuery({
    queryKey: ["deal", propertyId],
    queryFn: () => apiGet<DealPayload>(`/api/properties/${propertyId}/deal`),
  });

  const [inputs, setInputs] = useState<DealInputs | null>(null);
  const [scenario, setScenario] = useState<DealScenario>("financed");
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (saved.data && inputs === null) {
      setInputs(saved.data.inputs);
      setScenario(saved.data.scenario);
      setVersion(saved.data.version);
    }
  }, [saved.data, inputs]);

  const save = useMutation({
    mutationFn: () =>
      apiPut<DealPayload>(`/api/properties/${propertyId}/deal`, {
        ...inputs,
        scenario,
        ...(version > 0 ? { expectedVersion: version } : {}),
      }),
    onSuccess: (data) => {
      setVersion(data.version);
      void queryClient.invalidateQueries({ queryKey: ["deal", propertyId] });
    },
  });

  if (saved.isLoading || !inputs) return <Spinner />;

  function set<K extends keyof DealInputs>(key: K, value: DealInputs[K]): void {
    setInputs((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  const analysis = analyzeDeal(inputs, scenario);
  const r = scenario === "financed" ? analysis.financed : analysis.cash;
  const other = scenario === "financed" ? analysis.cash : analysis.financed;

  const breakEven = maxPriceForCashFlow(inputs, 0, scenario);
  const plus100 = maxPriceForCashFlow(inputs, 100_00, scenario);
  const plus200 = maxPriceForCashFlow(inputs, 200_00, scenario);
  const rentNeeded = rentNeededForCashFlow(inputs, 0, scenario);

  const tone =
    analysis.verdict === "profitable"
      ? { fg: "var(--ok)", bg: "var(--ok-fill)", glyph: "✓", label: "Profitable" }
      : analysis.verdict === "negative"
        ? { fg: "var(--bad)", bg: "var(--bad-fill)", glyph: "✕", label: "Negative" }
        : { fg: "var(--warn)", bg: "var(--warn-fill)", glyph: "!", label: "Marginal" };

  const coastal = inputs.insuranceAnnualCents === null;
  const windCents = inputs.sqft * inputs.windPerSqftCents;

  return (
    <div>
      {/* Answers left of centre on desktop, first on mobile — see the note above. */}
      <div className="kr-deal-grid">
        <div className="kr-deal-answers">
          <div
            role="status"
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 10,
              flexWrap: "wrap",
              padding: "12px 16px",
              borderRadius: 13,
              background: tone.bg,
              border: `1px solid ${tone.fg}`,
            }}
          >
            <span aria-hidden="true" style={{ color: tone.fg, fontWeight: 700 }}>
              {tone.glyph}
            </span>
            <span className="kr-label" style={{ fontSize: 9, color: tone.fg }}>
              {tone.label}
            </span>
            <span style={{ fontSize: 14.5, fontWeight: 600 }}>{analysis.verdictLine}</span>
          </div>

          <div style={{ display: "flex", gap: 6 }}>
            {(["financed", "cash"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setScenario(s)}
                aria-pressed={scenario === s}
                style={{
                  flex: 1,
                  padding: "9px 12px",
                  borderRadius: 11,
                  fontSize: 13.5,
                  fontWeight: 600,
                  border: `1px solid ${scenario === s ? hero.border(color, 0.45) : "var(--line)"}`,
                  background: scenario === s ? hero.tint(color, 14) : "var(--panel)",
                  color: "var(--ink)",
                }}
              >
                {s === "financed" ? "Financed (mortgage)" : "All cash"}
              </button>
            ))}
          </div>

          <Panel title={`What it's worth paying — ${scenario === "financed" ? "financed" : "all cash"}`}>
            <Grid>
              <Stat
                label="Break even ($0/mo)"
                value={breakEven === null ? "—" : formatCents(breakEven)}
                note="highest price that doesn't lose money"
              />
              <Stat
                label="Target +$100/mo"
                value={plus100 === null ? "—" : formatCents(plus100)}
                note="modest positive cash flow"
                tone={plus100 === null ? undefined : "ok"}
              />
              <Stat
                label="Target +$200/mo"
                value={plus200 === null ? "—" : formatCents(plus200)}
                note="healthy buffer — recommended"
                tone={plus200 === null ? undefined : "ok"}
              />
              <Stat
                label="Rent needed at asking"
                value={rentNeeded === null ? "—" : `${formatCents(rentNeeded)}/mo`}
                note="to break even at the current price"
              />
            </Grid>
            {plus200 !== null && (
              <Button
                variant="secondary"
                onClick={() => set("priceCents", plus200)}
                style={{ marginTop: 12 }}
              >
                Use the +$200/mo price
              </Button>
            )}
            <Note>
              Solves for price holding rent, size, insurance and loan terms fixed. A bigger house
              carries more wind premium, which lowers what you can afford. All cash supports a
              higher price — switch above to compare.
            </Note>
          </Panel>

          <Panel title={`Year one — ${scenario === "financed" ? "financed" : "all cash"}`}>
            <Grid>
              <Stat
                label="Monthly cash flow"
                value={formatCents(r.monthlyCashFlowCents)}
                note="after all expenses and loan"
                tone={r.monthlyCashFlowCents >= 0 ? "ok" : "bad"}
              />
              <Stat
                label="Annual cash flow"
                value={formatCents(r.annualCashFlowCents)}
                note="pre-tax"
                tone={r.annualCashFlowCents >= 0 ? "ok" : "bad"}
              />
              <Stat
                label="Cash-on-cash"
                value={`${r.cashOnCashPct.toFixed(1)}%`}
                note="cash flow ÷ cash invested"
                tone={r.cashOnCashPct >= 6 ? "ok" : r.cashOnCashPct < 0 ? "bad" : undefined}
              />
              <Stat label="Cap rate" value={`${r.capRatePct.toFixed(1)}%`} note="NOI ÷ price" />
              <Stat
                label="Total cash invested"
                value={formatCents(r.investedCents)}
                note="down + closing + repairs"
              />
              <Stat
                label="After-tax cash flow"
                value={formatCents(r.atcfCents)}
                note="incl. depreciation benefit"
                tone={r.atcfCents >= 0 ? "ok" : "bad"}
              />
              <Stat
                label="1% rule"
                value={`${r.onePercentRulePct.toFixed(2)}%`}
                note="rent ÷ price (1%+ ideal)"
                tone={r.onePercentRulePct >= 1 ? "ok" : undefined}
              />
              <Stat
                label="DSCR"
                value={r.dscr === null ? "—" : r.dscr.toFixed(2)}
                note="NOI ÷ debt (1.25+ ideal)"
                tone={r.dscr === null ? undefined : r.dscr >= 1.25 ? "ok" : "bad"}
              />
            </Grid>
          </Panel>

          <Panel title="Where the money goes">
            <div className="kr-scroll-x">
              <table style={{ width: "100%", minWidth: 380, borderCollapse: "collapse", fontSize: 13.5 }}>
                <thead>
                  <tr>
                    <Th>Item</Th>
                    <Th align="right">Monthly</Th>
                    <Th align="right">Annual</Th>
                  </tr>
                </thead>
                <tbody>
                  <Row label="Gross rent + other" cents={r.grossAnnualCents} />
                  <Row label="Vacancy loss" cents={-r.vacancyLossCents} />
                  <Row label="Property tax" cents={-r.taxCents} />
                  <Row label="Insurance" cents={-r.insuranceCents} />
                  <Row label="HOA" cents={-r.hoaCents} />
                  <Row label="Repairs & maintenance" cents={-r.maintenanceCents} />
                  <Row label="CapEx reserve" cents={-r.capexCents} />
                  <Row label="Property management" cents={-r.managementCents} />
                  <Row label="Utilities / other" cents={-r.utilitiesCents} />
                  <Row label="NOI" cents={r.noiCents} strong neutral />
                  <Row label="Mortgage (P&I)" cents={-r.debtServiceCents} />
                  <Row label="Cash flow" cents={r.annualCashFlowCents} strong />
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title={`Ten years — ${scenario === "financed" ? "financed" : "all cash"}`}>
            <Grid columns={2}>
              <Stat
                label="Total profit at sale (yr 10)"
                value={formatCents(r.totalProfitCents)}
                note="cash flow + equity − invested"
                tone={r.totalProfitCents >= 0 ? "ok" : "bad"}
              />
              <Stat
                label="Annualised return (IRR)"
                value={r.irrPct === null ? "—" : `${r.irrPct.toFixed(1)}%`}
                note="incl. sale proceeds"
                tone={r.irrPct === null ? undefined : r.irrPct >= 0 ? "ok" : "bad"}
              />
            </Grid>
            <div className="kr-scroll-x" style={{ marginTop: 12 }}>
              <table style={{ width: "100%", minWidth: 520, borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    <Th>Yr</Th>
                    <Th align="right">Value</Th>
                    <Th align="right">Loan bal</Th>
                    <Th align="right">Equity</Th>
                    <Th align="right">Cash flow</Th>
                    <Th align="right">Cumul.</Th>
                  </tr>
                </thead>
                <tbody>
                  {r.years.map((y) => (
                    <tr key={y.year} style={{ borderTop: "1px solid var(--line-soft)" }}>
                      <Td>{y.year}</Td>
                      <Td align="right">{formatCents(y.valueCents)}</Td>
                      <Td align="right">{formatCents(y.loanBalanceCents)}</Td>
                      <Td align="right">{formatCents(y.equityCents)}</Td>
                      <Td align="right" tone={y.cashFlowCents >= 0 ? "ok" : "bad"}>
                        {formatCents(y.cashFlowCents)}
                      </Td>
                      <Td align="right" tone={y.cumulativeCashFlowCents >= 0 ? undefined : "bad"}>
                        {formatCents(y.cumulativeCashFlowCents)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Note>
              Equity is value less loan balance. Year 10 assumes you sell and pay selling costs.
              IRR uses the initial cash out, the annual pre-tax cash flows, and the net sale.
            </Note>
          </Panel>

          <Panel title="Financed vs all cash">
            <div
              style={{
                display: "grid",
                gap: 12,
                gridTemplateColumns: "repeat(auto-fit, minmax(min(210px, 100%), 1fr))",
              }}
            >
              <Compare
                title="Financed"
                r={analysis.financed}
                better={(analysis.financed.irrPct ?? -Infinity) >= (analysis.cash.irrPct ?? -Infinity)}
                color={color}
              />
              <Compare
                title="All cash"
                r={analysis.cash}
                better={(analysis.cash.irrPct ?? -Infinity) > (analysis.financed.irrPct ?? -Infinity)}
                color={color}
              />
            </div>
            <Note>
              Leverage usually lifts percentage returns but lowers monthly cash flow, because the
              mortgage comes out of it. All cash gives more monthly income and more safety, and
              ties up more capital. You are currently viewing{" "}
              <strong>{scenario === "financed" ? "financed" : "all cash"}</strong>; the other one
              would be {formatCents(other.monthlyCashFlowCents)}/mo.
            </Note>
          </Panel>
        </div>

        <div className="kr-deal-inputs">
          <Panel title="Purchase">
            <Money label="Purchase price" value={inputs.priceCents} onChange={(v) => set("priceCents", v)} />
            <Money label="Closing costs" value={inputs.closingCostsCents} onChange={(v) => set("closingCostsCents", v)} />
            <Money label="Upfront repairs" value={inputs.rehabCents} onChange={(v) => set("rehabCents", v)} />
            <Field label="After-repair value basis">
              <Select
                value={inputs.arvCents === null ? inputs.arvMode : "manual"}
                onChange={(e) => {
                  if (e.target.value === "manual") set("arvCents", analysis.arvCents);
                  else {
                    set("arvCents", null);
                    set("arvMode", e.target.value as DealInputs["arvMode"]);
                  }
                }}
              >
                <option value="fixed">Fixed — price + repairs</option>
                <option value="conservative">Conservative — $1.50 per $1 of repairs</option>
                <option value="aggressive">Aggressive — $2.00 per $1 of repairs</option>
                <option value="manual">Set manually</option>
              </Select>
            </Field>
            {inputs.arvCents !== null ? (
              <Money label="After-repair value" value={inputs.arvCents} onChange={(v) => set("arvCents", v)} />
            ) : (
              <Derived label="After-repair value" value={formatCents(analysis.arvCents)} />
            )}
          </Panel>

          <Panel title="Financing">
            <Field label={inputs.downPaymentMode === "percent" ? "Down payment (%)" : "Down payment ($)"}>
              <div style={{ display: "flex", gap: 8 }}>
                <TextInput
                  inputMode="decimal"
                  value={
                    inputs.downPaymentMode === "percent"
                      ? String(inputs.downPayment)
                      : String(inputs.downPayment / 100)
                  }
                  onChange={(e) => {
                    const n = Number(e.target.value.replace(/[$,]/g, ""));
                    if (!Number.isFinite(n)) return;
                    set("downPayment", inputs.downPaymentMode === "percent" ? n : Math.round(n * 100));
                  }}
                />
                <div style={{ display: "flex", flex: "none" }}>
                  {(["percent", "amount"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        // Carry the value across so switching units doesn't
                        // silently reprice the deal.
                        const asPct = inputs.downPaymentMode === "percent";
                        if (m === "amount" && asPct) {
                          set("downPayment", Math.round((inputs.priceCents * inputs.downPayment) / 100));
                        } else if (m === "percent" && !asPct) {
                          set(
                            "downPayment",
                            inputs.priceCents ? (inputs.downPayment / inputs.priceCents) * 100 : 20,
                          );
                        }
                        set("downPaymentMode", m);
                      }}
                      aria-pressed={inputs.downPaymentMode === m}
                      style={{
                        width: 34,
                        fontSize: 13,
                        fontWeight: 600,
                        border: "1px solid var(--line)",
                        borderRadius: m === "percent" ? "9px 0 0 9px" : "0 9px 9px 0",
                        marginLeft: m === "amount" ? -1 : 0,
                        background:
                          inputs.downPaymentMode === m ? hero.tint(color, 16) : "var(--panel)",
                        color: "var(--ink)",
                      }}
                    >
                      {m === "percent" ? "%" : "$"}
                    </button>
                  ))}
                </div>
              </div>
            </Field>
            <Pct label="Interest rate (APR)" value={inputs.interestRatePct} onChange={(v) => set("interestRatePct", v)} />
            <Field label="Loan term (years)">
              <TextInput
                inputMode="numeric"
                value={String(inputs.termYears)}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n) && n > 0) set("termYears", Math.round(n));
                }}
              />
            </Field>
            <Field label="Closing + repairs" hint="Roll into the loan, or pay in cash?">
              <Select
                value={inputs.financeCosts ? "roll" : "cash"}
                onChange={(e) => set("financeCosts", e.target.value === "roll")}
              >
                <option value="roll">Roll into the loan</option>
                <option value="cash">Pay in cash at closing</option>
              </Select>
            </Field>
            <Derived label="Down payment" value={formatCents(analysis.financed.downPaymentCents)} />
            <Derived label="Loan amount" value={formatCents(analysis.financed.loanCents)} />
            <Derived label="Cash needed at closing" value={formatCents(analysis.financed.investedCents)} strong />
            <Note>
              Rolling costs in applies your down-payment percentage to price + closing + repairs.
              Real lenders cap this — treat it as a best case.
            </Note>
          </Panel>

          <Panel title="Income">
            <Money label="Monthly rent" value={inputs.monthlyRentCents} onChange={(v) => set("monthlyRentCents", v)} />
            <Money
              label="Other income / mo"
              value={inputs.monthlyOtherIncomeCents}
              onChange={(v) => set("monthlyOtherIncomeCents", v)}
            />
            <Pct label="Vacancy rate" value={inputs.vacancyPct} onChange={(v) => set("vacancyPct", v)} />
          </Panel>

          <Panel title="Tax & insurance">
            <Pct label="Property tax rate" value={inputs.taxRatePct} onChange={(v) => set("taxRatePct", v)} />
            <Derived label="Property tax / yr" value={formatCents(r.taxCents)} />
            <Field label="Insurance basis">
              <Select
                value={coastal ? "coastal" : "flat"}
                onChange={(e) => set("insuranceAnnualCents", e.target.value === "coastal" ? null : r.insuranceCents)}
              >
                <option value="coastal">Coastal — hazard + wind + flood</option>
                <option value="flat">One annual figure</option>
              </Select>
            </Field>
            {coastal ? (
              <>
                <Field label="Heated living area (sq ft)" hint="Wind is priced per square foot.">
                  <TextInput
                    inputMode="numeric"
                    value={String(inputs.sqft)}
                    onChange={(e) => {
                      const n = Number(e.target.value.replace(/,/g, ""));
                      if (Number.isFinite(n) && n >= 0) set("sqft", Math.round(n));
                    }}
                  />
                </Field>
                <Money label="Base landlord policy / yr" value={inputs.baseHazardCents} onChange={(v) => set("baseHazardCents", v)} />
                <Money label="Wind & hail per sq ft" value={inputs.windPerSqftCents} onChange={(v) => set("windPerSqftCents", v)} />
                <Field label="Flood zone">
                  <Select
                    value={
                      Object.entries(FLOOD_ZONE_ANNUAL_CENTS).find(
                        ([, v]) => v === inputs.floodAnnualCents,
                      )?.[0] ?? "custom"
                    }
                    onChange={(e) => {
                      const v = FLOOD_ZONE_ANNUAL_CENTS[e.target.value];
                      if (v !== undefined) set("floodAnnualCents", v);
                    }}
                  >
                    <option value="X">X — minimal risk</option>
                    <option value="AE">AE — flood plain</option>
                    <option value="VE">VE — coastal, wave action</option>
                    <option value="custom">Custom</option>
                  </Select>
                </Field>
                <Money label="Flood premium / yr" value={inputs.floodAnnualCents} onChange={(v) => set("floodAnnualCents", v)} />
                <div
                  style={{
                    marginTop: 10,
                    padding: "10px 12px",
                    borderRadius: 11,
                    background: "var(--panel-2)",
                    border: "1px solid var(--line)",
                  }}
                >
                  <Derived label="Base landlord" value={formatCents(inputs.baseHazardCents)} />
                  <Derived label="Wind & hail" value={formatCents(windCents)} />
                  <Derived label="Flood (NFIP)" value={formatCents(inputs.floodAnnualCents)} />
                  <Derived label="Total insurance / yr" value={formatCents(r.insuranceCents)} strong />
                </div>
                <Note>
                  Coastal premiums vary widely by flood zone and distance to water. This is an
                  estimate — get real quotes before you commit.
                </Note>
              </>
            ) : (
              <Money
                label="Insurance / yr"
                value={inputs.insuranceAnnualCents ?? 0}
                onChange={(v) => set("insuranceAnnualCents", v)}
              />
            )}
          </Panel>

          <Panel title="Operating expenses">
            <Money label="HOA / mo" value={inputs.monthlyHoaCents} onChange={(v) => set("monthlyHoaCents", v)} />
            <Money label="Utilities / other / mo" value={inputs.monthlyUtilitiesCents} onChange={(v) => set("monthlyUtilitiesCents", v)} />
            <Pct label="Repairs & maintenance" value={inputs.maintenancePct} onChange={(v) => set("maintenancePct", v)} />
            <Pct label="CapEx reserve" value={inputs.capexPct} onChange={(v) => set("capexPct", v)} />
            <Pct label="Property management" value={inputs.managementPct} onChange={(v) => set("managementPct", v)} />
            <Note>
              The percentages are charged against gross rent, except management, which is a cut of
              what you actually collect.
            </Note>
          </Panel>

          <Panel title="Growth & tax">
            <Pct label="Annual appreciation" value={inputs.appreciationPct} onChange={(v) => set("appreciationPct", v)} />
            <Pct label="Annual rent growth" value={inputs.rentGrowthPct} onChange={(v) => set("rentGrowthPct", v)} />
            <Pct label="Annual expense growth" value={inputs.expenseGrowthPct} onChange={(v) => set("expenseGrowthPct", v)} />
            <Pct label="Selling costs on exit" value={inputs.sellingCostPct} onChange={(v) => set("sellingCostPct", v)} />
            <Pct label="Income tax bracket" value={inputs.taxBracketPct} onChange={(v) => set("taxBracketPct", v)} />
            <Pct label="Land % (not depreciable)" value={inputs.landPct} onChange={(v) => set("landPct", v)} />
            <Note>
              Depreciation over 27.5 years and the mortgage-interest deduction are estimated to
              show after-tax cash flow. Depreciation recapture on sale is not modelled.
            </Note>
          </Panel>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginTop: 22,
          flexWrap: "wrap",
          paddingTop: 16,
          borderTop: "1px solid var(--line)",
        }}
      >
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save this analysis"}
        </Button>
        <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
          {save.isSuccess
            ? "Saved."
            : version > 0
              ? "The numbers update as you type; saving keeps them for everyone."
              : "Nothing saved yet for this property."}
        </span>
      </div>

      <p style={{ margin: "18px 0 0", fontSize: 12.5, color: "var(--ink-3)", maxWidth: "68ch" }}>
        Estimates, not financial advice. Confirm tax rates, insurance quotes and rents before you
        commit to anything.
      </p>
    </div>
  );
}

// ------------------------------------------------------------------ furniture

function Panel(props: { title: string; children: ReactNode }): ReactElement {
  return (
    <section
      style={{
        border: "1px solid var(--line)",
        borderRadius: 14,
        background: "var(--panel)",
        padding: "14px 16px 16px",
      }}
    >
      <h3 className="kr-label" style={{ margin: "0 0 10px" }}>
        {props.title}
      </h3>
      {props.children}
    </section>
  );
}

function Grid(props: { children: ReactNode; columns?: number }): ReactElement {
  return (
    <div
      style={{
        display: "grid",
        gap: 10,
        gridTemplateColumns: props.columns
          ? `repeat(auto-fit, minmax(min(200px, 100%), 1fr))`
          : "repeat(auto-fit, minmax(min(180px, 100%), 1fr))",
      }}
    >
      {props.children}
    </div>
  );
}

/** A headline figure with the plain-English reason it matters underneath. */
function Stat(props: {
  label: string;
  value: string;
  note: string;
  tone?: "ok" | "bad";
}): ReactElement {
  return (
    <div
      style={{
        border: "1px solid var(--line)",
        borderRadius: 12,
        background: "var(--panel-2)",
        padding: "10px 12px",
      }}
    >
      <span className="kr-label" style={{ display: "block", fontSize: 9 }}>
        {props.label}
      </span>
      <span
        className="kr-tabular"
        style={{
          display: "block",
          fontSize: 21,
          fontWeight: 700,
          margin: "3px 0 2px",
          color: props.tone === "ok" ? "var(--ok)" : props.tone === "bad" ? "var(--bad)" : "var(--ink)",
        }}
      >
        {props.value}
      </span>
      <span style={{ display: "block", fontSize: 11.5, color: "var(--ink-3)" }}>{props.note}</span>
    </div>
  );
}

/** A number the model worked out, shown beside the inputs that produced it. */
function Derived(props: { label: string; value: string; strong?: boolean }): ReactElement {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 10,
        padding: "5px 0",
        fontSize: 13,
        fontWeight: props.strong ? 700 : 400,
        color: props.strong ? "var(--ink)" : "var(--ink-2)",
      }}
    >
      <span>{props.label}</span>
      <span className="kr-tabular">{props.value}</span>
    </div>
  );
}

function Note(props: { children: ReactNode }): ReactElement {
  return (
    <p style={{ margin: "10px 0 0", fontSize: 12, lineHeight: 1.5, color: "var(--ink-3)" }}>
      {props.children}
    </p>
  );
}

function Money(props: { label: string; value: number; onChange: (cents: number) => void }): ReactElement {
  return (
    <Field label={props.label}>
      <TextInput
        inputMode="decimal"
        value={String(props.value / 100)}
        onChange={(e) => {
          const n = Number(e.target.value.replace(/[$,]/g, ""));
          if (Number.isFinite(n) && n >= 0) props.onChange(Math.round(n * 100));
        }}
      />
    </Field>
  );
}

function Pct(props: { label: string; value: number; onChange: (pct: number) => void }): ReactElement {
  return (
    <Field label={`${props.label} (%)`}>
      <TextInput
        inputMode="decimal"
        value={String(props.value)}
        onChange={(e) => {
          const n = Number(e.target.value.replace(/%/g, ""));
          if (Number.isFinite(n)) props.onChange(n);
        }}
      />
    </Field>
  );
}

function Compare(props: {
  title: string;
  r: { investedCents: number; monthlyCashFlowCents: number; cashOnCashPct: number; irrPct: number | null; totalProfitCents: number };
  better: boolean;
  color: string | null;
}): ReactElement {
  const { r } = props;
  return (
    <div
      style={{
        border: `1px solid ${props.better ? hero.border(props.color, 0.45) : "var(--line)"}`,
        borderRadius: 12,
        background: "var(--panel-2)",
        padding: "12px 14px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 700 }}>{props.title}</span>
        {props.better && (
          <span
            className="kr-label"
            style={{
              marginLeft: "auto",
              fontSize: 8.5,
              padding: "2px 7px",
              borderRadius: 999,
              background: hero.tint(props.color, 18),
              color: "var(--ink-2)",
            }}
          >
            Higher return
          </span>
        )}
      </div>
      <Derived label="Cash invested" value={formatCents(r.investedCents)} />
      <Derived label="Monthly cash flow" value={formatCents(r.monthlyCashFlowCents)} />
      <Derived label="Cash-on-cash" value={`${r.cashOnCashPct.toFixed(1)}%`} />
      <Derived label="10-yr IRR" value={r.irrPct === null ? "—" : `${r.irrPct.toFixed(1)}%`} />
      <Derived label="10-yr total profit" value={formatCents(r.totalProfitCents)} strong />
    </div>
  );
}

function Th(props: { children: ReactNode; align?: "right" }): ReactElement {
  return (
    <th className="kr-label" style={{ textAlign: props.align ?? "left", padding: "6px 8px", fontSize: 9 }}>
      {props.children}
    </th>
  );
}

function Td(props: { children: ReactNode; align?: "right"; tone?: "ok" | "bad" }): ReactElement {
  return (
    <td
      className={props.align === "right" ? "kr-tabular" : undefined}
      style={{
        textAlign: props.align ?? "left",
        padding: "6px 8px",
        color: props.tone === "ok" ? "var(--ok)" : props.tone === "bad" ? "var(--bad)" : "var(--ink)",
      }}
    >
      {props.children}
    </td>
  );
}

function Row(props: { label: string; cents: number; strong?: boolean; neutral?: boolean }): ReactElement {
  const tone = props.neutral ? undefined : props.cents >= 0 ? "ok" : "bad";
  return (
    <tr style={{ borderTop: "1px solid var(--line-soft)" }}>
      <Td>{props.strong ? <strong>{props.label}</strong> : props.label}</Td>
      <Td align="right" tone={tone}>
        {formatCents(Math.round(props.cents / 12))}
      </Td>
      <Td align="right" tone={tone}>
        {formatCents(props.cents)}
      </Td>
    </tr>
  );
}
