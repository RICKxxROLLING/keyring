import { Link } from "react-router-dom";
import type { PropertyCard as PropertyCardType } from "../../shared/types";
import { formatCents } from "../lib/format";
import { propertyStatusDisplay } from "../lib/status";
import { StatusPill } from "./StatusPill";
import type { ReactElement } from "react";

const STRIPE_CLASS: Record<string, string> = {
  ok: "status-stripe-ok",
  warn: "status-stripe-warn",
  urgent: "status-stripe-urgent",
  neutral: "status-stripe-neutral",
};

export function PropertyCard(props: { property: PropertyCardType }): ReactElement {
  const p = props.property;
  const status = propertyStatusDisplay(p.status);
  const qf = p.quickFacts;

  return (
    <Link
      to={`/p/${p.id}`}
      className={`status-stripe ${STRIPE_CLASS[status.severity]} block rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md`}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <p className="text-base font-bold text-slate-900">{p.name}</p>
          <p className="text-sm text-slate-500">
            {p.addressLine1}, {p.city}, {p.state}
          </p>
        </div>
        <StatusPill severity={status.severity} label={status.label} />
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm sm:grid-cols-4">
        <QuickFact label="Units" value={`${qf.occupiedUnits}/${qf.unitCount} occ.`} />
        <QuickFact label="Rent/mo" value={formatCents(qf.monthlyRentCents)} />
        <QuickFact label="Open WOs" value={String(qf.openWorkOrders)} warn={qf.overdueWorkOrders > 0} />
        <QuickFact label="Needs attention" value={String(p.attentionCount)} warn={p.attentionCount > 0} />
      </dl>
    </Link>
  );
}

function QuickFact(props: { label: string; value: string; warn?: boolean }): ReactElement {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-400">{props.label}</dt>
      <dd className={`font-semibold ${props.warn ? "text-amber-700" : "text-slate-800"}`}>{props.value}</dd>
    </div>
  );
}
