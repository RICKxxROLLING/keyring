import { useState, type ReactElement } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import type { PmFrequency, PmTemplate, WorkOrderView } from "../../../shared/types";
import { apiPatch, apiPost } from "../../lib/api";
import { qk } from "../../lib/query";
import { useDossier } from "../../lib/dossier-context";
import { formatDate } from "../../lib/format";
import { workOrderStatusDisplay } from "../../lib/status";
import { Button } from "../../components/Button";
import { EmptyState, Field, Select, TextInput } from "../../components/Form";
import { StatusPill } from "../../components/StatusPill";
import { WorkOrderDetail } from "../../components/WorkOrderDetail";

const FREQUENCIES: PmFrequency[] = ["monthly", "quarterly", "semiannual", "annual", "custom_days"];

export function MaintenanceTab(): ReactElement {
  const dossier = useDossier();
  const [params, setParams] = useSearchParams();
  const [showNewWo, setShowNewWo] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [showNewPm, setShowNewPm] = useState(false);
  const [pmTitle, setPmTitle] = useState("");
  const [pmFrequency, setPmFrequency] = useState<PmFrequency>("annual");
  const queryClient = useQueryClient();

  const openWoId = params.get("wo");
  const openWo = dossier.workOrders.find((w) => w.id === openWoId) ?? null;

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: qk.dossier(dossier.property.id) });
    void queryClient.invalidateQueries({ queryKey: qk.dashboard });
  }

  const createWo = useMutation({
    mutationFn: () => apiPost<WorkOrderView>(`/api/properties/${dossier.property.id}/work-orders`, { title: newTitle, priority: "normal" }),
    onSuccess: (wo) => {
      setNewTitle("");
      setShowNewWo(false);
      invalidate();
      setParams({ wo: wo.id });
    },
  });

  const createPm = useMutation({
    mutationFn: () =>
      apiPost<PmTemplate>(`/api/properties/${dossier.property.id}/pm-templates`, {
        title: pmTitle,
        priority: "normal",
        frequency: pmFrequency,
        anchorDate: new Date().toISOString().slice(0, 10),
        leadDays: 7,
      }),
    onSuccess: () => {
      setPmTitle("");
      setShowNewPm(false);
      invalidate();
    },
  });

  const togglePmActive = useMutation({
    mutationFn: (tpl: PmTemplate) => apiPatch<PmTemplate>(`/api/pm-templates/${tpl.id}`, { active: !tpl.active, expectedVersion: tpl.version }),
    onSuccess: invalidate,
  });

  const sorted = [...dossier.workOrders].sort((a, b) => {
    const open = (w: WorkOrderView) => (w.status === "done" || w.status === "cancelled" ? 1 : 0);
    return open(a) - open(b) || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999");
  });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-900">Work orders</h2>
        <Button onClick={() => setShowNewWo((v) => !v)}>+ Work order</Button>
      </div>

      {showNewWo && (
        <div className="mb-4 rounded-xl border border-slate-200 bg-white p-3">
          <Field label="What needs doing?">
            <TextInput autoFocus value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
          </Field>
          <Button onClick={() => createWo.mutate()} disabled={!newTitle.trim() || createWo.isPending}>
            {createWo.isPending ? "Creating…" : "Create"}
          </Button>
        </div>
      )}

      {sorted.length === 0 ? (
        <EmptyState title="No work orders" detail="Create one from the button above." />
      ) : (
        <ul className="mb-6 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {sorted.map((wo) => {
            const status = workOrderStatusDisplay(wo.status, wo.isOverdue);
            return (
              <li key={wo.id}>
                <button
                  type="button"
                  onClick={() => setParams({ wo: wo.id })}
                  className="tap-target flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-900">
                      WO-{wo.number} · {wo.title}
                    </p>
                    <p className="truncate text-sm text-slate-500">
                      {wo.unitLabel ?? "Whole property"}
                      {wo.dueDate ? ` · Due ${formatDate(wo.dueDate)}` : ""}
                      {wo.assignee ? ` · ${wo.assignee.displayName}` : ""}
                    </p>
                  </div>
                  <StatusPill severity={status.severity} label={status.label} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-900">Recurring maintenance</h2>
        <Button variant="secondary" onClick={() => setShowNewPm((v) => !v)}>
          + PM template
        </Button>
      </div>

      {showNewPm && (
        <div className="mb-4 grid gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-2">
          <Field label="Title">
            <TextInput autoFocus value={pmTitle} onChange={(e) => setPmTitle(e.target.value)} />
          </Field>
          <Field label="Frequency">
            <Select value={pmFrequency} onChange={(e) => setPmFrequency(e.target.value as PmFrequency)}>
              {FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {f.replace("_", " ")}
                </option>
              ))}
            </Select>
          </Field>
          <Button onClick={() => createPm.mutate()} disabled={!pmTitle.trim() || createPm.isPending} className="sm:col-span-2">
            {createPm.isPending ? "Creating…" : "Create template"}
          </Button>
        </div>
      )}

      {dossier.pmTemplates.length === 0 ? (
        <EmptyState title="No recurring maintenance set up" />
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {dossier.pmTemplates.map((tpl) => (
            <li key={tpl.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate font-semibold text-slate-900">{tpl.title}</p>
                <p className="text-sm text-slate-500">
                  {tpl.frequency.replace("_", " ")} · Next due {formatDate(tpl.nextDueDate)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => togglePmActive.mutate(tpl)}
                className={`tap-target rounded-full px-3 py-1 text-xs font-semibold ${
                  tpl.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                }`}
              >
                {tpl.active ? "Active" : "Paused"}
              </button>
            </li>
          ))}
        </ul>
      )}

      {openWo && (
        <WorkOrderDetail
          workOrder={openWo}
          onClose={() => {
            params.delete("wo");
            setParams(params);
          }}
        />
      )}
    </div>
  );
}
