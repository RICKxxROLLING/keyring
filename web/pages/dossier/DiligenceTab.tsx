import { useId, useState, type ReactElement } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import type {
  DiligenceCategory,
  DiligenceItemView,
  DiligenceStatus,
} from "../../../shared/types";
import {
  DILIGENCE_CATEGORY_LABELS,
  summarizeDiligence,
} from "../../../shared/diligence-checklist";
import { apiDelete, apiPatch, apiPost, apiUpload } from "../../lib/api";
import { qk } from "../../lib/query";
import { useDossier } from "../../lib/dossier-context";
import { formatDate } from "../../lib/format";
import { Button } from "../../components/Button";
import { EmptyState, Field, Select, TextArea, TextInput } from "../../components/Form";
import { StatusPill } from "../../components/StatusPill";
import { ExpandableRow } from "../../components/ExpandableRow";
import { AttachmentList } from "../../components/AttachmentList";
import { CameraIcon } from "../../components/icons";
import type { Severity } from "../../lib/status";

/**
 * The errands you have to run before you can buy with your eyes open.
 *
 * Septic capacity, elevation, past permits — the things that are cheap to ask
 * about and expensive to discover afterwards. This is a list of questions with
 * a state each, not a set of checkboxes, because a checkbox cannot tell "the
 * county sent the permit" apart from "I read the permit and it is wrong", and
 * those are opposite outcomes.
 *
 * Ordered by category rather than by status. A status-ordered list reshuffles
 * itself every time you touch it, which makes it impossible to work down.
 */
const STATUSES: DiligenceStatus[] = [
  "todo",
  "requested",
  "received",
  "verified",
  "blocked",
  "not_applicable",
];

const STATUS_LABEL: Record<DiligenceStatus, string> = {
  todo: "Not asked",
  requested: "Asked",
  received: "Arrived",
  verified: "Checked",
  blocked: "Blocked",
  not_applicable: "N/A",
};

const CATEGORY_ORDER: DiligenceCategory[] = [
  "permits",
  "land",
  "structure",
  "financial",
  "legal",
  "other",
];

function statusSeverity(s: DiligenceStatus): Severity {
  if (s === "verified") return "ok";
  if (s === "blocked") return "urgent";
  if (s === "received") return "warn";
  return "neutral";
}

export function DiligenceTab(): ReactElement {
  const dossier = useDossier();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState<DiligenceCategory>("other");
  const [detail, setDetail] = useState("");

  const items = dossier.diligence;
  const summary = summarizeDiligence(items);
  const highlighted = params.get("item");
  const color = dossier.property.heroColor;

  function invalidate(): void {
    void queryClient.invalidateQueries({ queryKey: qk.dossier(dossier.property.id) });
  }

  const applyTemplate = useMutation({
    mutationFn: () =>
      apiPost<{ added: DiligenceItemView[]; skipped: number }>(
        `/api/properties/${dossier.property.id}/diligence/checklist`,
      ),
    onSuccess: invalidate,
  });

  const add = useMutation({
    mutationFn: () =>
      apiPost<DiligenceItemView>(`/api/properties/${dossier.property.id}/diligence`, {
        label,
        category,
        detail: detail.trim() || null,
      }),
    onSuccess: () => {
      setLabel("");
      setDetail("");
      setAdding(false);
      invalidate();
    },
  });

  const grouped = CATEGORY_ORDER.map((c) => ({
    category: c,
    items: items.filter((i) => i.category === c),
  })).filter((g) => g.items.length > 0);

  return (
    <div>
      <header
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 18,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <h2 className="kr-display kr-h-section" style={{ margin: 0, fontSize: 20 }}>
            What still needs checking
          </h2>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--ink-2)", maxWidth: "62ch" }}>
            {items.length === 0
              ? "Permits, elevation, septic, title — the questions that are cheap to ask now and expensive to answer later."
              : `${summary.outstanding} still open · ${summary.verified} checked${
                  summary.blocked > 0 ? ` · ${summary.blocked} blocked` : ""
                }`}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {/* Idempotent by label, so this is safe to press again later when the
              suggested list has grown or you have added items by hand. */}
          <Button
            variant="secondary"
            onClick={() => applyTemplate.mutate()}
            disabled={applyTemplate.isPending}
          >
            {applyTemplate.isPending ? "Adding…" : "Add the standard list"}
          </Button>
          <Button onClick={() => setAdding((v) => !v)}>+ Item</Button>
        </div>
      </header>

      {applyTemplate.isSuccess && applyTemplate.data.added.length === 0 && (
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--ink-3)" }}>
          Nothing to add — every item on the standard list is already here.
        </p>
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
              <Field label="What do you need">
                <TextInput
                  autoFocus
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Well water test"
                />
              </Field>
            </div>
            <div style={{ flex: 1, minWidth: 150 }}>
              <Field label="Kind">
                <Select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as DiligenceCategory)}
                >
                  {CATEGORY_ORDER.map((c) => (
                    <option key={c} value={c}>
                      {DILIGENCE_CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </div>
          <Field label="Where to get it" hint="Optional — but it is the part you forget.">
            <TextArea
              rows={2}
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder="County environmental health, ask for the improvement permit"
            />
          </Field>
          <div>
            <Button onClick={() => add.mutate()} disabled={!label.trim() || add.isPending}>
              {add.isPending ? "Adding…" : "Add to the list"}
            </Button>
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState
          title="Nothing on the list"
          detail="Start from the standard list and cut what does not apply — that is faster than remembering it all."
          action={
            <Button onClick={() => applyTemplate.mutate()} disabled={applyTemplate.isPending}>
              Add the standard list
            </Button>
          }
        />
      ) : (
        <div style={{ display: "grid", gap: 22 }}>
          {grouped.map((group) => (
            <section key={group.category}>
              <h3 className="kr-label" style={{ margin: "0 0 10px" }}>
                {DILIGENCE_CATEGORY_LABELS[group.category]}
              </h3>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
                {group.items.map((item) => (
                  <li key={item.id}>
                    <ExpandableRow
                      color={color}
                      defaultOpen={highlighted === item.id}
                      label={`Checklist item: ${item.label}`}
                      summary={<ItemSummary item={item} />}
                    >
                      <ItemDetail item={item} onChanged={invalidate} />
                    </ExpandableRow>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function ItemSummary({ item }: { item: DiligenceItemView }): ReactElement {
  const overdue =
    item.dueDate !== null &&
    item.status !== "verified" &&
    item.status !== "not_applicable" &&
    item.dueDate < new Date().toISOString().slice(0, 10);

  return (
    <span
      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}
    >
      <span style={{ minWidth: 0 }}>
        <span
          style={{
            display: "block",
            fontWeight: 600,
            fontSize: 14.5,
            // Struck through rather than hidden: knowing a question was asked
            // and ruled out is worth as much as the answer to a live one.
            textDecoration: item.status === "not_applicable" ? "line-through" : undefined,
            color: item.status === "not_applicable" ? "var(--ink-3)" : undefined,
          }}
        >
          {item.label}
        </span>
        {(item.finding || item.dueDate || item.assignee) && (
          <span
            style={{ display: "block", fontSize: 12.5, color: "var(--ink-3)", marginTop: 2 }}
          >
            {item.assignee ? `${item.assignee.displayName}` : ""}
            {item.assignee && item.dueDate ? " · " : ""}
            {item.dueDate ? `${overdue ? "overdue — was " : "by "}${formatDate(item.dueDate)}` : ""}
            {(item.assignee || item.dueDate) && item.finding ? " · " : ""}
            {item.finding}
          </span>
        )}
      </span>
      <StatusPill
        severity={overdue ? "urgent" : statusSeverity(item.status)}
        label={STATUS_LABEL[item.status]}
      />
    </span>
  );
}

function ItemDetail({
  item,
  onChanged,
}: {
  item: DiligenceItemView;
  onChanged: () => void;
}): ReactElement {
  const [finding, setFinding] = useState(item.finding ?? "");
  const [dueDate, setDueDate] = useState(item.dueDate ?? "");
  const fileInputId = useId();

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiPatch<DiligenceItemView>(`/api/diligence-items/${item.id}`, {
        ...body,
        expectedVersion: item.version,
      }),
    onSuccess: onChanged,
  });

  const remove = useMutation({
    mutationFn: () => apiDelete(`/api/diligence-items/${item.id}`),
    onSuccess: onChanged,
  });

  /**
   * Two steps, in this order: upload the file against the PROPERTY, then point
   * the item at it. The upload has to exist before anything can reference it,
   * and filing it under the property is what puts it in Papers.
   */
  const attach = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      form.append("parentType", "property");
      form.append("parentId", item.propertyId);
      const uploaded = await apiUpload("/api/uploads", form);
      return apiPatch<DiligenceItemView>(`/api/diligence-items/${item.id}`, {
        uploadId: uploaded.id,
        expectedVersion: item.version,
      });
    },
    onSuccess: onChanged,
  });

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {item.detail && (
        <div>
          <span className="kr-label" style={{ fontSize: 9.5 }}>
            What to ask for
          </span>
          <p style={{ margin: "6px 0 0", fontSize: 13.5, color: "var(--ink-2)" }}>{item.detail}</p>
        </div>
      )}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 160 }}>
          <Field label="Where it has got to">
            <Select
              value={item.status}
              onChange={(e) => patch.mutate({ status: e.target.value as DiligenceStatus })}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <Field label="Chase by" hint="Optional.">
            <TextInput
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              onBlur={() => {
                if ((item.dueDate ?? "") !== dueDate) patch.mutate({ dueDate: dueDate || null });
              }}
            />
          </Field>
        </div>
      </div>

      <div>
        {/* Separate from "what to ask for", which it must never overwrite: the
            question is what makes the answer interpretable a month later. */}
        <Field label="What came back">
          <TextArea
            rows={3}
            value={finding}
            onChange={(e) => setFinding(e.target.value)}
            placeholder="Permitted for 3 bedrooms. Listing says 4."
          />
        </Field>
        {finding !== (item.finding ?? "") && (
          <Button
            onClick={() => patch.mutate({ finding: finding.trim() || null })}
            disabled={patch.isPending}
          >
            Save
          </Button>
        )}
      </div>

      <div>
        <span className="kr-label" style={{ fontSize: 9.5 }}>
          Document
        </span>
        {item.document ? (
          <AttachmentList uploads={[item.document]} />
        ) : (
          <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "var(--ink-3)" }}>
            {/* Filed against the property, not hidden behind this row: a septic
                permit belongs in Papers with the deed and the survey, where it
                survives someone later marking this item not-applicable. */}
            Nothing attached. A file added here is filed under the property too.
          </p>
        )}
        {/* Label and input as siblings rather than the input nested inside the
            label: nesting makes the click that opens the picker bubble back
            through the label to the same input, and the association is no
            stronger for it. */}
        <label
          htmlFor={fileInputId}
          className="kr-quiet-action"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 8, cursor: "pointer" }}
        >
          <CameraIcon width={14} height={14} />
          {attach.isPending ? "Attaching…" : item.document ? "Replace the document" : "Attach the document"}
        </label>
        <input
          id={fileInputId}
          type="file"
          accept="image/*,application/pdf"
          className="kr-visually-hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) attach.mutate(file);
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
