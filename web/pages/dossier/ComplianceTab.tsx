import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ComplianceItemView, ComplianceKind } from "../../../shared/types";
import { apiPost } from "../../lib/api";
import { qk } from "../../lib/query";
import { useDossier } from "../../lib/dossier-context";
import { formatDate } from "../../lib/format";
import { complianceStatusDisplay } from "../../lib/status";
import { Button } from "../../components/Button";
import { EmptyState, Field, Select, TextInput } from "../../components/Form";
import { StatusPill } from "../../components/StatusPill";

const KINDS: ComplianceKind[] = ["insurance", "tax", "inspection", "license", "hoa", "permit", "other"];

export function ComplianceTab(): JSX.Element {
  const dossier = useDossier();
  const [showNew, setShowNew] = useState(false);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<ComplianceKind>("inspection");
  const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0, 10));
  const queryClient = useQueryClient();

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: qk.dossier(dossier.property.id) });
    void queryClient.invalidateQueries({ queryKey: qk.dashboard });
  }

  const create = useMutation({
    mutationFn: () =>
      apiPost<ComplianceItemView>(`/api/properties/${dossier.property.id}/compliance`, { title, kind, dueDate, leadDays: 14, recurrence: "none" }),
    onSuccess: () => {
      setTitle("");
      setShowNew(false);
      invalidate();
    },
  });

  const complete = useMutation({
    mutationFn: (item: ComplianceItemView) =>
      apiPost<ComplianceItemView>(`/api/compliance/${item.id}/complete`, { completedOn: new Date().toISOString().slice(0, 10), expectedVersion: item.version }),
    onSuccess: invalidate,
  });

  const sorted = [...dossier.compliance].sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-900">Compliance & dates</h2>
        <Button onClick={() => setShowNew((v) => !v)}>+ Item</Button>
      </div>

      {showNew && (
        <div className="mb-4 grid gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-3">
          <Field label="Title">
            <TextInput autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Kind">
            <Select value={kind} onChange={(e) => setKind(e.target.value as ComplianceKind)}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Due date">
            <TextInput type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
          <Button onClick={() => create.mutate()} disabled={!title.trim() || create.isPending} className="sm:col-span-3">
            {create.isPending ? "Adding…" : "Add item"}
          </Button>
        </div>
      )}

      {sorted.length === 0 ? (
        <EmptyState title="Nothing tracked" detail="Insurance, taxes, inspections, licenses, permits." />
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {sorted.map((c) => {
            const status = complianceStatusDisplay(c.status);
            return (
              <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-900">{c.title}</p>
                  <p className="text-sm text-slate-500">
                    {c.kind} · Due {formatDate(c.dueDate)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill severity={status.severity} label={status.label} />
                  {c.state === "open" && (
                    <Button variant="secondary" onClick={() => complete.mutate(c)} disabled={complete.isPending}>
                      Mark done
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
