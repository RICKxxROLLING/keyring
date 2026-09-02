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
import { ExpandableRow } from "../../components/ExpandableRow";
import { WorkOrderDetail } from "../../components/WorkOrderDetail";
import { NotForProspect } from "../../components/NotForProspect";

const FREQUENCIES: PmFrequency[] = ["monthly", "quarterly", "semiannual", "annual", "custom_days"];

/** Reads the cadence the way you would say it out loud. */
function frequencyLabel(tpl: { frequency: PmFrequency; intervalDays: number | null }): string {
  if (tpl.frequency === "custom_days") {
    return tpl.intervalDays ? `Every ${tpl.intervalDays} days` : "Custom interval";
  }
  return tpl.frequency.charAt(0).toUpperCase() + tpl.frequency.slice(1);
}

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

  /**
   * Edit one field of a recurring schedule.
   *
   * Each control sends only what it changed, with the template's current
   * version — so two people editing different fields of the same schedule
   * don't clobber each other, and a stale edit comes back as a conflict
   * rather than silently winning.
   */
  const patchPm = useMutation({
    mutationFn: ({ tpl, body }: { tpl: PmTemplate; body: Record<string, unknown> }) =>
      apiPatch<PmTemplate>(`/api/pm-templates/${tpl.id}`, {
        ...body,
        expectedVersion: tpl.version,
      }),
    onSuccess: invalidate,
  });

  const sorted = [...dossier.workOrders].sort((a, b) => {
    const open = (w: WorkOrderView) => (w.status === "done" || w.status === "cancelled" ? 1 : 0);
    return open(a) - open(b) || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999");
  });

  return (
    <div>
      <NotForProspect what="The maintenance queue" />
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
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
          {dossier.pmTemplates.map((tpl) => (
            <li key={tpl.id}>
              <ExpandableRow
                color={dossier.property.heroColor}
                label={`Recurring: ${tpl.title}`}
                entityType="pm_template"
                entityId={tpl.id}
                summary={
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                    }}
                  >
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: "block", fontWeight: 600, fontSize: 14.5 }}>
                        {tpl.title}
                      </span>
                      <span
                        style={{
                          display: "block",
                          fontSize: 12.5,
                          color: "var(--ink-3)",
                          marginTop: 2,
                        }}
                      >
                        {frequencyLabel(tpl)} · next {formatDate(tpl.nextDueDate)}
                      </span>
                    </span>
                    <span
                      className="kr-label"
                      style={{
                        flex: "none",
                        padding: "3px 9px",
                        borderRadius: 999,
                        fontSize: 9,
                        background: tpl.active ? "var(--ok-fill)" : "var(--panel-2)",
                        color: tpl.active ? "var(--ok)" : "var(--ink-3)",
                      }}
                    >
                      {tpl.active ? "Active" : "Paused"}
                    </span>
                  </span>
                }
              >
                {/* The controls the tracking list asked for: change the
                    cadence, add detail, or stop it generating — without
                    deleting the history of what it already produced. */}
                <div
                  style={{
                    display: "grid",
                    gap: 12,
                    gridTemplateColumns: "repeat(auto-fit, minmax(min(180px, 100%), 1fr))",
                    marginTop: 12,
                  }}
                >
                  <Field label="Frequency">
                    <Select
                      value={tpl.frequency}
                      onChange={(e) =>
                        patchPm.mutate({ tpl, body: { frequency: e.target.value } })
                      }
                    >
                      {FREQUENCIES.map((f) => (
                        <option key={f} value={f}>
                          {f.replace("_", " ")}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {tpl.frequency === "custom_days" && (
                    <Field label="Every N days">
                      <TextInput
                        inputMode="numeric"
                        defaultValue={String(tpl.intervalDays ?? 30)}
                        onBlur={(e) => {
                          const n = Number(e.target.value);
                          if (Number.isFinite(n) && n > 0 && n !== tpl.intervalDays) {
                            patchPm.mutate({ tpl, body: { intervalDays: Math.round(n) } });
                          }
                        }}
                      />
                    </Field>
                  )}
                  <Field label="Next due">
                    <TextInput
                      type="date"
                      defaultValue={tpl.nextDueDate}
                      onChange={(e) =>
                        e.target.value &&
                        patchPm.mutate({ tpl, body: { nextDueDate: e.target.value } })
                      }
                    />
                  </Field>
                  <Field label="Generate this many days early">
                    <TextInput
                      inputMode="numeric"
                      defaultValue={String(tpl.leadDays)}
                      onBlur={(e) => {
                        const n = Number(e.target.value);
                        if (Number.isFinite(n) && n >= 0 && n !== tpl.leadDays) {
                          patchPm.mutate({ tpl, body: { leadDays: Math.round(n) } });
                        }
                      }}
                    />
                  </Field>
                </div>

                <Field label="Details" hint="Carried onto every work order this creates.">
                  <TextInput
                    defaultValue={tpl.description ?? ""}
                    placeholder="Filter size, access notes, who to call…"
                    onBlur={(e) => {
                      if (e.target.value !== (tpl.description ?? "")) {
                        patchPm.mutate({ tpl, body: { description: e.target.value || null } });
                      }
                    }}
                  />
                </Field>

                <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
                  <Button variant="secondary" onClick={() => togglePmActive.mutate(tpl)}>
                    {tpl.active ? "Pause this schedule" : "Resume this schedule"}
                  </Button>
                  <span style={{ fontSize: 12.5, color: "var(--ink-3)", alignSelf: "center" }}>
                    {tpl.active
                      ? "Pausing stops new work orders. Ones already created stay."
                      : "Paused — nothing new is being generated."}
                  </span>
                </div>
              </ExpandableRow>
            </li>
          ))}
        </ul>
      )}

      {openWo && (
        <WorkOrderDetail
          color={dossier.property.heroColor}
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
