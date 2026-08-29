import { useState, type ReactElement } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import type { ProjectLineKind, ProjectStatus, ProjectView } from "../../../shared/types";
import { apiPatch, apiPost } from "../../lib/api";
import { qk } from "../../lib/query";
import { useDossier } from "../../lib/dossier-context";
import { formatCents, formatDate } from "../../lib/format";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { EmptyState, Field, Select, TextInput } from "../../components/Form";
import { LockedTextArea } from "../../components/LockedField";
import { StatusPill } from "../../components/StatusPill";

const STATUSES: ProjectStatus[] = ["idea", "planning", "quoted", "approved", "in_progress", "blocked", "done", "cancelled"];

function statusSeverity(s: ProjectStatus): "ok" | "warn" | "urgent" | "neutral" {
  if (s === "done") return "ok";
  if (s === "blocked" || s === "cancelled") return "urgent";
  if (s === "in_progress" || s === "quoted" || s === "approved") return "warn";
  return "neutral";
}

export function ProjectsTab(): ReactElement {
  const dossier = useDossier();
  const [params, setParams] = useSearchParams();
  const [showNew, setShowNew] = useState(false);
  const [title, setTitle] = useState("");
  const queryClient = useQueryClient();

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: qk.dossier(dossier.property.id) });
    void queryClient.invalidateQueries({ queryKey: qk.dashboard });
  }

  const create = useMutation({
    mutationFn: () => apiPost<ProjectView>(`/api/properties/${dossier.property.id}/projects`, { title, status: "idea", priority: "normal" }),
    onSuccess: (p) => {
      setTitle("");
      setShowNew(false);
      invalidate();
      setParams({ project: p.id });
    },
  });

  const openId = params.get("project");
  const open = dossier.projects.find((p) => p.id === openId) ?? null;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-900">Long-term projects</h2>
        <Button onClick={() => setShowNew((v) => !v)}>+ Project</Button>
      </div>

      {showNew && (
        <div className="mb-4 rounded-xl border border-slate-200 bg-white p-3">
          <Field label="Project title">
            <TextInput autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Button onClick={() => create.mutate()} disabled={!title.trim() || create.isPending}>
            {create.isPending ? "Creating…" : "Create"}
          </Button>
        </div>
      )}

      {dossier.projects.length === 0 ? (
        <EmptyState title="No projects yet" detail="Track renovations and bigger spends here." />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {dossier.projects.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => setParams({ project: p.id })}
                className="tap-target block w-full rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-brand-300"
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <p className="truncate font-semibold text-slate-900">{p.title}</p>
                  <StatusPill severity={statusSeverity(p.status)} label={p.status.replace("_", " ")} />
                </div>
                <p className="text-sm text-slate-500">
                  Budget {formatCents(p.budgetTotalCents)} · Actual {formatCents(p.actualTotalCents)}
                </p>
                <p className={`text-sm font-semibold ${p.varianceCents < 0 ? "text-red-700" : "text-emerald-700"}`}>
                  {p.varianceCents < 0 ? "Over" : "Under"} budget by {formatCents(Math.abs(p.varianceCents))}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <ProjectDialog
          project={open}
          onClose={() => {
            params.delete("project");
            setParams(params);
          }}
          onChanged={invalidate}
        />
      )}
    </div>
  );
}

function ProjectDialog(props: { project: ProjectView; onClose: () => void; onChanged: () => void }): ReactElement {
  const p = props.project;
  const [description, setDescription] = useState(p.description ?? "");
  const [lineLabel, setLineLabel] = useState("");
  const [lineAmount, setLineAmount] = useState("");
  const [lineKind, setLineKind] = useState<ProjectLineKind>("expense");

  const setStatus = useMutation({
    mutationFn: (status: ProjectStatus) => apiPatch<ProjectView>(`/api/projects/${p.id}`, { status, expectedVersion: p.version }),
    onSuccess: props.onChanged,
  });

  const saveDescription = useMutation({
    mutationFn: () => apiPatch<ProjectView>(`/api/projects/${p.id}`, { description, expectedVersion: p.version }),
    onSuccess: props.onChanged,
  });

  const addLine = useMutation({
    mutationFn: () => {
      const amountCents = Math.round(parseFloat(lineAmount || "0") * 100);
      return apiPost(`/api/projects/${p.id}/lines`, { kind: lineKind, label: lineLabel, amountCents, incurredOn: lineKind === "expense" ? new Date().toISOString().slice(0, 10) : null });
    },
    onSuccess: () => {
      setLineLabel("");
      setLineAmount("");
      props.onChanged();
    },
  });

  return (
    <Dialog open onClose={props.onClose} title={p.title} wide>
      <div className="mb-3 grid gap-3 sm:grid-cols-3">
        <Field label="Status">
          <Select value={p.status} onChange={(e) => setStatus.mutate(e.target.value as ProjectStatus)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </Select>
        </Field>
        <div>
          <p className="mb-1 text-sm font-medium text-slate-700">Budget vs actual</p>
          <p className="text-sm text-slate-600">
            {formatCents(p.budgetTotalCents)} budget / {formatCents(p.actualTotalCents)} actual
          </p>
        </div>
        <div>
          <p className="mb-1 text-sm font-medium text-slate-700">Variance</p>
          <p className={`text-sm font-semibold ${p.varianceCents < 0 ? "text-red-700" : "text-emerald-700"}`}>
            {formatCents(p.varianceCents)}
          </p>
        </div>
      </div>

      <Field label="Description">
        <LockedTextArea entityType="project" entityId={p.id} field="description" value={description} onChange={setDescription} mentionable rows={3} />
      </Field>
      {description !== (p.description ?? "") && (
        <Button onClick={() => saveDescription.mutate()} disabled={saveDescription.isPending} className="mb-4">
          Save description
        </Button>
      )}

      <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">Budget & expense lines</h3>
      <ul className="mb-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
        {p.lines.map((line) => (
          <li key={line.id} className="flex items-center justify-between px-3 py-2 text-sm">
            <span>
              <span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold uppercase text-slate-500">{line.kind}</span>
              {line.label}
              {line.incurredOn && <span className="text-slate-400"> · {formatDate(line.incurredOn)}</span>}
            </span>
            <span className="font-semibold">{formatCents(line.amountCents)}</span>
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-[1fr_1fr_auto_auto] items-end gap-2">
        <Field label="Line item">
          <TextInput value={lineLabel} onChange={(e) => setLineLabel(e.target.value)} />
        </Field>
        <Field label="Amount">
          <TextInput inputMode="decimal" value={lineAmount} onChange={(e) => setLineAmount(e.target.value)} placeholder="0.00" />
        </Field>
        <Field label="Kind">
          <Select value={lineKind} onChange={(e) => setLineKind(e.target.value as ProjectLineKind)}>
            <option value="budget">Budget</option>
            <option value="expense">Expense</option>
          </Select>
        </Field>
        <Button onClick={() => addLine.mutate()} disabled={!lineLabel.trim() || !lineAmount || addLine.isPending}>
          Add
        </Button>
      </div>
    </Dialog>
  );
}
