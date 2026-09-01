import { useEffect, useState, type ReactElement } from "react";
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
 * The Outer Banks analyzer, merged into Keyring so the deal is worked out on
 * the property itself rather than in a second tab with the numbers retyped.
 *
 * The analysis recomputes locally on every keystroke — it is pure arithmetic on
 * data already in the browser, so waiting on a round trip to see what a half
 * point of interest does would be the wrong shape entirely. The server is only
 * asked when you save, and it recomputes independently so the stored inputs are
 * always the source of truth.
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
  const ceiling = maxPriceForCashFlow(inputs, 100_00, scenario);

  const verdictTone =
    analysis.verdict === "profitable"
      ? { fg: "var(--ok)", bg: "var(--ok-fill)", label: "Profitable" }
      : analysis.verdict === "negative"
        ? { fg: "var(--bad)", bg: "var(--bad-fill)", label: "Negative" }
        : { fg: "var(--warn)", bg: "var(--warn-fill)", label: "Marginal" };

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 18,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Does this one work?</h2>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {(["financed", "cash"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setScenario(s)}
              aria-pressed={scenario === s}
              style={{
                padding: "6px 12px",
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 600,
                border: `1px solid ${scenario === s ? hero.border(color, 0.4) : "var(--line)"}`,
                background: scenario === s ? hero.tint(color, 12) : "var(--panel)",
                color: "var(--ink)",
              }}
            >
              {s === "financed" ? "Financed" : "All cash"}
            </button>
          ))}
        </div>
      </div>

      <div
        style={{
          padding: "14px 16px",
          borderRadius: 13,
          background: verdictTone.bg,
          border: `1px solid ${verdictTone.fg}`,
          marginBottom: 20,
        }}
      >
        <span className="kr-label" style={{ display: "block", fontSize: 9, color: verdictTone.fg }}>
          {verdictTone.label}
        </span>
        <span style={{ display: "block", fontSize: 15, fontWeight: 600, marginTop: 3 }}>
          {analysis.verdictLine}
        </span>
        {ceiling !== null && (
          <span style={{ display: "block", fontSize: 13, color: "var(--ink-2)", marginTop: 6 }}>
            Pay up to <strong>{formatCents(ceiling)}</strong> and it still clears $100/mo.
          </span>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fit, minmax(min(150px, 100%), 1fr))",
          marginBottom: 24,
        }}
      >
        <Kpi label="Cash flow / mo" value={formatCents(r.monthlyCashFlowCents)} good={r.monthlyCashFlowCents >= 0} />
        <Kpi label="Cash in" value={formatCents(r.investedCents)} />
        <Kpi label="Cash-on-cash" value={`${r.cashOnCashPct.toFixed(1)}%`} good={r.cashOnCashPct >= 6} />
        <Kpi label="Cap rate" value={`${r.capRatePct.toFixed(1)}%`} />
        <Kpi label="DSCR" value={r.dscr === null ? "—" : r.dscr.toFixed(2)} good={r.dscr !== null && r.dscr >= 1.25} />
        <Kpi label="1% rule" value={`${r.onePercentRulePct.toFixed(2)}%`} good={r.onePercentRulePct >= 1} />
        <Kpi label="After-tax / yr" value={formatCents(r.atcfCents)} good={r.atcfCents >= 0} />
        <Kpi label="10-yr profit" value={formatCents(r.totalProfitCents)} good={r.totalProfitCents >= 0} />
        <Kpi label="IRR" value={r.irrPct === null ? "—" : `${r.irrPct.toFixed(1)}%`} />
      </div>

      <Group title="The purchase">
        <Money label="Asking price" value={inputs.priceCents} onChange={(v) => set("priceCents", v)} />
        <Money label="Closing costs" value={inputs.closingCostsCents} onChange={(v) => set("closingCostsCents", v)} />
        <Money label="Repairs / rehab" value={inputs.rehabCents} onChange={(v) => set("rehabCents", v)} />
      </Group>

      <Group title="The loan">
        <Field label={inputs.downPaymentMode === "percent" ? "Down payment %" : "Down payment $"}>
          <TextInput
            inputMode="decimal"
            value={
              inputs.downPaymentMode === "percent"
                ? String(inputs.downPayment)
                : String(inputs.downPayment / 100)
            }
            onChange={(e) => {
              const n = Number(e.target.value.replace(/,/g, ""));
              if (!Number.isFinite(n)) return;
              set("downPayment", inputs.downPaymentMode === "percent" ? n : Math.round(n * 100));
            }}
          />
        </Field>
        <Field label="Down payment as">
          <Select
            value={inputs.downPaymentMode}
            onChange={(e) => set("downPaymentMode", e.target.value as DealInputs["downPaymentMode"])}
          >
            <option value="percent">a percentage</option>
            <option value="amount">a dollar amount</option>
          </Select>
        </Field>
        <Pct label="Interest rate" value={inputs.interestRatePct} onChange={(v) => set("interestRatePct", v)} />
        <Field label="Term (years)">
          <TextInput
            inputMode="numeric"
            value={String(inputs.termYears)}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n) && n > 0) set("termYears", Math.round(n));
            }}
          />
        </Field>
        <Field label="Closing and repairs" hint="Rolled into the loan, or paid in cash?">
          <Select
            value={inputs.financeCosts ? "roll" : "cash"}
            onChange={(e) => set("financeCosts", e.target.value === "roll")}
          >
            <option value="roll">roll into the loan</option>
            <option value="cash">pay in cash</option>
          </Select>
        </Field>
      </Group>

      <Group title="What it brings in">
        <Money label="Monthly rent" value={inputs.monthlyRentCents} onChange={(v) => set("monthlyRentCents", v)} />
        <Money
          label="Other income / mo"
          value={inputs.monthlyOtherIncomeCents}
          onChange={(v) => set("monthlyOtherIncomeCents", v)}
        />
        <Pct label="Vacancy" value={inputs.vacancyPct} onChange={(v) => set("vacancyPct", v)} />
      </Group>

      <Group title="What it costs to hold">
        <Pct label="Property tax rate" value={inputs.taxRatePct} onChange={(v) => set("taxRatePct", v)} />
        <Field label="Insurance" hint="Coastal builds it from wind and flood.">
          <Select
            value={inputs.insuranceAnnualCents === null ? "coastal" : "flat"}
            onChange={(e) => set("insuranceAnnualCents", e.target.value === "coastal" ? null : 180000)}
          >
            <option value="coastal">wind + flood (coastal)</option>
            <option value="flat">one annual figure</option>
          </Select>
        </Field>
        {inputs.insuranceAnnualCents === null ? (
          <>
            <Money
              label="Base hazard / yr"
              value={inputs.baseHazardCents}
              onChange={(v) => set("baseHazardCents", v)}
            />
            <Money
              label="Wind per sq ft"
              value={inputs.windPerSqftCents}
              onChange={(v) => set("windPerSqftCents", v)}
            />
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
                <option value="custom">custom</option>
              </Select>
            </Field>
            <Field label="Square feet" hint="Wind premium is priced per square foot.">
              <TextInput
                inputMode="numeric"
                value={String(inputs.sqft)}
                onChange={(e) => {
                  const n = Number(e.target.value.replace(/,/g, ""));
                  if (Number.isFinite(n) && n >= 0) set("sqft", Math.round(n));
                }}
              />
            </Field>
          </>
        ) : (
          <Money
            label="Insurance / yr"
            value={inputs.insuranceAnnualCents}
            onChange={(v) => set("insuranceAnnualCents", v)}
          />
        )}
        <Money label="HOA / mo" value={inputs.monthlyHoaCents} onChange={(v) => set("monthlyHoaCents", v)} />
        <Money
          label="Utilities / mo"
          value={inputs.monthlyUtilitiesCents}
          onChange={(v) => set("monthlyUtilitiesCents", v)}
        />
        <Pct label="Maintenance" value={inputs.maintenancePct} onChange={(v) => set("maintenancePct", v)} />
        <Pct label="CapEx reserve" value={inputs.capexPct} onChange={(v) => set("capexPct", v)} />
        <Pct label="Management" value={inputs.managementPct} onChange={(v) => set("managementPct", v)} />
      </Group>

      <Group title="Ten years out" hint="Assumptions, not predictions.">
        <Pct label="Appreciation / yr" value={inputs.appreciationPct} onChange={(v) => set("appreciationPct", v)} />
        <Pct label="Rent growth / yr" value={inputs.rentGrowthPct} onChange={(v) => set("rentGrowthPct", v)} />
        <Pct label="Expense growth / yr" value={inputs.expenseGrowthPct} onChange={(v) => set("expenseGrowthPct", v)} />
        <Pct label="Cost to sell" value={inputs.sellingCostPct} onChange={(v) => set("sellingCostPct", v)} />
        <Pct label="Your tax bracket" value={inputs.taxBracketPct} onChange={(v) => set("taxBracketPct", v)} />
        <Pct label="Land (not depreciable)" value={inputs.landPct} onChange={(v) => set("landPct", v)} />
      </Group>

      <h3 className="kr-label" style={{ margin: "26px 0 6px" }}>
        Where the money goes
      </h3>
      <div className="kr-scroll-x">
        <table style={{ width: "100%", minWidth: 420, borderCollapse: "collapse", fontSize: 13.5 }}>
          <thead>
            <tr>
              <Th>Item</Th>
              <Th align="right">Monthly</Th>
              <Th align="right">Annual</Th>
            </tr>
          </thead>
          <tbody>
            <Row label="Gross rent + other" cents={r.grossAnnualCents} />
            <Row label="Vacancy" cents={-r.vacancyLossCents} />
            <Row label="Property tax" cents={-r.taxCents} />
            <Row label="Insurance" cents={-r.insuranceCents} />
            <Row label="HOA" cents={-r.hoaCents} />
            <Row label="Utilities" cents={-r.utilitiesCents} />
            <Row label="Maintenance" cents={-r.maintenanceCents} />
            <Row label="CapEx reserve" cents={-r.capexCents} />
            <Row label="Management" cents={-r.managementCents} />
            <Row label="NOI" cents={r.noiCents} strong />
            <Row label="Mortgage (P&I)" cents={-r.debtServiceCents} />
            <Row label="Cash flow" cents={r.annualCashFlowCents} strong />
          </tbody>
        </table>
      </div>

      <h3 className="kr-label" style={{ margin: "26px 0 6px" }}>
        Ten-year projection
      </h3>
      <div className="kr-scroll-x">
        <table style={{ width: "100%", minWidth: 560, borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              <Th>Year</Th>
              <Th align="right">Value</Th>
              <Th align="right">Owed</Th>
              <Th align="right">Equity</Th>
              <Th align="right">Cash flow</Th>
              <Th align="right">Cumulative</Th>
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
                <Td align="right">{formatCents(y.cumulativeCashFlowCents)}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 24, flexWrap: "wrap" }}>
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
    </div>
  );
}

function Group(props: { title: string; hint?: string; children: React.ReactNode }): ReactElement {
  return (
    <section style={{ marginBottom: 20 }}>
      <h3 className="kr-label" style={{ margin: "0 0 2px" }}>
        {props.title}
      </h3>
      {props.hint && (
        <p style={{ margin: "0 0 8px", fontSize: 12.5, color: "var(--ink-3)" }}>{props.hint}</p>
      )}
      <div
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fit, minmax(min(170px, 100%), 1fr))",
        }}
      >
        {props.children}
      </div>
    </section>
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
          const n = Number(e.target.value);
          if (Number.isFinite(n)) props.onChange(n);
        }}
      />
    </Field>
  );
}

function Kpi(props: { label: string; value: string; good?: boolean }): ReactElement {
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: "10px 12px", background: "var(--panel)" }}>
      <span className="kr-label" style={{ display: "block", fontSize: 9 }}>
        {props.label}
      </span>
      <span
        className="kr-tabular"
        style={{
          display: "block",
          fontSize: 19,
          fontWeight: 700,
          marginTop: 2,
          color: props.good === undefined ? "var(--ink)" : props.good ? "var(--ok)" : "var(--bad)",
        }}
      >
        {props.value}
      </span>
    </div>
  );
}

function Th(props: { children: React.ReactNode; align?: "right" }): ReactElement {
  return (
    <th
      className="kr-label"
      style={{ textAlign: props.align ?? "left", padding: "6px 8px", fontSize: 9 }}
    >
      {props.children}
    </th>
  );
}

function Td(props: {
  children: React.ReactNode;
  align?: "right";
  tone?: "ok" | "bad";
}): ReactElement {
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

function Row(props: { label: string; cents: number; strong?: boolean }): ReactElement {
  return (
    <tr style={{ borderTop: "1px solid var(--line-soft)" }}>
      <Td>{props.strong ? <strong>{props.label}</strong> : props.label}</Td>
      <Td align="right" tone={props.cents >= 0 ? "ok" : "bad"}>
        {formatCents(Math.round(props.cents / 12))}
      </Td>
      <Td align="right" tone={props.cents >= 0 ? "ok" : "bad"}>
        {formatCents(props.cents)}
      </Td>
    </tr>
  );
}
