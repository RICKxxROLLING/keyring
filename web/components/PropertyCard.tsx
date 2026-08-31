import { Link } from "react-router-dom";
import { useState, type ReactElement } from "react";
import type { PropertyCard as PropertyCardData } from "../../shared/types";
import { formatCents } from "../lib/format";
import { KeyGlyph, hero } from "./KeyGlyph";

/**
 * A key hanging on the ring: hero band, photo, name, occupancy, and the one
 * thing that needs attention.
 *
 * The footer line is deliberately a single sentence, not a list. The design's
 * whole posture is "tell me the one thing" — a card that lists four problems
 * is a card you stop reading.
 */
export function PropertyCard({ property }: { property: PropertyCardData }): ReactElement {
  const [hovered, setHovered] = useState(false);
  const color = property.heroColor;
  const facts = property.quickFacts;
  const filled = facts.unitCount - facts.vacantUnits;
  const pct = facts.unitCount > 0 ? (filled / facts.unitCount) * 100 : 0;

  return (
    <Link
      to={`/p/${property.id}`}
      className="kr-card"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "block",
        overflow: "hidden",
        borderRadius: 18,
        background: "var(--panel)",
        border: `1px solid ${hovered ? hero.border(color, 0.55) : "var(--line)"}`,
        color: "var(--ink)",
      }}
    >
      {/* Hero band — the key's colour, stated before anything else. */}
      <div style={{ height: 5, background: hero.solid(color) }} />

      {/* Photo, or the striped placeholder the handoff specifies. */}
      <div
        style={{
          position: "relative",
          height: 118,
          background: property.coverUrl
            ? `center/cover no-repeat url(${JSON.stringify(property.coverUrl)})`
            : "repeating-linear-gradient(115deg, var(--panel-2) 0 9px, var(--line-soft) 9px 10px)",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: "auto 10px 10px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <span
            className="kr-label"
            style={{
              background: "var(--panel)",
              borderRadius: 4,
              padding: "3px 6px",
              fontSize: 9.5,
            }}
          >
            {property.city}
          </span>
          {property.attentionCount > 0 && (
            <span
              className="kr-label"
              style={{
                background: hero.pill(color, 0.18),
                color: "var(--ink-2)",
                borderRadius: 999,
                padding: "3px 8px",
                fontSize: 9.5,
              }}
            >
              {property.attentionCount === 1 ? "1 request" : `${property.attentionCount} requests`}
            </span>
          )}
        </div>
      </div>

      <div style={{ padding: "14px 16px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <KeyGlyph color={color} size="card" />
          <span
            className="kr-display"
            style={{ fontSize: 20, lineHeight: 1.15, letterSpacing: "-0.014em" }}
          >
            {property.name}
          </span>
        </div>
        <p className="kr-label" style={{ margin: "6px 0 0", fontSize: 9.5 }}>
          {property.addressLine1} · {property.state}
        </p>

        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 8,
            margin: "14px 0 6px",
          }}
        >
          <span style={{ fontSize: 13.5, color: "var(--ink-2)" }}>
            {filled} of {facts.unitCount} filled
          </span>
          <span className="kr-tabular" style={{ fontSize: 15, fontWeight: 600 }}>
            {formatCents(facts.monthlyRentCents)}
            <span style={{ fontSize: 12, color: "var(--ink-3)" }}> /mo</span>
          </span>
        </div>

        <div
          style={{ height: 6, borderRadius: 999, background: "var(--line-soft)", overflow: "hidden" }}
        >
          <div style={{ width: `${pct}%`, height: "100%", background: hero.solid(color) }} />
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          margin: "14px 0 0",
          padding: "12px 16px",
          borderTop: "1px solid var(--line-soft)",
          fontSize: 13,
          color: "var(--ink-2)",
        }}
      >
        <span
          style={{
            flex: "none",
            width: 6,
            height: 6,
            borderRadius: 999,
            background: hero.solid(color),
          }}
        />
        {headline(property)}
      </div>
    </Link>
  );
}

/** The one thing worth saying about this property right now. */
function headline(p: PropertyCardData): string {
  const f = p.quickFacts;
  if (f.overdueWorkOrders > 0) {
    return f.overdueWorkOrders === 1 ? "1 job overdue" : `${f.overdueWorkOrders} jobs overdue`;
  }
  if (f.urgentWorkOrders > 0) return "Urgent job open";
  if (f.vacantUnits > 0) return f.vacantUnits === 1 ? "1 door empty" : `${f.vacantUnits} doors empty`;
  if (f.nextComplianceDue && f.nextComplianceDue.daysOut <= 30) {
    return `${f.nextComplianceDue.title} in ${f.nextComplianceDue.daysOut}d`;
  }
  if (f.nextLeaseExpiry && f.nextLeaseExpiry.daysOut <= 60) {
    return `Lease renews in ${f.nextLeaseExpiry.daysOut} days`;
  }
  if (f.openWorkOrders > 0) {
    return f.openWorkOrders === 1 ? "1 open request" : `${f.openWorkOrders} open requests`;
  }
  return "Nothing needed";
}
