import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { LeaseView, Tenant } from "../../../shared/types";
import { apiPost } from "../../lib/api";
import { qk } from "../../lib/query";
import { useDossier } from "../../lib/dossier-context";
import { formatCents, formatDate } from "../../lib/format";
import { leaseStatusDisplay } from "../../lib/status";
import { Button } from "../../components/Button";
import { EmptyState, Field, Select, TextInput } from "../../components/Form";
import { StatusPill } from "../../components/StatusPill";

export function TenantsTab(): JSX.Element {
  const dossier = useDossier();
  const [showTenant, setShowTenant] = useState(false);
  const [showLease, setShowLease] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [unitId, setUnitId] = useState(dossier.property.units[0]?.id ?? "");
  const [rent, setRent] = useState("");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [tenantIds, setTenantIds] = useState<string[]>([]);
  const queryClient = useQueryClient();

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: qk.dossier(dossier.property.id) });
    void queryClient.invalidateQueries({ queryKey: qk.dashboard });
  }

  const createTenant = useMutation({
    mutationFn: () => apiPost<Tenant>(`/api/properties/${dossier.property.id}/tenants`, { firstName, lastName, unitId, isPrimary: true, movedInAt: startDate }),
    onSuccess: () => {
      setFirstName("");
      setLastName("");
      setShowTenant(false);
      invalidate();
    },
  });

  const createLease = useMutation({
    mutationFn: () =>
      apiPost<LeaseView>(`/api/properties/${dossier.property.id}/leases`, {
        unitId,
        startDate,
        endDate: null,
        rentCents: Math.round(parseFloat(rent || "0") * 100),
        depositCents: Math.round(parseFloat(rent || "0") * 100),
        dueDay: 1,
        status: "active",
        renewalNoticeDays: 60,
        tenantIds,
      }),
    onSuccess: () => {
      setRent("");
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
          <Button onClick={() => createTenant.mutate()} disabled={!firstName.trim() || createTenant.isPending} className="self-end">
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
          <Field label="Monthly rent">
            <TextInput inputMode="decimal" value={rent} onChange={(e) => setRent(e.target.value)} placeholder="0.00" />
          </Field>
          <Button onClick={() => createLease.mutate()} disabled={!rent || createLease.isPending} className="sm:col-span-2">
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
