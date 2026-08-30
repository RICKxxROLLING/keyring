import { Link } from "react-router-dom";
import { useDossier } from "../../lib/dossier-context";
import { formatRelativeTime } from "../../lib/format";
import { AttentionFeed } from "../../components/AttentionFeed";
import { EmptyState } from "../../components/Form";
import type { ReactElement } from "react";

export function OverviewTab(): ReactElement {
  const dossier = useDossier();
  const pinned = dossier.notes.filter((n) => n.pinned);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
      <div>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">Pinned notes</h2>
        {pinned.length === 0 ? (
          <EmptyState title="Nothing pinned" detail="Pin a note from the Notes tab to surface it here." />
        ) : (
          <ul className="space-y-2">
            {pinned.map((n) => (
              <li key={n.id} className="rounded-xl border border-brand-200 bg-brand-50 p-3">
                {n.title && <p className="mb-1 font-semibold text-slate-900">{n.title}</p>}
                <p className="whitespace-pre-wrap text-sm text-slate-700">{n.body}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {n.author?.displayName} · {formatRelativeTime(n.updatedAt)}
                </p>
              </li>
            ))}
          </ul>
        )}

        <h2 className="mb-2 mt-6 text-sm font-bold uppercase tracking-wide text-slate-500">Recent activity</h2>
        <Link to="timeline" className="text-sm font-medium text-brand-600 hover:underline">
          View the full timeline →
        </Link>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">Needs attention</h2>
        <AttentionFeed items={dossier.attention} />
      </div>
    </div>
  );
}
