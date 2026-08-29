import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import type { TurnoverItem, TurnoverView } from "../../../shared/types";
import { apiPatch, apiPost } from "../../lib/api";
import { qk } from "../../lib/query";
import { useDossier } from "../../lib/dossier-context";
import { formatDate } from "../../lib/format";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { EmptyState, Field, Select } from "../../components/Form";
import { LockedTextArea } from "../../components/LockedField";

const PHASE_LABEL: Record<string, string> = {
  move_out: "Move-out",
  make_ready: "Make-ready",
  move_in: "Move-in",
  complete: "Complete",
};

export function TurnoverTab(): JSX.Element {
  const dossier = useDossier();
  const [params, setParams] = useSearchParams();
  const [showNew, setShowNew] = useState(false);
  const [unitId, setUnitId] = useState(dossier.property.units[0]?.id ?? "");
  const queryClient = useQueryClient();

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: qk.dossier(dossier.property.id) });
    void queryClient.invalidateQueries({ queryKey: qk.dashboard });
  }

  const create = useMutation({
    mutationFn: () => apiPost<TurnoverView>(`/api/properties/${dossier.property.id}/turnovers`, { unitId, moveOutDate: new Date().toISOString().slice(0, 10) }),
    onSuccess: (t) => {
      setShowNew(false);
      invalidate();
      setParams({ turnover: t.id });
    },
  });

  const openId = params.get("turnover");
  const open = dossier.turnovers.find((t) => t.id === openId) ?? null;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-900">Turnover</h2>
        <Button onClick={() => setShowNew((v) => !v)}>+ Turnover</Button>
      </div>

      {showNew && (
        <div className="mb-4 flex items-end gap-3 rounded-xl border border-slate-200 bg-white p-3">
          <Field label="Unit">
            <Select value={unitId} onChange={(e) => setUnitId(e.target.value)}>
              {dossier.property.units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </Select>
          </Field>
          <Button onClick={() => create.mutate()} disabled={!unitId || create.isPending}>
            {create.isPending ? "Starting…" : "Start turnover"}
          </Button>
        </div>
      )}

      {dossier.turnovers.length === 0 ? (
        <EmptyState title="No turnovers in progress" />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {dossier.turnovers.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => setParams({ turnover: t.id })}
                className="tap-target block w-full rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-brand-300"
              >
                <p className="font-semibold text-slate-900">{t.unitLabel}</p>
                <p className="text-sm text-slate-500">{PHASE_LABEL[t.phase]} · {t.progress.done}/{t.progress.total} done</p>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-brand-500"
                    style={{ width: `${t.progress.total ? (t.progress.done / t.progress.total) * 100 : 0}%` }}
                  />
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <TurnoverDialog
          turnover={open}
          onClose={() => {
            params.delete("turnover");
            setParams(params);
          }}
          onChanged={invalidate}
        />
      )}
    </div>
  );
}

function TurnoverDialog(props: { turnover: TurnoverView; onClose: () => void; onChanged: () => void }): JSX.Element {
  const t = props.turnover;
  const [conditionNotes, setConditionNotes] = useState(t.conditionNotes ?? "");

  const toggleItem = useMutation({
    mutationFn: (item: TurnoverItem) => apiPatch(`/api/turnover-items/${item.id}`, { done: !item.done, expectedVersion: item.version }),
    onSuccess: props.onChanged,
  });

  const saveNotes = useMutation({
    mutationFn: () => apiPatch<TurnoverView>(`/api/turnovers/${t.id}`, { conditionNotes, expectedVersion: t.version }),
    onSuccess: props.onChanged,
  });

  return (
    <Dialog open onClose={props.onClose} title={`${t.unitLabel} turnover`} wide>
      <p className="mb-3 text-sm text-slate-500">
        {PHASE_LABEL[t.phase]} · {t.progress.done}/{t.progress.total} checklist items done
      </p>

      {["move_out", "make_ready", "move_in"].map((phase) => (
        <div key={phase} className="mb-3">
          <h3 className="mb-1 text-sm font-bold uppercase tracking-wide text-slate-500">{PHASE_LABEL[phase]}</h3>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {t.items.filter((i) => i.phase === phase).map((item) => (
              <li key={item.id} className="flex items-center gap-3 px-3 py-2">
                <input
                  type="checkbox"
                  checked={item.done}
                  onChange={() => toggleItem.mutate(item)}
                  className="h-5 w-5"
                  aria-label={item.label}
                />
                <span className={item.done ? "text-slate-400 line-through" : "text-slate-800"}>{item.label}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <Field label="Condition notes">
        <LockedTextArea entityType="turnover" entityId={t.id} field="conditionNotes" value={conditionNotes} onChange={setConditionNotes} rows={3} />
      </Field>
      {conditionNotes !== (t.conditionNotes ?? "") && (
        <Button onClick={() => saveNotes.mutate()} disabled={saveNotes.isPending}>
          Save notes
        </Button>
      )}

      <p className="mt-3 text-xs text-slate-400">Move-out {formatDate(t.moveOutDate)} · Target ready {formatDate(t.targetReadyDate)}</p>
    </Dialog>
  );
}
