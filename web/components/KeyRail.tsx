import { useQuery } from "@tanstack/react-query";
import { NavLink, useMatch } from "react-router-dom";
import type { CSSProperties, ReactElement } from "react";
import type { DashboardPayload, PropertyCard } from "../../shared/types";
import { apiGet } from "../lib/api";
import { qk } from "../lib/query";
import { KeyGlyph, hero } from "./KeyGlyph";

/**
 * The keyring — the design language's organizing element.
 *
 * Desktop: a 268px rail of key tags hanging on a metal ring wire.
 * Mobile:  the same keys as a horizontal scrolling strip. The handoff does not
 *          design mobile but names this adaptation explicitly ("the keyring
 *          rail becomes a horizontal strip of key tags"), so it extends the
 *          language rather than inventing a second one.
 *
 * The ring wire is the detail that makes the metaphor read. It is a rounded
 * 2px outline positioned BEHIND the keys, and per the handoff it must stop
 * just past the last key rather than stretching to the container — a wire that
 * runs the full height reads as a border, not a ring.
 */

const RAIL_ROW_HEIGHT = 46; // 9px pad + 28px glyph + 9px pad
const RING_TOP = 8;

/**
 * Shared data for both presentations. The rail rides the dashboard payload,
 * which every authenticated view already loads, so opening a property costs no
 * extra request.
 */
function useRingProperties(): { properties: PropertyCard[]; activeId: string | null } {
  const dashboard = useQuery({
    queryKey: qk.dashboard,
    queryFn: () => apiGet<DashboardPayload>("/api/dashboard"),
    staleTime: 30_000,
  });
  const active = useMatch("/p/:propertyId/*");
  return {
    properties: dashboard.data?.properties ?? [],
    activeId: active?.params.propertyId ?? null,
  };
}

/**
 * The mobile presentation: a horizontal strip of key tags.
 *
 * Rendered INSIDE the content column, not as a sibling of the desktop rail.
 * They were siblings originally, which put the strip in the shell's flex ROW —
 * so it became a full-height column and each key tag stretched to the viewport.
 */
export function KeyStrip(): ReactElement {
  const { properties, activeId } = useRingProperties();

  return (
    <nav
      aria-label="Properties"
      className="lg:hidden kr-scroll-x"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px clamp(12px, 3vw, 28px)",
        background: "var(--bg-2)",
        borderBottom: "1px solid var(--line)",
      }}
    >
      {properties.map((p) => {
        const isActive = p.id === activeId;
        return (
          <NavLink
            key={p.id}
            to={`/p/${p.id}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flex: "none",
              padding: "8px 12px 8px 8px",
              borderRadius: 999,
              minHeight: 44,
              background: isActive ? hero.tint(p.heroColor, 12) : "var(--panel)",
              border: `1px solid ${isActive ? hero.border(p.heroColor, 0.35) : "var(--line)"}`,
              color: "var(--ink)",
              fontSize: 13.5,
              fontWeight: isActive ? 700 : 600,
              whiteSpace: "nowrap",
            }}
          >
            <KeyGlyph color={p.heroColor} size="card" holeColor="var(--bg-2)" />
            {p.name}
            {p.attentionCount > 0 && <AttentionCount property={p} />}
          </NavLink>
        );
      })}
    </nav>
  );
}

export function KeyRail(): ReactElement {
  const { properties, activeId } = useRingProperties();

  return (
    <nav
      aria-label="Properties"
      className="kr-rail hidden shrink-0 flex-col lg:flex"
        style={{
          width: 268,
          background: "var(--bg-2)",
          borderRight: "1px solid var(--line)",
          padding: "22px 16px 16px",
        }}
      >
        <span className="kr-label" style={{ paddingLeft: 6 }}>
          On the ring · {properties.length}
        </span>

        <div style={{ position: "relative", marginTop: 12 }}>
          {/* The wire. Height is derived from the key count so it ends just
              past the last key, as specified. Decorative. */}
          {properties.length > 0 && (
            <span
              aria-hidden="true"
              style={{
                position: "absolute",
                left: 15,
                top: RING_TOP,
                width: 17,
                height: Math.max(40, properties.length * RAIL_ROW_HEIGHT - 18),
                border: "2px solid var(--metal)",
                borderRadius: 999,
                pointerEvents: "none",
              }}
            />
          )}

          <ul style={{ position: "relative", listStyle: "none", margin: 0, padding: 0 }}>
            {properties.map((p) => (
              <li key={p.id}>
                <KeyRow property={p} active={p.id === activeId} dimmed={activeId !== null} />
              </li>
            ))}
          </ul>
        </div>

        <div style={{ marginTop: "auto", paddingTop: 20 }}>
          <NavLink
            to="/properties/new"
            className="kr-cut-key"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              padding: "10px 12px",
              border: "1px dashed var(--line)",
              borderRadius: 11,
              color: "var(--ink-2)",
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            + Cut a new key
          </NavLink>
          <div style={{ display: "grid", gap: 2, marginTop: 14, paddingLeft: 6 }}>
            <RailLink to="/money">Ledger</RailLink>
            <RailLink to="/files">Papers</RailLink>
            <RailLink to="/settings">Settings</RailLink>
          </div>
        </div>
    </nav>
  );
}

function KeyRow({
  property,
  active,
  dimmed,
}: {
  property: PropertyCard;
  active: boolean;
  dimmed: boolean;
}): ReactElement {
  const { heroColor: color } = property;
  const facts = property.quickFacts;
  const doors = facts.unitCount === 1 ? "1 door" : `${facts.unitCount} doors`;
  const state = facts.vacantUnits > 0 ? `${facts.vacantUnits} open` : "full";

  const style: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "9px 10px 9px 6px",
    borderRadius: 12,
    // On the detail screen the other keys recede so the current one reads as
    // held; they come back to full on hover.
    opacity: dimmed && !active ? 0.72 : 1,
    background: active ? hero.tint(color, 12) : "transparent",
    border: `1px solid ${active ? hero.border(color, 0.35) : "transparent"}`,
    color: "var(--ink)",
  };

  return (
    <NavLink to={`/p/${property.id}`} className="kr-key-row" style={style}>
      {/* holeColor is the RAIL background so the ring wire shows through the
          bow — the whole reason the glyph paints its hole rather than
          leaving it transparent. */}
      <KeyGlyph color={color} size="rail" holeColor={active ? "transparent" : "var(--bg-2)"} />
      <span style={{ minWidth: 0, flex: 1 }}>
        <span
          style={{
            display: "block",
            fontSize: 14,
            fontWeight: active ? 700 : 600,
            lineHeight: 1.25,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {property.name}
        </span>
        <span
          className="kr-label"
          style={{ display: "block", fontSize: 10, letterSpacing: "0.08em", marginTop: 2 }}
        >
          {doors} · {state}
        </span>
      </span>
      {property.attentionCount > 0 && <AttentionCount property={property} />}
    </NavLink>
  );
}

function AttentionCount({ property }: { property: PropertyCard }): ReactElement {
  return (
    <span
      title={`${property.attentionCount} needing attention`}
      style={{
        flex: "none",
        display: "grid",
        placeItems: "center",
        width: 18,
        height: 18,
        borderRadius: 999,
        background: hero.pill(property.heroColor, 0.16),
        color: "var(--ink-2)",
        fontFamily: "var(--font-mono)",
        fontSize: 10,
      }}
    >
      {property.attentionCount}
    </span>
  );
}

function RailLink({ to, children }: { to: string; children: string }): ReactElement {
  return (
    <NavLink
      to={to}
      className="kr-rail-link"
      style={{ padding: "5px 0", fontSize: 13, color: "var(--ink-2)" }}
    >
      {children}
    </NavLink>
  );
}
