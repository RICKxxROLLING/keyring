import { useId, useState, type ReactElement } from "react";
import { useMutation } from "@tanstack/react-query";
import type {
  AppraisalImportPreview,
  AppraisalImportResult,
  ImportablePropertyField,
  ImportedFact,
} from "../../../shared/types";
import { APPRAISAL_ACTION_LABELS } from "../../../shared/appraisal-checklist";
import { apiPostForm, ApiClientError } from "../../lib/api";
import { formatCents, formatDate } from "../../lib/format";
import { Button } from "../../components/Button";

/**
 * Import a past appraisal: pick the file, check what was read, tick what to
 * bring in.
 *
 * Two requests with the same file. The first only reads; the second sends back
 * the KEYS that were ticked, and the server reads the file again to get the
 * values — so what lands in the checklist is what the report says, not what
 * this screen displayed.
 */
const FIELD_LABEL: Record<ImportablePropertyField, string> = {
  yearBuilt: "Year built",
  sqft: "Square feet",
  lotSqft: "Lot size (sq ft)",
  parcelNumber: "Parcel number",
};

function errorText(err: unknown): string {
  return err instanceof ApiClientError ? err.message : "Something went wrong reading that file.";
}

export function AppraisalImport({
  propertyId,
  onDone,
  onCancel,
}: {
  propertyId: string;
  onDone: (result: AppraisalImportResult) => void;
  onCancel: () => void;
}): ReactElement {
  const inputId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [facts, setFacts] = useState<Set<string>>(new Set());
  const [defects, setDefects] = useState<Set<string>>(new Set());
  const [fields, setFields] = useState<Set<ImportablePropertyField>>(new Set());
  const [na, setNa] = useState<Set<string>>(new Set());

  const preview = useMutation({
    mutationFn: (f: File) => {
      const form = new FormData();
      form.append("mode", "preview");
      form.append("file", f);
      return apiPostForm<AppraisalImportPreview>(`/api/properties/${propertyId}/appraisal/import`, form);
    },
    onSuccess: (p) => {
      // Ticked by default: everything that fills a checklist item, every
      // defect, and N/A where the report says a feature is absent. Property
      // fields are ticked only where the record is empty — overwriting a value
      // someone typed is a decision, not a default.
      setFacts(new Set(p.facts.filter((f) => f.itemLabel).map((f) => f.key)));
      setDefects(new Set(p.defects.map((d) => d.key)));
      setNa(new Set(p.facts.filter((f) => f.suggestsNotApplicable).map((f) => f.key)));
      setFields(
        new Set(
          p.facts
            .filter((f) => f.propertyField && (f.currentPropertyValue === null || f.currentPropertyValue === undefined))
            .map((f) => f.propertyField!),
        ),
      );
    },
  });

  const apply = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append("mode", "apply");
      form.append(
        "selection",
        JSON.stringify({ facts: [...facts], defects: [...defects], propertyFields: [...fields], markNotApplicable: [...na].filter((k) => facts.has(k)) }),
      );
      form.append("file", file!);
      return apiPostForm<AppraisalImportResult>(`/api/properties/${propertyId}/appraisal/import`, form);
    },
    onSuccess: onDone,
  });

  const toggle = <T,>(set: Set<T>, value: T, apply: (s: Set<T>) => void): void => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    apply(next);
  };

  const p = preview.data;
  const itemFacts = p?.facts.filter((f) => f.itemLabel) ?? [];
  const propertyFacts = (p?.facts.filter((f) => f.propertyField) ?? []).filter(
    (f) => String(f.currentPropertyValue ?? "") !== String(f.propertyValue ?? ""),
  );
  const count = facts.size + defects.size + fields.size;

  return (
    <section
      aria-label="Import an appraisal"
      style={{ display: "grid", gap: 14, gridTemplateColumns: "minmax(0, 1fr)", marginBottom: 18, padding: 16, borderRadius: 14, border: "1px solid var(--line)", background: "var(--panel)" }}
    >
      <div>
        <h3 style={{ margin: 0, fontSize: 15 }}>Import an appraisal</h3>
        <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--ink-2)", maxWidth: "64ch" }}>
          The UAD 3.6 ZIP or XML from the lender or appraiser is read exactly, field by field. A PDF is read off the page
          — fine for the redesigned report, rougher for older forms. Nothing is saved until you choose what to bring in.
        </p>
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <label htmlFor={inputId} className="kr-quiet-action" style={{ cursor: "pointer", fontWeight: 600 }}>
          {file ? `Change file (${file.name})` : "Choose the appraisal file"}
        </label>
        <input
          id={inputId}
          type="file"
          accept=".zip,.xml,.pdf,application/zip,application/xml,text/xml,application/pdf"
          className="kr-visually-hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            setFile(f);
            apply.reset();
            preview.mutate(f);
          }}
        />
        {preview.isPending && <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>Reading…</span>}
        <button type="button" className="kr-quiet-action" onClick={onCancel} style={{ marginLeft: "auto" }}>
          Cancel
        </button>
      </div>

      {preview.isError && <p role="alert" style={{ margin: 0, fontSize: 13, color: "var(--urgent, #b42318)" }}>{errorText(preview.error)}</p>}

      {p && (
        <>
          <div style={{ fontSize: 13.5, display: "grid", gap: 4 }}>
            <div>
              <strong>{p.report.opinionOfValueCents !== null ? formatCents(p.report.opinionOfValueCents) : "Value not read"}</strong>
              {p.report.effectiveDate ? ` · effective ${formatDate(p.report.effectiveDate)}` : ""}
              {p.report.assignmentType ? ` · ${p.report.assignmentType}` : ""}
              {p.report.valueCondition ? ` · ${p.report.valueCondition}` : ""}
              {p.report.overallCondition ? ` · ${p.report.overallCondition}/${p.report.overallQuality ?? "?"}` : ""}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
              {p.format === "uad36_xml" ? "Read from the UAD 3.6 data" : "Read from the PDF text"}
              {p.hasReportPdf ? " · the report PDF will be filed under this property" : ""}
              {p.subjectAddress ? ` · ${p.subjectAddress}` : ""}
            </div>
            {p.addressMismatch && (
              <p role="alert" style={{ margin: "4px 0 0", fontSize: 13, fontWeight: 600, color: "var(--urgent, #b42318)" }}>
                The address on this report doesn't look like this property's. Check it's the right file before importing.
              </p>
            )}
            {p.warnings.map((w) => (
              <p key={w} style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--ink-2)" }}>
                {w}
              </p>
            ))}
          </div>

          {itemFacts.length > 0 && (
            <Group title="Checklist items it fills">
              {itemFacts.map((f) => (
                <FactRow
                  key={f.key}
                  fact={f}
                  checked={facts.has(f.key)}
                  onToggle={() => toggle(facts, f.key, setFacts)}
                  naChecked={na.has(f.key)}
                  onToggleNa={() => toggle(na, f.key, setNa)}
                />
              ))}
            </Group>
          )}

          {p.defects.length > 0 && (
            <Group title={`Defects on the report (${p.defects.length})`}>
              {p.defects.map((d) => (
                <Check key={d.key} checked={defects.has(d.key)} onToggle={() => toggle(defects, d.key, setDefects)}>
                  <span style={{ fontWeight: 600 }}>{d.description}</span>
                  <span style={{ display: "block", fontSize: 12, color: "var(--ink-3)" }}>
                    {[
                      d.where,
                      d.recommendedAction ? APPRAISAL_ACTION_LABELS[d.recommendedAction] : null,
                      d.estimateCents !== null ? formatCents(d.estimateCents) : null,
                      d.affectsSoundness ? "affects soundness" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </Check>
              ))}
            </Group>
          )}

          {propertyFacts.length > 0 && (
            <Group title="Property details">
              {propertyFacts.map((f) => (
                <Check key={f.key} checked={fields.has(f.propertyField!)} onToggle={() => toggle(fields, f.propertyField!, setFields)}>
                  <span style={{ fontWeight: 600 }}>{FIELD_LABEL[f.propertyField!]}</span>{" "}
                  <span style={{ color: "var(--ink-2)" }}>
                    {f.currentPropertyValue !== null && f.currentPropertyValue !== undefined
                      ? `${String(f.currentPropertyValue)} → ${String(f.propertyValue)}`
                      : `${String(f.propertyValue)} (empty now)`}
                  </span>
                </Check>
              ))}
            </Group>
          )}

          {apply.isError && <p role="alert" style={{ margin: 0, fontSize: 13, color: "var(--urgent, #b42318)" }}>{errorText(apply.error)}</p>}
          <div>
            <Button onClick={() => apply.mutate()} disabled={apply.isPending || (count === 0 && !p.hasReportPdf)}>
              {apply.isPending ? "Importing…" : count > 0 ? `Import ${count} ${count === 1 ? "item" : "items"}` : "File the report only"}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }): ReactElement {
  return (
    <fieldset style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
      <legend className="kr-label" style={{ marginBottom: 8, padding: 0 }}>
        {title}
      </legend>
      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "minmax(0, 1fr)" }}>{children}</div>
    </fieldset>
  );
}

function Check({ checked, onToggle, children }: { checked: boolean; onToggle: () => void; children: React.ReactNode }): ReactElement {
  return (
    <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13, cursor: "pointer", minWidth: 0 }}>
      <input type="checkbox" checked={checked} onChange={onToggle} style={{ marginTop: 3, flex: "none" }} />
      <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{children}</span>
    </label>
  );
}

function FactRow({
  fact,
  checked,
  onToggle,
  naChecked,
  onToggleNa,
}: {
  fact: ImportedFact;
  checked: boolean;
  onToggle: () => void;
  naChecked: boolean;
  onToggleNa: () => void;
}): ReactElement {
  return (
    <div>
      <Check checked={checked} onToggle={onToggle}>
        <span style={{ fontWeight: 600 }}>{fact.label}:</span> {fact.value}
        <span style={{ display: "block", fontSize: 12, color: "var(--ink-3)" }}>→ {fact.itemLabel}</span>
      </Check>
      {fact.suggestsNotApplicable && checked && (
        <label style={{ display: "flex", gap: 8, marginLeft: 26, marginTop: 4, fontSize: 12.5, color: "var(--ink-2)", cursor: "pointer" }}>
          <input type="checkbox" checked={naChecked} onChange={onToggleNa} />
          Mark this item N/A
        </label>
      )}
    </div>
  );
}
