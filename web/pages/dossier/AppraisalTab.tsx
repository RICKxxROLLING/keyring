import { useId, useState, type ReactElement } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import type {
  AppraisalImportResult,
  AppraisalItemView,
  AppraisalReportView,
  AppraisalKind,
  AppraisalRecommendedAction,
  AppraisalSection,
  AppraisalStatus,
  ProjectView,
} from "../../../shared/types";
import {
  APPRAISAL_ACTION_LABELS,
  APPRAISAL_KIND_LABELS,
  APPRAISAL_SECTION_LABELS,
  APPRAISAL_SECTION_ORDER,
  appraisalStatusLabel,
  summarizeAppraisal,
} from "../../../shared/appraisal-checklist";
import { apiDelete, apiPatch, apiPost, apiUpload } from "../../lib/api";
import { qk } from "../../lib/query";
import { useDossier } from "../../lib/dossier-context";
import { formatCents, formatDate } from "../../lib/format";
import { Button } from "../../components/Button";
import { EmptyState, Field, Select, TextArea, TextInput } from "../../components/Form";
import { NumericInput } from "../../components/NumericInput";
import { StatusPill } from "../../components/StatusPill";
import { ExpandableRow } from "../../components/ExpandableRow";
import { CameraIcon } from "../../components/icons";
import type { Severity } from "../../lib/status";
import { AppraisalImport } from "./AppraisalImport";

/**
 * Getting ready for an appraisal under UAD 3.6 and the redesigned URAR.
 *
 * Laid out in the order the report asks, not by status, so it can be worked
 * from top to bottom with the appraiser's questions in mind. Three jobs on one
 * page: the checklist, the repair budget built from its defects, and the
 * binder — every attached file in one download to hand over.
 */
const STATUSES: AppraisalStatus[] = ["todo", "in_progress", "ready", "not_applicable"];
const KINDS: AppraisalKind[] = ["document", "photo", "fact", "defect"];
const ACTIONS: AppraisalRecommendedAction[] = ["repair", "inspect", "completion", "none"];

function severity(item: AppraisalItemView): Severity {
  if (item.status === "ready") return "ok";
  if (item.status === "not_applicable") return "neutral";
  if (item.kind === "defect") return item.recommendedAction === "none" ? "warn" : "urgent";
  return item.status === "in_progress" ? "warn" : "neutral";
}

export function AppraisalTab(): ReactElement {
  const dossier = useDossier();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const [adding, setAdding] = useState<null | "item" | "defect">(null);
  const [label, setLabel] = useState("");
  const [section, setSection] = useState<AppraisalSection>("other");
  const [kind, setKind] = useState<AppraisalKind>("document");
  const [detail, setDetail] = useState("");
  const [estimate, setEstimate] = useState(0);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<AppraisalImportResult | null>(null);

  const propertyId = dossier.property.id;
  const items = dossier.appraisal;
  const summary = summarizeAppraisal(items);
  const highlighted = params.get("item");
  const color = dossier.property.heroColor;

  function invalidate(): void {
    void queryClient.invalidateQueries({ queryKey: qk.dossier(propertyId) });
  }

  const applyTemplate = useMutation({
    mutationFn: () =>
      apiPost<{ added: AppraisalItemView[]; skipped: number }>(
        `/api/properties/${propertyId}/appraisal/checklist`,
      ),
    onSuccess: invalidate,
  });

  const budget = useMutation({
    mutationFn: () =>
      apiPost<{ project: ProjectView | null; linked: AppraisalItemView[]; created: boolean }>(
        `/api/properties/${propertyId}/appraisal/budget`,
      ),
    onSuccess: invalidate,
  });

  const add = useMutation({
    mutationFn: () => {
      const isDefect = adding === "defect";
      return apiPost<AppraisalItemView>(`/api/properties/${propertyId}/appraisal`, {
        label,
        section: isDefect ? "defects" : section,
        kind: isDefect ? "defect" : kind,
        detail: detail.trim() || null,
        ...(isDefect && estimate > 0 ? { estimateCents: Math.round(estimate * 100) } : {}),
      });
    },
    onSuccess: () => {
      setLabel("");
      setDetail("");
      setEstimate(0);
      setAdding(null);
      invalidate();
    },
  });

  const grouped = APPRAISAL_SECTION_ORDER.map((s) => ({
    section: s,
    items: items.filter((i) => i.section === s),
  })).filter((g) => g.items.length > 0 || (g.section === "defects" && items.length > 0));

  const finishedProjects = dossier.projects.filter((p) => p.status === "done");

  return (
    <div>
      <header
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 14,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <h2 className="kr-display kr-h-section" style={{ margin: 0, fontSize: 20 }}>
            Ready for the appraiser
          </h2>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--ink-2)", maxWidth: "62ch" }}>
            {items.length === 0
              ? "The facts, photos and paper a UAD 3.6 appraisal will ask for — and the defects worth fixing before someone writes them down."
              : `${summary.ready} of ${summary.total} ready · ${summary.outstanding} still to do${
                  summary.openDefects > 0
                    ? ` · ${summary.openDefects} open ${summary.openDefects === 1 ? "defect" : "defects"}`
                    : ""
                }`}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button
            variant="secondary"
            onClick={() => {
              setImporting((v) => !v);
              setImported(null);
            }}
          >
            Import an appraisal
          </Button>
          <Button
            variant="secondary"
            onClick={() => applyTemplate.mutate()}
            disabled={applyTemplate.isPending}
          >
            {applyTemplate.isPending ? "Adding…" : "Add the UAD 3.6 list"}
          </Button>
          <Button variant="secondary" onClick={() => setAdding((v) => (v === "defect" ? null : "defect"))}>
            + Defect
          </Button>
          <Button onClick={() => setAdding((v) => (v === "item" ? null : "item"))}>+ Item</Button>
        </div>
      </header>

      <details style={{ marginBottom: 16, fontSize: 13, color: "var(--ink-2)" }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>What changed with UAD 3.6</summary>
        <p style={{ margin: "8px 0 0", maxWidth: "68ch" }}>
          Fannie Mae and Freddie Mac replaced the old fixed appraisal forms (1004, 1073, 1025 and the
          rest) with one redesigned URAR, delivered as UAD 3.6 data. It is required for appraisals
          submitted to them on or after November 2, 2026. More of the report is now structured fields
          instead of narrative: living area measured to ANSI Z765, a sketch or floor plan, photos of
          every kitchen and bathroom, a defects table with a recommended action for each line, and
          sections of their own for energy-efficient features, disaster mitigation, ADUs,
          outbuildings and vehicle storage.
        </p>
        <p style={{ margin: "8px 0 0", maxWidth: "68ch" }}>
          The appraiser fills in the report and decides the ratings. This list is the owner's half:
          have every answer and the paper behind it ready. It is a preparation aid, not appraisal or
          lending advice — what is asked for varies by loan and lender.
        </p>
      </details>

      {importing && (
        <AppraisalImport
          propertyId={propertyId}
          onCancel={() => setImporting(false)}
          onDone={(result) => {
            setImporting(false);
            setImported(result);
            invalidate();
          }}
        />
      )}
      {imported && (
        <p role="status" style={{ margin: "0 0 16px", fontSize: 13, color: "var(--ink-2)" }}>
          Imported: {imported.itemsFilled} checklist {imported.itemsFilled === 1 ? "item" : "items"} filled
          {imported.itemsCreated > 0 ? ` (${imported.itemsCreated} added to the list)` : ""}
          {imported.defectsAdded > 0 ? `, ${imported.defectsAdded} ${imported.defectsAdded === 1 ? "defect" : "defects"} logged` : ""}
          {imported.propertyFieldsUpdated.length > 0 ? `, property details updated` : ""}
          {imported.report.document ? ". The report is filed under Files." : "."}
        </p>
      )}

      {applyTemplate.isSuccess && applyTemplate.data.added.length === 0 && (
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--ink-3)" }}>
          Nothing to add — every item on the list that fits this property is already here.
        </p>
      )}

      {/* The budget strip: only once there is money to talk about. */}
      {summary.costToCureCents > 0 && (
        <section
          aria-label="Repair budget"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
            marginBottom: 18,
            padding: "12px 14px",
            borderRadius: 14,
            border: "1px solid var(--line)",
            background: "var(--panel)",
          }}
        >
          <div style={{ fontSize: 13.5 }}>
            <span className="kr-label" style={{ display: "block", fontSize: 9.5 }}>
              Estimated cost to cure
            </span>
            <span className="kr-tabular" style={{ fontSize: 18, fontWeight: 700 }}>
              {formatCents(summary.costToCureCents)}
            </span>
            <span style={{ marginLeft: 8, color: "var(--ink-3)", fontSize: 12.5 }}>
              {summary.unbudgetedCents > 0
                ? `${formatCents(summary.unbudgetedCents)} not on a budget yet`
                : "all of it budgeted"}
            </span>
          </div>
          {summary.unbudgetedCents > 0 && (
            <Button onClick={() => budget.mutate()} disabled={budget.isPending}>
              {budget.isPending ? "Budgeting…" : "Budget the repairs"}
            </Button>
          )}
          {budget.isSuccess && budget.data.project && (
            <p style={{ margin: 0, width: "100%", fontSize: 12.5, color: "var(--ink-2)" }}>
              {budget.data.linked.length} {budget.data.linked.length === 1 ? "repair" : "repairs"}{" "}
              {budget.data.created ? "budgeted on a new project," : "added to"}{" "}
              <Link to={`/p/${propertyId}/projects?project=${budget.data.project.id}`}>
                {budget.data.project.title}
              </Link>
              . Spend against it reaches the ledger like any other project.
            </p>
          )}
        </section>
      )}

      {adding && (
        <div
          style={{
            display: "grid",
            gap: 10,
            marginBottom: 18,
            padding: 14,
            borderRadius: 14,
            border: "1px solid var(--line)",
            background: "var(--panel)",
          }}
        >
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div style={{ flex: 2, minWidth: 200 }}>
              <Field label={adding === "defect" ? "What is wrong, and where" : "What do you need"}>
                <TextInput
                  autoFocus
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder={adding === "defect" ? "Soft decking at the rear stair" : "Septic operation permit"}
                />
              </Field>
            </div>
            {adding === "defect" ? (
              <div style={{ flex: 1, minWidth: 150 }}>
                <Field label="Rough cost to fix" hint="Optional. Builds the budget.">
                  <NumericInput value={estimate} onChange={setEstimate} group min={0} placeholder="0" />
                </Field>
              </div>
            ) : (
              <>
                <div style={{ flex: 1, minWidth: 150 }}>
                  <Field label="Section">
                    <Select value={section} onChange={(e) => setSection(e.target.value as AppraisalSection)}>
                      {APPRAISAL_SECTION_ORDER.map((s) => (
                        <option key={s} value={s}>
                          {APPRAISAL_SECTION_LABELS[s]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <div style={{ flex: 1, minWidth: 120 }}>
                  <Field label="Kind">
                    <Select value={kind} onChange={(e) => setKind(e.target.value as AppraisalKind)}>
                      {KINDS.map((k) => (
                        <option key={k} value={k}>
                          {APPRAISAL_KIND_LABELS[k]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
              </>
            )}
          </div>
          <Field label="Notes" hint="Optional.">
            <TextArea rows={2} value={detail} onChange={(e) => setDetail(e.target.value)} />
          </Field>
          <div>
            <Button onClick={() => add.mutate()} disabled={!label.trim() || add.isPending}>
              {add.isPending ? "Adding…" : adding === "defect" ? "Log the defect" : "Add to the list"}
            </Button>
          </div>
        </div>
      )}

      {items.length === 0 && <PastAppraisals reports={dossier.appraisalReports} onChanged={invalidate} />}
      {items.length === 0 ? (
        <EmptyState
          title="Nothing on the list"
          detail="Start from the UAD 3.6 list — it only adds what fits this property — and mark N/A what does not apply."
          action={
            <Button onClick={() => applyTemplate.mutate()} disabled={applyTemplate.isPending}>
              Add the UAD 3.6 list
            </Button>
          }
        />
      ) : (
        <>
          <div style={{ display: "grid", gap: 22, gridTemplateColumns: "minmax(0, 1fr)" }}>
            {grouped.map((group) => (
              <section key={group.section}>
                <h3 className="kr-label" style={{ margin: "0 0 10px" }}>
                  {APPRAISAL_SECTION_LABELS[group.section]}
                </h3>
                {group.section === "updates" && finishedProjects.length > 0 && (
                  <p style={{ margin: "0 0 10px", fontSize: 12.5, color: "var(--ink-3)" }}>
                    Finished projects on file:{" "}
                    {finishedProjects
                      .map(
                        (p) =>
                          `${p.title}${p.actualEnd ? ` (${formatDate(p.actualEnd)})` : ""}${
                            p.actualTotalCents > 0 ? ` — ${formatCents(p.actualTotalCents)}` : ""
                          }`,
                      )
                      .join(" · ")}
                  </p>
                )}
                {group.items.length === 0 ? (
                  <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-3)" }}>
                    None logged. Use “+ Defect” for each thing you find on the walk-through.
                  </p>
                ) : (
                  <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10, gridTemplateColumns: "minmax(0, 1fr)" }}>
                    {group.items.map((item) => (
                      <li key={item.id}>
                        <ExpandableRow
                          color={color}
                          defaultOpen={highlighted === item.id}
                          label={`Appraisal item: ${item.label}`}
                          entityType="appraisal_item"
                          entityId={item.id}
                          summary={<ItemSummary item={item} />}
                        >
                          <ItemDetail item={item} onChanged={invalidate} />
                        </ExpandableRow>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>

          <PastAppraisals reports={dossier.appraisalReports} onChanged={invalidate} />

          <section style={{ marginTop: 26 }}>
            <h3 className="kr-label" style={{ margin: "0 0 8px" }}>
              The binder
            </h3>
            <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--ink-2)", maxWidth: "62ch" }}>
              One download for the appraiser or the lender: a summary in report order and every attached
              file, foldered by section. Items marked N/A are left out.
            </p>
            <a
              href={`/api/properties/${propertyId}/appraisal/binder.zip`}
              download
              className="kr-quiet-action"
              style={{ fontWeight: 600 }}
            >
              Download the binder (.zip)
            </a>
          </section>
        </>
      )}
    </div>
  );
}

/** The property's appraisal history, from imports. */
function PastAppraisals({ reports, onChanged }: { reports: AppraisalReportView[]; onChanged: () => void }): ReactElement | null {
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/appraisal-reports/${id}`),
    onSuccess: onChanged,
  });
  if (reports.length === 0) return null;
  return (
    <section style={{ marginTop: 26 }}>
      <h3 className="kr-label" style={{ margin: "0 0 8px" }}>
        Past appraisals
      </h3>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8, gridTemplateColumns: "minmax(0, 1fr)" }}>
        {reports.map((r) => (
          <li
            key={r.id}
            style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", fontSize: 13.5, padding: "10px 12px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--panel)" }}
          >
            <span style={{ minWidth: 0, flex: 1 }}>
              <strong className="kr-tabular">{r.opinionOfValueCents !== null ? formatCents(r.opinionOfValueCents) : "Value not read"}</strong>
              <span style={{ color: "var(--ink-2)" }}>
                {r.effectiveDate ? ` · ${formatDate(r.effectiveDate)}` : ""}
                {r.assignmentType ? ` · ${r.assignmentType}` : ""}
                {r.overallCondition ? ` · ${r.overallCondition}/${r.overallQuality ?? "?"}` : ""}
              </span>
              <span style={{ display: "block", fontSize: 12, color: "var(--ink-3)" }}>
                {r.sourceFormat === "uad36_xml" ? "UAD 3.6 data" : "PDF"} · {r.itemsFilled} filled · {r.defectsAdded} defects
              </span>
            </span>
            {r.document && (
              <a href={r.document.url} target="_blank" rel="noopener noreferrer" className="kr-quiet-action">
                Open report
              </a>
            )}
            <button
              type="button"
              className="kr-quiet-action"
              onClick={() => remove.mutate(r.id)}
              disabled={remove.isPending}
              title="Removes it from this history. The report stays in Files."
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ItemSummary({ item }: { item: AppraisalItemView }): ReactElement {
  const na = item.status === "not_applicable";
  const meta = [
    item.kind === "defect" && item.recommendedAction ? APPRAISAL_ACTION_LABELS[item.recommendedAction] : null,
    item.kind === "defect" && item.estimateCents ? formatCents(item.estimateCents) : null,
    item.documents.length > 0
      ? `${item.documents.length} ${item.documents.length === 1 ? "file" : "files"}`
      : null,
    item.asOf ? `as of ${formatDate(item.asOf)}` : null,
    item.finding,
  ].filter(Boolean);

  return (
    <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <span style={{ minWidth: 0 }}>
        <span
          style={{
            display: "block",
            fontWeight: 600,
            fontSize: 14.5,
            textDecoration: na ? "line-through" : undefined,
            color: na ? "var(--ink-3)" : undefined,
          }}
        >
          {item.label}
        </span>
        {meta.length > 0 && (
          <span
            style={{
              display: "block",
              fontSize: 12.5,
              color: "var(--ink-3)",
              marginTop: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {meta.join(" · ")}
          </span>
        )}
      </span>
      <StatusPill severity={severity(item)} label={appraisalStatusLabel(item.status, item.kind)} />
    </span>
  );
}

function ItemDetail({ item, onChanged }: { item: AppraisalItemView; onChanged: () => void }): ReactElement {
  const [finding, setFinding] = useState(item.finding ?? "");
  const [asOf, setAsOf] = useState(item.asOf ?? "");
  const [estimate, setEstimate] = useState((item.estimateCents ?? 0) / 100);
  const fileInputId = useId();
  const isDefect = item.kind === "defect";

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiPatch<AppraisalItemView>(`/api/appraisal-items/${item.id}`, {
        ...body,
        expectedVersion: item.version,
      }),
    onSuccess: onChanged,
  });

  const remove = useMutation({
    mutationFn: () => apiDelete(`/api/appraisal-items/${item.id}`),
    onSuccess: onChanged,
  });

  /**
   * Upload against the PROPERTY first, then link it here — so the file lives
   * in Files whatever later happens to this row. Several at once: "every
   * bathroom" is one photo per bathroom.
   */
  const attach = useMutation({
    mutationFn: async (files: File[]) => {
      for (const file of files) {
        const form = new FormData();
        form.append("file", file);
        form.append("parentType", "property");
        form.append("parentId", item.propertyId);
        const uploaded = await apiUpload("/api/uploads", form);
        await apiPost(`/api/appraisal-items/${item.id}/uploads`, { uploadId: uploaded.id });
      }
    },
    onSettled: onChanged,
  });

  const detach = useMutation({
    mutationFn: (uploadId: string) => apiDelete(`/api/appraisal-items/${item.id}/uploads/${uploadId}`),
    onSuccess: onChanged,
  });

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {item.detail && (
        <div>
          <span className="kr-label" style={{ fontSize: 9.5 }}>
            What the appraiser looks for
          </span>
          <p style={{ margin: "6px 0 0", fontSize: 13.5, color: "var(--ink-2)" }}>{item.detail}</p>
        </div>
      )}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 150 }}>
          <Field label="Status">
            <Select
              value={item.status}
              onChange={(e) => patch.mutate({ status: e.target.value as AppraisalStatus })}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {appraisalStatusLabel(s, item.kind)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div style={{ flex: 1, minWidth: 150 }}>
          <Field
            label={isDefect ? "Found on" : "As of"}
            hint={isDefect ? "When you spotted it." : "When it was measured, installed or done."}
          >
            <TextInput
              type="date"
              value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
              onBlur={() => {
                if ((item.asOf ?? "") !== asOf) patch.mutate({ asOf: asOf || null });
              }}
            />
          </Field>
        </div>
      </div>

      {isDefect && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: 1, minWidth: 150 }}>
            <Field label="Recommended action">
              <Select
                value={item.recommendedAction ?? "repair"}
                onChange={(e) => patch.mutate({ recommendedAction: e.target.value })}
              >
                {ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {APPRAISAL_ACTION_LABELS[a]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div style={{ flex: 1, minWidth: 150 }}>
            <Field label="Cost to cure, estimated">
              <NumericInput value={estimate} onChange={setEstimate} group min={0} />
            </Field>
          </div>
          {Math.round(estimate * 100) !== (item.estimateCents ?? 0) && (
            <Button
              onClick={() => patch.mutate({ estimateCents: estimate > 0 ? Math.round(estimate * 100) : null })}
              disabled={patch.isPending}
            >
              Save estimate
            </Button>
          )}
        </div>
      )}
      {isDefect && item.project && (
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-2)" }}>
          Budgeted on{" "}
          <Link to={`/p/${item.propertyId}/projects?project=${item.project.id}`}>{item.project.title}</Link>.
        </p>
      )}

      <div>
        <Field label={isDefect ? "Notes" : "What you have"}>
          <TextArea
            rows={3}
            value={finding}
            onChange={(e) => setFinding(e.target.value)}
            placeholder={isDefect ? "Two boards, left of the landing" : "1,842 sq ft above grade, measured October"}
          />
        </Field>
        {finding !== (item.finding ?? "") && (
          <Button onClick={() => patch.mutate({ finding: finding.trim() || null })} disabled={patch.isPending}>
            Save
          </Button>
        )}
      </div>

      <div>
        <span className="kr-label" style={{ fontSize: 9.5 }}>
          Files
        </span>
        {item.documents.length === 0 ? (
          <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "var(--ink-3)" }}>
            Nothing attached. Files added here are filed under the property too, and stay there if this
            item is removed.
          </p>
        ) : (
          <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0, display: "grid", gap: 6 }}>
            {item.documents.map((doc) => (
              <li key={doc.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
                {doc.kind === "image" && doc.thumbUrl && (
                  <img src={doc.thumbUrl} alt="" width={36} height={36} style={{ borderRadius: 6, objectFit: "cover" }} />
                )}
                <a href={doc.url} target="_blank" rel="noopener noreferrer" style={{ minWidth: 0, flex: 1 }}>
                  {doc.filename}
                </a>
                <button
                  type="button"
                  className="kr-quiet-action"
                  onClick={() => detach.mutate(doc.id)}
                  disabled={detach.isPending}
                  title="Detach from this item. The file stays in Files."
                >
                  Detach
                </button>
              </li>
            ))}
          </ul>
        )}
        <label
          htmlFor={fileInputId}
          className="kr-quiet-action"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 8, cursor: "pointer" }}
        >
          <CameraIcon width={14} height={14} />
          {attach.isPending ? "Attaching…" : item.kind === "photo" ? "Add photos" : "Attach files"}
        </label>
        <input
          id={fileInputId}
          type="file"
          multiple
          accept="image/*,application/pdf"
          className="kr-visually-hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length) attach.mutate(files);
            e.target.value = "";
          }}
        />
      </div>

      <div>
        <button
          type="button"
          className="kr-quiet-action"
          onClick={() => remove.mutate()}
          disabled={remove.isPending}
        >
          Remove from the list
        </button>
      </div>
    </div>
  );
}
