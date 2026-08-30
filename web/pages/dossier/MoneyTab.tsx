import { useState, type ReactElement } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ExpenseCategory, PropertyExpense, RentEntry } from "../../../shared/types";
import { apiPatch, apiPost } from "../../lib/api";
import { qk } from "../../lib/query";
import { useDossier } from "../../lib/dossier-context";
import { formatCents, formatDate, parseMoneyInput } from "../../lib/format";
import { rentStatusDisplay } from "../../lib/status";
import { Button } from "../../components/Button";
import { EmptyState, Field, Select, TextInput } from "../../components/Form";
import { StatusPill } from "../../components/StatusPill";

const CATEGORIES: ExpenseCategory[] = [
  "repair", "capex", "utility", "insurance", "tax", "management", "supplies", "legal", "landscaping", "other",
];

export function MoneyTab(): ReactElement {
  const dossier = useDossier();
  const [showExpense, setShowExpense] = useState(false);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<ExpenseCategory>("repair");
  const queryClient = useQueryClient();

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: qk.dossier(dossier.property.id) });
    void queryClient.invalidateQueries({ queryKey: qk.dashboard });
  }

  const addExpense = useMutation({
    mutationFn: () =>
      apiPost<PropertyExpense>(`/api/properties/${dossier.property.id}/expenses`, {
        description,
        amountCents: parseMoneyInput(amount) ?? 0,
        category,
        incurredOn: new Date().toISOString().slice(0, 10),
      }),
    onSuccess: () => {
      setDescription("");
      setAmount("");
      setShowExpense(false);
      invalidate();
    },
  });

  const recordPayment = useMutation({
    mutationFn: (entry: RentEntry) =>
      apiPatch<RentEntry>(`/api/rent/${entry.id}`, {
        amountReceivedCents: entry.amountDueCents,
        receivedOn: new Date().toISOString().slice(0, 10),
        expectedVersion: entry.version,
      }),
    onSuccess: invalidate,
  });

  const m = dossier.money;

  return (
    <div>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MoneyStat label="Rent received" value={formatCents(m.rentReceivedCents)} />
        <MoneyStat label="Outstanding" value={formatCents(m.rentOutstandingCents)} warn={m.rentOutstandingCents > 0} />
        <MoneyStat label="Expenses" value={formatCents(m.expenseCents)} />
        <MoneyStat label="Net" value={formatCents(m.netCents)} warn={m.netCents < 0} />
      </div>

      <h2 className="mb-3 text-lg font-bold text-slate-900">Rent roll — this period</h2>
      {dossier.rentEntries.length === 0 ? (
        <EmptyState title="No rent entries yet" />
      ) : (
        <ul className="mb-6 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {dossier.rentEntries.map((r) => {
            const unit = dossier.property.units.find((u) => u.id === r.unitId);
            const status = rentStatusDisplay(r.status);
            return (
              <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="font-semibold text-slate-900">{unit?.label ?? "Unit"} · {r.period}</p>
                  <p className="text-sm text-slate-500">
                    {formatCents(r.amountReceivedCents)} of {formatCents(r.amountDueCents)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill severity={status.severity} label={status.label} />
                  {r.status !== "paid" && r.status !== "waived" && (
                    <Button variant="secondary" onClick={() => recordPayment.mutate(r)} disabled={recordPayment.isPending}>
                      Mark paid
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-900">Expenses</h2>
        <Button onClick={() => setShowExpense((v) => !v)}>+ Expense</Button>
      </div>

      {showExpense && (
        <div className="mb-4 grid gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-2">
          <Field label="Description">
            <TextInput autoFocus value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Field label="Amount">
            <TextInput inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </Field>
          <Field label="Category">
            <Select value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Button
            onClick={() => addExpense.mutate()}
            disabled={!description.trim() || parseMoneyInput(amount) === null || addExpense.isPending}
            className="self-end"
          >
            {addExpense.isPending ? "Adding…" : "Add expense"}
          </Button>
        </div>
      )}

      {dossier.expenses.length === 0 ? (
        <EmptyState title="No expenses recorded" />
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {dossier.expenses.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="font-semibold text-slate-900">{e.description}</p>
                <p className="text-sm text-slate-500">
                  {e.category} · {formatDate(e.incurredOn)}
                </p>
              </div>
              <span className="font-semibold text-slate-800">{formatCents(e.amountCents)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MoneyStat(props: { label: string; value: string; warn?: boolean }): ReactElement {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-xs uppercase tracking-wide text-slate-400">{props.label}</p>
      <p className={`text-lg font-bold ${props.warn ? "text-amber-700" : "text-slate-900"}`}>{props.value}</p>
    </div>
  );
}
