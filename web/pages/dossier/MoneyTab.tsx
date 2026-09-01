import { useState, type ReactElement } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ExpenseCategory, PropertyExpense, RentEntry, Upload } from "../../../shared/types";
import { ReceiptScanner } from "../../components/ReceiptScanner";
import { apiPatch, apiPost } from "../../lib/api";
import { qk } from "../../lib/query";
import { useDossier } from "../../lib/dossier-context";
import { formatCents, formatDate, parseMoneyInput } from "../../lib/format";
import { rentStatusDisplay } from "../../lib/status";
import { Button } from "../../components/Button";
import { EmptyState, Field, Select, TextInput } from "../../components/Form";
import { StatusPill } from "../../components/StatusPill";
import { ExpandableRow, DetailGrid } from "../../components/ExpandableRow";
import { AttachmentList } from "../../components/AttachmentList";

const CATEGORIES: ExpenseCategory[] = [
  "repair", "capex", "utility", "insurance", "tax", "management", "supplies", "legal", "landscaping", "other",
];

export function MoneyTab(): ReactElement {
  const dossier = useDossier();
  const [showExpense, setShowExpense] = useState(false);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<ExpenseCategory>("repair");
  const [incurredOn, setIncurredOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [workOrderId, setWorkOrderId] = useState<string>("");
  // The scanned photo, held until the expense exists — an upload cannot be
  // re-parented to a row that has not been created yet.
  const [receipt, setReceipt] = useState<Upload | null>(null);
  const queryClient = useQueryClient();

  /**
   * Who is on the hook for a unit's rent, via its active lease.
   *
   * Resolved from the lease rather than from Tenant.unitId: the lease is what
   * actually owes the money, and it is the relationship that ends when someone
   * moves out. A tenant row can linger against a unit after their lease is
   * over, which would attach a former tenant's name to a current charge.
   */
  function tenantNameFor(unitId: string): string {
    const lease = dossier.leases.find((l) => l.unitId === unitId && l.status === "active");
    return (lease?.tenants ?? [])
      .map((t) => `${t.firstName} ${t.lastName}`.trim())
      .filter(Boolean)
      .join(" & ");
  }

  const openWorkOrders = dossier.workOrders.filter(
    (w) => w.status !== "done" && w.status !== "cancelled",
  );

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: qk.dossier(dossier.property.id) });
    void queryClient.invalidateQueries({ queryKey: qk.dashboard });
  }

  const addExpense = useMutation({
    mutationFn: async () => {
      const created = await apiPost<PropertyExpense>(
        `/api/properties/${dossier.property.id}/expenses`,
        {
          description,
          amountCents: parseMoneyInput(amount) ?? 0,
          category,
          incurredOn,
          workOrderId: workOrderId || null,
        },
      );
      // Move the receipt onto the expense now that there is one to hang it on.
      // Best effort: the expense is the record that matters, and a photo that
      // stays filed under the property is a much smaller loss than an expense
      // that failed to save because re-filing its photo did.
      if (receipt) {
        try {
          await apiPatch<Upload>(`/api/uploads/${receipt.id}`, {
            parentType: "property_expense",
            parentId: created.id,
          });
        } catch {
          /* the photo stays under the property */
        }
      }
      return created;
    },
    onSuccess: () => {
      setDescription("");
      setAmount("");
      setWorkOrderId("");
      setReceipt(null);
      setIncurredOn(new Date().toISOString().slice(0, 10));
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
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontWeight: 600, fontSize: 14.5 }}>
                    {unit?.label ?? "Unit"} · {r.period}
                    {/* Who actually owes it. A rent roll listing "Unit B" and a
                        number is a spreadsheet; the name is what makes it a
                        record you can act on. */}
                    {tenantNameFor(r.unitId) && (
                      <span style={{ color: "var(--ink-2)", fontWeight: 500 }}>
                        {" "}
                        · {tenantNameFor(r.unitId)}
                      </span>
                    )}
                  </p>
                  <p style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 2 }}>
                    <span className="kr-tabular">
                      {formatCents(r.amountReceivedCents)} of {formatCents(r.amountDueCents)}
                    </span>
                    {r.receivedOn ? ` · paid ${formatDate(r.receivedOn)}` : ""}
                    {r.method ? ` · ${r.method}` : ""}
                    {/* The check or confirmation number — what you search for
                        when matching this against a bank statement. */}
                    {r.reference ? ` · #${r.reference}` : ""}
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
          <div className="sm:col-span-2">
            <ReceiptScanner
              propertyId={dossier.property.id}
              workOrders={openWorkOrders}
              onScanned={(r) => {
                // Only fills what is still blank, and only what was actually
                // read — a field the scan could not see must not wipe one you
                // already typed.
                setReceipt(r.upload);
                if (r.fields.totalCents !== undefined && !amount) {
                  setAmount((r.fields.totalCents / 100).toFixed(2));
                }
                if (r.fields.incurredOn) setIncurredOn(r.fields.incurredOn);
                if (r.fields.category) setCategory(r.fields.category);
                if (r.fields.vendorName && !description) setDescription(r.fields.vendorName);
                if (r.workOrderId) setWorkOrderId(r.workOrderId);
              }}
            />
          </div>
          {receipt && (
            <p className="sm:col-span-2" style={{ margin: 0, fontSize: 12.5, color: "var(--ink-3)" }}>
              A receipt photo will be attached to this expense when you add it.
            </p>
          )}
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
          <Field label="Date">
            <TextInput
              type="date"
              value={incurredOn}
              onChange={(e) => setIncurredOn(e.target.value)}
            />
          </Field>
          {openWorkOrders.length > 0 && (
            <Field label="Work order" hint="Optional.">
              <Select value={workOrderId} onChange={(e) => setWorkOrderId(e.target.value)}>
                <option value="">Not tied to a job</option>
                {openWorkOrders.map((w) => (
                  <option key={w.id} value={w.id}>
                    WO-{w.number} · {w.title}
                  </option>
                ))}
              </Select>
            </Field>
          )}
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
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
          {dossier.expenses.map((e) => {
            const vendor = dossier.vendors.find((v) => v.id === e.vendorId);
            const workOrder = dossier.workOrders.find((w) => w.id === e.workOrderId);
            const project = dossier.projects.find((p) => p.id === e.projectId);
            const unit = dossier.property.units.find((u) => u.id === e.unitId);
            const receipts = dossier.attachments.filter(
              (a) => a.parentType === "property_expense" && a.parentId === e.id,
            );
            return (
              <li key={e.id}>
                <ExpandableRow
                  color={dossier.property.heroColor}
                  label={`Expense: ${e.description}`}
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
                          {e.description}
                          {e.isRecurring && (
                            <span
                              className="kr-label"
                              style={{
                                marginLeft: 8,
                                padding: "2px 7px",
                                borderRadius: 999,
                                background: "var(--panel-2)",
                                border: "1px solid var(--line)",
                                fontSize: 9,
                              }}
                            >
                              Recurring
                            </span>
                          )}
                        </span>
                        <span
                          style={{
                            display: "block",
                            fontSize: 12.5,
                            color: "var(--ink-3)",
                            marginTop: 2,
                          }}
                        >
                          {e.category} · {formatDate(e.incurredOn)}
                          {vendor ? ` · ${vendor.company || vendor.name}` : ""}
                          {receipts.length > 0
                            ? ` · ${receipts.length} receipt${receipts.length === 1 ? "" : "s"}`
                            : ""}
                        </span>
                      </span>
                      <span className="kr-tabular" style={{ fontWeight: 600, flex: "none" }}>
                        {formatCents(e.amountCents)}
                      </span>
                    </span>
                  }
                >
                  <DetailGrid
                    items={[
                      { label: "Amount", value: formatCents(e.amountCents) },
                      { label: "Category", value: e.category },
                      { label: "Incurred", value: formatDate(e.incurredOn) },
                      { label: "Unit", value: unit?.label ?? "Whole building" },
                      {
                        label: "Recurring",
                        value: e.isRecurring ? (e.recurrenceNote ?? "Yes") : "One-off",
                      },
                      { label: "Vendor", value: vendor ? vendor.company || vendor.name : null },
                      { label: "Work order", value: workOrder ? workOrder.title : null },
                      { label: "Project", value: project ? project.title : null },
                      { label: "Note", value: e.note },
                    ]}
                  />
                  {receipts.length > 0 && (
                    <div style={{ marginTop: 14 }}>
                      <span className="kr-label" style={{ fontSize: 9.5 }}>
                        Receipts
                      </span>
                      <AttachmentList uploads={receipts} />
                    </div>
                  )}
                </ExpandableRow>
              </li>
            );
          })}
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
