import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { Page, TimelineEvent } from "../../../shared/types";
import { apiGet } from "../../lib/api";
import { qk } from "../../lib/query";
import { useDossier } from "../../lib/dossier-context";
import { formatRelativeTime } from "../../lib/format";
import { EmptyState, ErrorNotice, Spinner } from "../../components/Form";

export function TimelineTab(): JSX.Element {
  const dossier = useDossier();
  const timeline = useQuery({
    queryKey: qk.timeline(dossier.property.id),
    queryFn: () => apiGet<Page<TimelineEvent>>(`/api/properties/${dossier.property.id}/timeline`),
  });

  if (timeline.isPending) return <Spinner label="Loading timeline…" />;
  if (timeline.isError || !timeline.data) return <ErrorNotice message="Couldn't load the timeline." />;

  if (timeline.data.items.length === 0) {
    return <EmptyState title="Nothing here yet" detail="Every create, edit, and status change on this property shows up here." />;
  }

  return (
    <ul className="space-y-0 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
      {timeline.data.items.map((event) => {
        const row = (
          <div className="flex items-start justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm text-slate-800">
                <span className="font-semibold">{event.actorLabel}</span> {event.summary}
              </p>
            </div>
            <span className="shrink-0 text-xs text-slate-400">{formatRelativeTime(event.at)}</span>
          </div>
        );
        return <li key={event.id}>{event.url ? <Link to={event.url} className="hover:bg-slate-50">{row}</Link> : row}</li>;
      })}
    </ul>
  );
}
