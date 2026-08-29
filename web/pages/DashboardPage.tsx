import { useQuery } from "@tanstack/react-query";
import type { DashboardPayload } from "../../shared/types";
import { apiGet } from "../lib/api";
import { qk } from "../lib/query";
import { formatCents } from "../lib/format";
import { PropertyCard } from "../components/PropertyCard";
import { AttentionFeed } from "../components/AttentionFeed";
import { ErrorNotice, Spinner } from "../components/Form";

export function DashboardPage(): JSX.Element {
  const dashboard = useQuery({
    queryKey: qk.dashboard,
    queryFn: () => apiGet<DashboardPayload>("/api/dashboard"),
  });

  if (dashboard.isPending) return <Spinner label="Loading your portfolio…" />;
  if (dashboard.isError) return <ErrorNotice message="Couldn't load the dashboard. Pull to refresh." />;

  const data = dashboard.data;

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <div>
        <h1 className="mb-3 text-xl font-black text-slate-900">Portfolio</h1>
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Totals label="Properties" value={String(data.totals.properties)} />
          <Totals label="Units" value={`${data.totals.occupied}/${data.totals.units} occ.`} />
          <Totals label="Open WOs" value={String(data.totals.openWorkOrders)} />
          <Totals label="Rent this month" value={formatCents(data.totals.rentCollectedThisMonthCents)} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data.properties.map((p) => (
            <PropertyCard key={p.id} property={p} />
          ))}
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-lg font-bold text-slate-900">Needs attention</h2>
        <AttentionFeed items={data.needsAttention} />
      </div>
    </div>
  );
}

function Totals(props: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-xs uppercase tracking-wide text-slate-400">{props.label}</p>
      <p className="text-lg font-bold text-slate-900">{props.value}</p>
    </div>
  );
}
