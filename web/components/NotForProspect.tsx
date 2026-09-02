import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import { useDossier } from "../lib/dossier-context";

/**
 * The line at the top of a tab that a prospect does not really have.
 *
 * Tenants and Maintenance are dropped from the tab bar on a property you have
 * not bought, because a queue that is empty by definition teaches you to stop
 * reading the bar. But the routes stay: someone bookmarked one, or a link goes
 * there, or the house comes with a tenant already in it.
 *
 * So this explains why the page is quiet and points at where the work actually
 * is, rather than blocking the route. Refusing to render would be a dead end
 * for a case that is unusual, not impossible — and "there is nothing here" is
 * a fine answer as long as it says why.
 */
export function NotForProspect({ what }: { what: string }): ReactElement | null {
  const dossier = useDossier();
  if (dossier.property.stage !== "prospect") return null;

  const base = `/p/${dossier.property.id}`;

  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        marginBottom: 18,
        padding: "10px 14px",
        borderRadius: 12,
        border: "1px dashed var(--line)",
        background: "var(--panel-2)",
        fontSize: 13,
        color: "var(--ink-2)",
      }}
    >
      {/* Says something the banner above does not. Repeating "you don't own
          this one yet" a second time on the same screen reads as a glitch. */}
      <span style={{ minWidth: 0, flex: 1 }}>
        {what} is hidden from this property&apos;s tabs while it is a prospect. Still here if you
        need it — the work is over on:
      </span>
      <span style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Link to={`${base}/projects`} style={{ fontWeight: 600 }}>
          Renovation
        </Link>
        <Link to={`${base}/diligence`} style={{ fontWeight: 600 }}>
          Diligence
        </Link>
        <Link to={`${base}/discussion`} style={{ fontWeight: 600 }}>
          Discussion
        </Link>
      </span>
    </div>
  );
}
