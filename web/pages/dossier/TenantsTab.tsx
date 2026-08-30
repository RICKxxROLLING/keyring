import { useState, type ReactElement } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { LeaseView, Tenant } from "../../../shared/types";
import { apiPost } from "../../lib/api";
import { qk } from "../../lib/query";
import { useDossier } from "../../lib/dossier-context";
import { formatCents, formatDate, parseMoneyInput } from "../../lib/format";
import { leaseStatusDisplay } from "../../lib/status";
import { Button } from "../../components/Button";
import { EmptyState, Field, Select, TextInput } from "../../components/Form";
import { StatusPill } from "../../components/StatusPill";

export function TenantsTab(): ReactElement {
  const dossier = useDossier();
  const [showTenant, setShowTenant] = useState(false);
  const [showLease, setShowLease] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [unitId, setUnitId] = useState(dossier.property.units[0]?.id ?? "");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [rent, setRent] = useState("");
  const [deposit, setDeposit] = useState("");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState("");
  const [tenantIds, setTenantIds] = useState<string[]>([]);
  const queryClient = useQueryClient();

  const rentCents = parseMoneyInput(rent);
  const depositCents = parseMoneyInput(deposit);
  // Deposit is optional; a value that is present but unparseable is an error.
  const depositInvalid = deposit.trim() !== "" && depositCents === null;
  const leaseValid = rentCents !== null && !depositInvalid;

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: qk.dossier(dossier.property.id) });
    void queryClient.invalidateQueries({ queryKey: qk.dashboard });
  }

  const createTenant = useMutation({
    mutationFn: () =>
      apiPost<Tenant>(`/api/properties/${dossier.property.id}/tenants`, {
        firstName,
        lastName,
        unitId,
        phone: phone.trim() || null,
        email: email.trim() || null,
        isPrimary: true,
        movedInAt: startDate,
      }),
    onSuccess: () => {
      setFirstName("");
      setLastName("");
      setPhone("");
      setEmail("");
      setShowTenant(false);
      invalidate();
    },
  });

  const createLease = useMutation({
    mutationFn: () =>
      apiPost<LeaseView>(`/api/properties/${dossier.property.id}/leases`, {
        unitId,
        startDate,
        // A real end date, not a hardcoded null. computeAttention's lease
        // branch filters on `end_date IS NOT NULL`, so a null here means the
        // lease can never produce a `lease_expiring` item — which silently
        // disabled the renewal warnings on the dashboard.
        endDate: endDate || null,
        rentCents,
        // Deposit is its own field. It previously read the rent input, so
        // every lease was stored with a deposit equal to one month's rent
        // whether or not that was true.
        depositCents: depositCents ?? 0,
        dueDay: 1,
        status: "active",
        renewalNoticeDays: 60,
        tenantIds,
      }),
    onSuccess: () => {
      setRent("");
      setDeposit("");
      setEndDate("");
      setTenantIds([]);
      setShowLease(false);
      invalidate();
    },
  });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-900">Tenants</h2>
        <Button onClick={() => setShowTenant((v) => !v)}>+ Tenant</Button>
      </div>

      {showTenant && (
        <div className="mb-4 grid gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-2">
          <Field label="First name">
            <TextInput autoFocus value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </Field>
          <Field label="Last name">
            <TextInput value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </Field>
          <Field label="Unit">
            <Select value={unitId} onChange={(e) => setUnitId(e.target.value)}>
              {dossier.property.units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Phone">
            <TextInput
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Optional"
            />
          </Field>
          <Field label="Email">
            <TextInput
              type="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Optional"
            />
          </Field>
          <Button onClick={() => createTenant.mutate()} disabled={!firstName.trim() || createTenant.isPending} className="self-end sm:col-span-2">
            {createTenant.isPending ? "Adding…" : "Add tenant"}
          </Button>
        </div>
      )}

      {dossier.tenants.length === 0 ? (
        <EmptyState title="No tenants on file" />
      ) : (
        <ul className="mb-6 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {dossier.tenants.map((t) => {
            const unit = dossier.property.units.find((u) => u.id === t.unitId);
            return (
              <li key={t.id} className="px-4 py-3">
                <p className="font-semibold text-slate-900">
                  {t.firstName} {t.lastName}
                </p>
                <p className="text-sm text-slate-500">
                  {unit?.label ?? "Unassigned"}
                  {t.phone ? ` · ${t.phone}` : ""}
                  {t.email ? ` · ${t.email}` : ""}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-900">Leases</h2>
        <Button onClick={() => setShowLease((v) => !v)}>+ Lease</Button>
      </div>

      {showLease && (
        <div className="mb-4 grid gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-2">
          <Field label="Unit">
            <Select value={unitId} onChange={(e) => setUnitId(e.target.value)}>
              {dossier.property.units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tenants">
            <select
              multiple
              value={tenantIds}
              onChange={(e) => setTenantIds(Array.from(e.target.selectedOptions).map((o) => o.value))}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5"
            >
              {dossier.tenants.filter((t) => t.unitId === unitId).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.firstName} {t.lastName}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Start date">
            <TextInput type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label="End date">
            <TextInput
              type="date"
              value={endDate}
              min={startDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
            <p className="mt-1 text-xs text-slate-500">
              Needed for renewal warnings. Leave blank for month-to-month.
            </p>
          </Field>
          <Field label="Monthly rent">
            <TextInput inputMode="decimal" value={rent} onChange={(e) => setRent(e.target.value)} placeholder="0.00" />
          </Field>
          <Field label="Security deposit">
            <TextInput
              inputMode="decimal"
              value={deposit}
              onChange={(e) => setDeposit(e.target.value)}
              placeholder="0.00"
            />
            {depositInvalid && (
              <p className="mt-1 text-xs text-rose-600">Enter an amount like 1250 or 1250.00.</p>
            )}
          </Field>
          <Button onClick={() => createLease.mutate()} disabled={!leaseValid || createLease.isPending} className="sm:col-span-2">
            {createLease.isPending ? "Creating…" : "Create lease"}
          </Button>
        </div>
      )}

      {dossier.leases.length === 0 ? (
        <EmptyState title="No leases on file" />
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {dossier.leases.map((l) => {
            const status = leaseStatusDisplay(l.status);
            return (
              <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">
                    {l.unitLabel} · {l.tenants.map((t) => `${t.firstName} ${t.lastName}`).join(", ")}
                  </p>
                  <p className="text-sm text-slate-500">
                    {formatCents(l.rentCents)}/mo · {formatDate(l.startDate)} – {l.endDate ? formatDate(l.endDate) : "month-to-month"}
                    {l.daysUntilExpiry !== null && l.daysUntilExpiry <= 60 && l.daysUntilExpiry >= 0
                      ? ` · expires in ${l.daysUntilExpiry}d`
                      : ""}
                  </p>
                </div>
                <StatusPill severity={status.severity} label={status.label} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
