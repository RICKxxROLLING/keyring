import { useState, type ReactElement } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import type {
  ExpenseCategory,
  ProjectStatus,
  ProjectView,
  PropertyExpense,
} from "../../../shared/types";
import { apiPatch, apiPost } from "../../lib/api";
import { qk } from "../../lib/query";
import { useDossier } from "../../lib/dossier-context";
import { formatCents, formatDate, parseMoneyInput } from "../../lib/format";
import { Button } from "../../components/Button";
import { EmptyState, Field, Select, TextInput } from "../../components/Form";
import { LockedTextArea } from "../../components/LockedField";
import { StatusPill } from "../../components/StatusPill";
import { ExpandableRow } from "../../components/ExpandableRow";
import type { Severity } from "../../lib/status";

/**
 * The work a property needs — and what it is costing.
 *
 * On a prospect this is the tab that decides the deal: everything that has to
 * happen before the house can be rented, priced. On one you already own it is
 * the same thing under a duller name.
 *
 * THE LEDGER TIE. Budget lines live on the project because they are a plan, and
 * a plan is nobody's money yet. Actual costs do not: logging one writes a row
 * to the property ledger tagged to this project. One payment, one row, read by
 * this tab and by the money page alike.
 *
 * The alternative — a cost recorded here AND an expense recorded there — is two
 * numbers for one payment, and they only have to disagree once before you stop
 * believing either. So there is deliberately no way to record spend on a
 * project that the ledger does not see.
 */
const STATUSES: ProjectStatus[] = [
  "idea",
  "planning",
  "quoted",
  "approved",
  "in_progress",
  "blocked",
  "done",
  "cancelled",
];

const COST_CATEGORIES: ExpenseCategory[] = ["capex", "repair", "supplies", "legal", "other"];

function statusSeverity(s: ProjectStatus): Severity {
  if (s === "done") return "ok";
  if (s === "blocked") return "urgent";
  if (s === "cancelled") return "neutral";
  if (s === "in_progress" || s === "quoted" || s === "approved") return "warn";
  return "neutral";
}

export function RenovationTab(): ReactElement {
  const dossier = useDossier();
  const [params, setParams] = useSearchParams();
  const [showNew, setShowNew] = useState(false);
  const [title, setTitle] = useState("");
  const queryClient = useQueryClient();

  const prospect = dossier.property.stage === "prospect";
  const color = dossier.property.heroColor;

  function invalidate(): void {
    void queryClient.invalidateQueries({ queryKey: qk.dossier(dossier.property.id) });
    void queryClient.invalidateQueries({ queryKey: qk.dashboard });
  }

  const create = useMutation({
    mutationFn: () =>
      apiPost<ProjectView>(`/api/properties/${dossier.property.id}/projects`, {
        title,
        status: "idea",
        priority: "normal",
      }),
    onSuccess: (p) => {
      setTitle("");
      setShowNew(false);
      invalidate();
      setParams({ project: p.id });
    },
  });

  const live = dossier.projects.filter((p) => p.status !== "cancelled");
  const budgeted = live.reduce((sum, p) => sum + p.budgetTotalCents, 0);
  const spent = live.reduce((sum, p) => sum + p.actualTotalCents, 0);
  const openProject = params.get("project");

  return (
    <div>
      <header
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 16,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <h2 className="kr-display kr-h-section" style={{ margin: 0, fontSize: 20 }}>
            {prospect ? "Getting it rentable" : "Projects"}
          </h2>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--ink-2)", maxWidth: "60ch" }}>
            {prospect
              ? "The work this house needs before anyone can stay in it. Budget what you think it takes; log what it actually costs, and it lands in the ledger too."
              : "Bigger pieces of work, budgeted and tracked. Costs logged here are ledger entries, so they show up in the property's money."}
          </p>
        </div>
        <Button onClick={() => setShowNew((v) => !v)}>+ Project</Button>
      </header>

      {/* Budget, spend, and the gap. The gap is the number people actually
          look for, so it is not left as an exercise in mental arithmetic. */}
      <div
        className="kr-scroll-x"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(140px, 1fr))",
          gap: 1,
          marginBottom: 20,
          border: "1px solid var(--line)",
          background: "var(--line-soft)",
          borderRadius: 14,
          overflow: "hidden",
        }}
      >
        <Figure label="Budgeted" value={formatCents(budgeted)} />
        <Figure label="Spent" value={formatCents(spent)} />
        <Figure
          label={spent > budgeted ? "Over by" : "Left"}
          value={formatCents(Math.abs(budgeted - spent))}
          tone={spent > budgeted ? "var(--crit)" : undefined}
        />
      </div>

      {showNew && (
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "flex-end",
            flexWrap: "wrap",
            marginBottom: 16,
            padding: 14,
            borderRadius: 14,
            border: "1px solid var(--line)",
            background: "var(--panel)",
          }}
        >
          <div style={{ flex: 1, minWidth: 220 }}>
            <Field label="What needs doing">
              <TextInput
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={prospect ? "Kitchen and both baths" : "Exterior repaint"}
              />
            </Field>
          </div>
          <Button onClick={() => create.mutate()} disabled={!title.trim() || create.isPending}>
            {create.isPending ? "Adding…" : "Add project"}
          </Button>
        </div>
      )}

      {dossier.projects.length === 0 ? (
        <EmptyState
          title={prospect ? "Nothing scoped yet" : "No projects"}
          detail={
            prospect
              ? "Start with the things that stop it being rentable. Rough numbers are fine — that is what a budget is."
              : "Renovations and bigger spends go here."
          }
        />
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
          {dossier.projects.map((p) => (
            <li key={p.id}>
              <ExpandableRow
                color={color}
                defaultOpen={openProject === p.id}
                label={`Project: ${p.title}`}
                summary={<ProjectSummary project={p} />}
              >
                <ProjectDetail project={p} onChanged={invalidate} />
              </ExpandableRow>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProjectSummary({ project }: { project: ProjectView }): ReactElement {
  const over = project.actualTotalCents > project.budgetTotalCents && project.budgetTotalCents > 0;
  return (
    <span
      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}
    >
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontWeight: 600, fontSize: 14.5 }}>{project.title}</span>
        <span
          className="kr-tabular"
          style={{ display: "block", fontSize: 12.5, color: "var(--ink-3)", marginTop: 2 }}
        >
          {formatCents(project.actualTotalCents)} spent of {formatCents(project.budgetTotalCents)}
          {over ? " — over budget" : ""}
        </span>
      </span>
      <StatusPill
        severity={statusSeverity(project.status)}
        label={project.status.replace("_", " ")}
      />
    </span>
  );
}

function ProjectDetail({
  project,
  onChanged,
}: {
  project: ProjectView;
  onChanged: () => void;
}): ReactElement {
  const dossier = useDossier();
  const [description, setDescription] = useState(project.description ?? "");

  const setStatus = useMutation({
    mutationFn: (status: ProjectStatus) =>
      apiPatch<ProjectView>(`/api/projects/${project.id}`, {
        status,
        expectedVersion: project.version,
      }),
    onSuccess: onChanged,
  });

  const saveDescription = useMutation({
    mutationFn: () =>
      apiPatch<ProjectView>(`/api/projects/${project.id}`, {
        description,
        expectedVersion: project.version,
      }),
    onSuccess: onChanged,
  });

  const budgetLines = project.lines.filter((l) => l.kind === "budget");
  // Costs recorded before this tab logged them to the ledger. Nothing creates
  // them any more, but they are real money and stay visible.
  const legacyLines = project.lines.filter((l) => l.kind === "expense");

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
        <Field label="Status">
          <Select
            value={project.status}
            onChange={(e) => setStatus.mutate(e.target.value as ProjectStatus)}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </Select>
        </Field>
        <Figure label="Budgeted" value={formatCents(project.budgetTotalCents)} plain />
        <Figure label="Spent" value={formatCents(project.actualTotalCents)} plain />
        <Figure
          label={project.varianceCents < 0 ? "Over by" : "Left"}
          value={formatCents(Math.abs(project.varianceCents))}
          tone={project.varianceCents < 0 ? "var(--crit)" : "var(--ok)"}
          plain
        />
      </div>

      <div>
        <Field label="Scope">
          <LockedTextArea
            entityType="project"
            entityId={project.id}
            field="description"
            value={description}
            onChange={setDescription}
            mentionable
            rows={3}
          />
        </Field>
        {description !== (project.description ?? "") && (
          <Button onClick={() => saveDescription.mutate()} disabled={saveDescription.isPending}>
            Save scope
          </Button>
        )}
      </div>

      <BudgetLines project={project} lines={budgetLines} onChanged={onChanged} />

      <LedgerCosts project={project} propertyId={dossier.property.id} onChanged={onChanged} />

      {legacyLines.length > 0 && (
        <div>
          <span className="kr-label" style={{ fontSize: 9.5 }}>
            Recorded before costs went to the ledger
          </span>
          <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "grid", gap: 6 }}>
            {legacyLines.map((l) => (
              <li
                key={l.id}
                style={{ display: "flex", justifyContent: "space-between", fontSize: 13, gap: 12 }}
              >
                <span style={{ color: "var(--ink-2)" }}>
                  {l.label}
                  {l.incurredOn ? ` · ${formatDate(l.incurredOn)}` : ""}
                </span>
                <span className="kr-tabular" style={{ fontWeight: 600 }}>
                  {formatCents(l.amountCents)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function BudgetLines({
  project,
  lines,
  onChanged,
}: {
  project: ProjectView;
  lines: ProjectView["lines"];
  onChanged: () => void;
}): ReactElement {
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");

  const add = useMutation({
    mutationFn: () =>
      apiPost(`/api/projects/${project.id}/lines`, {
        kind: "budget",
        label,
        amountCents: parseMoneyInput(amount) ?? 0,
      }),
    onSuccess: () => {
      setLabel("");
      setAmount("");
      onChanged();
    },
  });

  return (
    <div>
      <span className="kr-label" style={{ fontSize: 9.5 }}>
        What you think it takes
      </span>
      {lines.length > 0 && (
        <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "grid", gap: 6 }}>
          {lines.map((l) => (
            <li
              key={l.id}
              style={{ display: "flex", justifyContent: "space-between", fontSize: 13, gap: 12 }}
            >
              <span style={{ color: "var(--ink-2)" }}>
                {l.label}
                {l.note ? ` — ${l.note}` : ""}
              </span>
              <span className="kr-tabular" style={{ fontWeight: 600 }}>
                {formatCents(l.amountCents)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "flex-end",
          flexWrap: "wrap",
          marginTop: 10,
        }}
      >
        <div style={{ flex: 2, minWidth: 160 }}>
          <Field label="Line">
            <TextInput
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Cabinets + counters"
            />
          </Field>
        </div>
        <div style={{ flex: 1, minWidth: 110 }}>
          <Field label="Estimate">
            <TextInput
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </Field>
        </div>
        <Button
          variant="secondary"
          onClick={() => add.mutate()}
          disabled={!label.trim() || parseMoneyInput(amount) === null || add.isPending}
        >
          Add to budget
        </Button>
      </div>
    </div>
  );
}

/**
 * Actual spend, which is to say ledger rows.
 *
 * The form posts to the property's expenses endpoint with this project's id
 * attached. There is no project-only cost store to fall out of sync with.
 */
function LedgerCosts({
  project,
  propertyId,
  onChanged,
}: {
  project: ProjectView;
  propertyId: string;
  onChanged: () => void;
}): ReactElement {
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<ExpenseCategory>("capex");
  const [incurredOn, setIncurredOn] = useState(() => new Date().toISOString().slice(0, 10));

  const log = useMutation({
    mutationFn: () =>
      apiPost<PropertyExpense>(`/api/properties/${propertyId}/expenses`, {
        description,
        amountCents: parseMoneyInput(amount) ?? 0,
        category,
        incurredOn,
        projectId: project.id,
      }),
    onSuccess: () => {
      setDescription("");
      setAmount("");
      setIncurredOn(new Date().toISOString().slice(0, 10));
      onChanged();
    },
  });

  return (
    <div>
      <span className="kr-label" style={{ fontSize: 9.5 }}>
        What it actually cost
      </span>
      <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--ink-3)" }}>
        These are entries in the property ledger. Adding one here adds it there.
      </p>
      {project.ledgerCosts.length > 0 && (
        <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0, display: "grid", gap: 6 }}>
          {project.ledgerCosts.map((e) => (
            <li
              key={e.id}
              style={{ display: "flex", justifyContent: "space-between", fontSize: 13, gap: 12 }}
            >
              <span style={{ color: "var(--ink-2)" }}>
                {e.description} · {formatDate(e.incurredOn)}
              </span>
              <span className="kr-tabular" style={{ fontWeight: 600 }}>
                {formatCents(e.amountCents)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginTop: 10 }}>
        <div style={{ flex: 2, minWidth: 160 }}>
          <Field label="What was paid for">
            <TextInput
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Cabinet deposit"
            />
          </Field>
        </div>
        <div style={{ flex: 1, minWidth: 110 }}>
          <Field label="Amount">
            <TextInput
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </Field>
        </div>
        <div style={{ flex: 1, minWidth: 120 }}>
          <Field label="Category">
            <Select
              value={category}
              onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
            >
              {COST_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div style={{ flex: 1, minWidth: 140 }}>
          <Field label="Date">
            <TextInput
              type="date"
              value={incurredOn}
              onChange={(e) => setIncurredOn(e.target.value)}
            />
          </Field>
        </div>
        <Button
          onClick={() => log.mutate()}
          disabled={!description.trim() || parseMoneyInput(amount) === null || log.isPending}
        >
          {log.isPending ? "Logging…" : "Log cost"}
        </Button>
      </div>
    </div>
  );
}

function Figure({
  label,
  value,
  tone,
  plain,
}: {
  label: string;
  value: string;
  tone?: string;
  plain?: boolean;
}): ReactElement {
  return (
    <div style={plain ? undefined : { background: "var(--panel)", padding: "14px 16px" }}>
      <span className="kr-label" style={{ fontSize: 9.5 }}>
        {label}
      </span>
      <p
        className="kr-display kr-tabular"
        style={{
          margin: "6px 0 0",
          fontSize: 19,
          lineHeight: 1,
          letterSpacing: "-0.015em",
          color: tone ?? "var(--ink)",
        }}
      >
        {value}
      </p>
    </div>
  );
}
