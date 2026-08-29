import { NavLink, Outlet, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { PropertyDossier } from "../../shared/types";
import { apiGet } from "../lib/api";
import { qk } from "../lib/query";
import { usePropertyChannel } from "../lib/realtime";
import { formatCents, formatDate } from "../lib/format";
import { propertyStatusDisplay } from "../lib/status";
import { StatusPill } from "../components/StatusPill";
import { PropertyPresenceBar } from "../components/PresenceBar";
import { ErrorNotice, Spinner } from "../components/Form";
import type { ReactElement } from "react";

const TABS = [
  { to: "overview", label: "Overview" },
  { to: "notes", label: "Notes" },
  { to: "maintenance", label: "Maintenance" },
  { to: "projects", label: "Projects" },
  { to: "tenants", label: "Tenants" },
  { to: "money", label: "Money" },
  { to: "specs", label: "Specs" },
  { to: "compliance", label: "Compliance" },
  { to: "turnover", label: "Turnover" },
  { to: "files", label: "Files" },
  { to: "timeline", label: "Timeline" },
];

export function DossierPage(): ReactElement {
  const { propertyId } = useParams<{ propertyId: string }>();
  usePropertyChannel(propertyId ?? null);

  const dossier = useQuery({
    queryKey: qk.dossier(propertyId ?? ""),
    queryFn: () => apiGet<PropertyDossier>(`/api/properties/${propertyId}/dossier`),
    enabled: Boolean(propertyId),
  });

  if (dossier.isPending) return <Spinner label="Loading property…" />;
  if (dossier.isError || !dossier.data) return <ErrorNotice message="Couldn't load this property." />;

  const { property } = dossier.data;
  const status = propertyStatusDisplay(property.status);
  const qf = property.quickFacts;

  return (
    <div>
      <header className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-black text-slate-900">{property.name}</h1>
            <p className="text-sm text-slate-500">
              {property.addressLine1}, {property.city}, {property.state} {property.postalCode}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <PropertyPresenceBar propertyId={property.id} />
            <StatusPill severity={status.severity} label={status.label} />
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-slate-100 pt-3 text-sm sm:grid-cols-4">
          <Fact label="Units" value={`${qf.occupiedUnits}/${qf.unitCount} occupied`} />
          <Fact label="Monthly rent" value={formatCents(qf.monthlyRentCents)} />
          <Fact label="Open work orders" value={String(qf.openWorkOrders)} />
          <Fact label="Active projects" value={String(qf.activeProjects)} />
          <Fact label="Next lease expiry" value={qf.nextLeaseExpiry ? `${qf.nextLeaseExpiry.unitLabel} · ${formatDate(qf.nextLeaseExpiry.endDate)}` : "None"} />
          <Fact label="Next compliance due" value={qf.nextComplianceDue ? `${qf.nextComplianceDue.title} · ${formatDate(qf.nextComplianceDue.dueDate)}` : "None"} />
          <Fact label="YTD expenses" value={formatCents(qf.ytdExpenseCents)} />
          <Fact label="YTD rent received" value={formatCents(qf.ytdRentReceivedCents)} />
        </dl>
      </header>

      <nav className="mb-4 overflow-x-auto border-b border-slate-200" aria-label="Property sections">
        <div className="flex min-w-max gap-1">
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) =>
                `tap-target whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold ${
                  isActive ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800"
                }`
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </div>
      </nav>

      <Outlet context={dossier.data} />
    </div>
  );
}

function Fact(props: { label: string; value: string }): ReactElement {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-400">{props.label}</dt>
      <dd className="font-semibold text-slate-800">{props.value}</dd>
    </div>
  );
}
