import { Link } from "react-router-dom";
import type { ReactElement } from "react";
import type { PropertyDossier } from "../../../shared/types";
import { useDossier } from "../../lib/dossier-context";
import { formatCents, formatDate } from "../../lib/format";
import { AttentionFeed } from "../../components/AttentionFeed";
import { ModuleLinks } from "../../components/ModuleLinks";
import { EmptyState } from "../../components/Form";
import { hero } from "../../components/KeyGlyph";
import { ProspectOverview } from "./ProspectOverview";

/**
 * Overview — the design's screen 2 body.
 *
 * Left: the doors (the thing you actually came to look at). Right: the
 * particulars and whatever is currently open. Everything that lost its tab in
 * the five-tab bar is reachable from the module grid at the bottom.
 *
 * A property you have not bought gets a different body entirely. Leading with
 * the doors and who is behind them means leading with a list of empty rooms,
 * and "Needs a hand" is computed from work orders, leases and compliance —
 * none of which a prospect has. What it does have is a decision in progress,
 * so ProspectOverview summarises the three tabs that hold it.
 */
export function OverviewTab(): ReactElement {
  const dossier = useDossier();
  const color = dossier.property.heroColor;
  const units = dossier.property.units;
  const filled = units.filter((u) => u.status === "occupied").length;

  if (dossier.property.stage === "prospect") {
    return (
      <div>
        <ProspectOverview dossier={dossier} />
        <PinnedNotes dossier={dossier} />
        <ModuleLinks dossier={dossier} />
      </div>
    );
  }

  return (
    <div>
      <div
        style={{
          display: "grid",
          gap: 22,
          gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))",
          alignItems: "start",
        }}
      >
        {/* ------------------------------------------------------ doors --- */}
        <section>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              marginBottom: 12,
            }}
          >
            <h2 className="kr-display kr-h2" style={{ margin: 0 }}>
              {doorsHeading(units.length)}
            </h2>
            <span className="kr-label">
              {filled === units.length ? "all filled" : `${filled} of ${units.length} filled`}
            </span>
          </div>

          {units.length === 0 ? (
            <EmptyState title="No doors yet" detail="Add a unit to start tracking tenants." />
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
              {units.map((u) => {
                const lease = dossier.leases.find(
                  (l) => l.unitId === u.id && l.status === "active",
                );
                // LeaseView already carries its tenants resolved, so there is
                // no need to cross-reference the dossier's tenant list.
                const tenantNames = (lease?.tenants ?? [])
                  .map((t) => `${t.firstName} ${t.lastName}`.trim())
                  .join(" & ");
                return (
                  <li
                    key={u.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 14,
                      padding: "12px 14px",
                      background: "var(--panel)",
                      border: "1px solid var(--line)",
                      // The 4px hero edge is what ties a door to its key.
                      borderLeft: `4px solid ${hero.solid(color)}`,
                      borderRadius: 14,
                    }}
                  >
                    <span style={{ flex: "none", minWidth: 44 }}>
                      <span className="kr-label" style={{ display: "block", fontSize: 9 }}>
                        Unit
                      </span>
                      <span
                        className="kr-display"
                        style={{ fontSize: 20, lineHeight: 1.1 }}
                      >
                        {u.label.replace(/^unit\s*/i, "")}
                      </span>
                    </span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: "block", fontSize: 14.5, fontWeight: 600 }}>
                        {tenantNames || (u.status === "vacant" ? "Empty" : u.label)}
                      </span>
                      <span
                        style={{ display: "block", fontSize: 12.5, color: "var(--ink-3)", marginTop: 2 }}
                      >
                        {lease
                          ? `Lease ${formatDate(lease.startDate)} – ${lease.endDate ? formatDate(lease.endDate) : "month to month"}`
                          : unitDetail(u.bedrooms, u.floor)}
                      </span>
                    </span>
                    <span style={{ flex: "none", textAlign: "right" }}>
                      <span className="kr-tabular" style={{ fontSize: 14.5, fontWeight: 600 }}>
                        {formatCents(lease?.rentCents ?? u.marketRentCents ?? 0)}
                      </span>
                      <span
                        className="kr-label"
                        style={{ display: "block", fontSize: 9, marginTop: 2 }}
                      >
                        {u.status === "occupied" ? "current" : u.status.replace(/_/g, " ")}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ------------------------------------------- needs a hand here --- */}
        <section
          style={{
            background: "var(--panel-2)",
            border: "1px solid var(--line)",
            borderRadius: 16,
            padding: "16px 18px 6px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              marginBottom: 4,
            }}
          >
            <h2 className="kr-display" style={{ margin: 0, fontSize: 18 }}>
              Needs a hand
            </h2>
            <span className="kr-label">{dossier.attention.length} open</span>
          </div>
          <AttentionFeed items={dossier.attention} />

          <PinnedNotes dossier={dossier} inline />
        </section>
      </div>

      <ModuleLinks dossier={dossier} />
    </div>
  );
}

/**
 * Pinned notes, which matter on both kinds of property.
 *
 * `inline` is for the owned layout, where this sits inside the "Needs a hand"
 * panel and borrows its background; standalone it needs its own.
 */
function PinnedNotes({
  dossier,
  inline,
}: {
  dossier: PropertyDossier;
  inline?: boolean;
}): ReactElement | null {
  const pinned = dossier.notes.filter((n) => n.pinned);
  if (pinned.length === 0) return null;

  return (
    <div
      style={
        inline
          ? { marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--line-soft)" }
          : {
              marginTop: 22,
              padding: "16px 18px",
              background: "var(--panel-2)",
              border: "1px solid var(--line)",
              borderRadius: 16,
            }
      }
    >
      <h3 className="kr-label" style={{ marginBottom: 8 }}>
        Pinned
      </h3>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
        {pinned.slice(0, 4).map((n) => (
          <li key={n.id}>
            <Link to={`../notes?note=${n.id}`} style={{ fontSize: 13.5, color: "var(--ink-2)" }}>
              {n.title || n.body.slice(0, 60)}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "Three doors" reads better than "3 units" — the design's voice. */
function doorsHeading(n: number): string {
  const words = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
  const word = words[n] ?? String(n);
  return `${word} ${n === 1 ? "door" : "doors"}`;
}

function unitDetail(bedrooms: number | null, floor: string | null): string {
  const parts = [
    bedrooms !== null ? `${bedrooms} bed` : null,
    floor,
  ].filter((p): p is string => Boolean(p));
  return parts.length > 0 ? parts.join(" · ") : "—";
}
