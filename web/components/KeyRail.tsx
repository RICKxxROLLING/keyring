import { useQuery } from "@tanstack/react-query";
import { NavLink, useMatch } from "react-router-dom";
import type { CSSProperties, ReactElement } from "react";
import type { DashboardPayload, PropertyCard } from "../../shared/types";
import { apiGet } from "../lib/api";
import { qk } from "../lib/query";
import { useSession } from "../lib/session";
import { KeyGlyph, hero } from "./KeyGlyph";
import { RingMark } from "./RingMark";
import { DemoBadge } from "./DemoBadge";
import { Avatar } from "./Avatar";
import { ThemeToggle } from "./ThemeToggle";
import { NotificationBell } from "./NotificationBell";
import { GlobalPresenceBar } from "./PresenceBar";

/**
 * The keyring — the design language's organizing element.
 *
 * Desktop: a rail of key tags hanging on a metal ring wire. Its width is fluid
 *          (--rail-w) because it has to fit real property names — at a fixed
 *          268px every name of any length was cut off with an ellipsis.
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

/** How far the wire stops short of the list at each end, so it reads as a ring
 *  closing past the last key rather than as a border down the side. */
const RING_INSET = 8;

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
 * Rendered inside the mobile header, hanging under the master key — never as a
 * sibling of the desktop rail. They were siblings originally, which put the
 * strip in the shell's flex ROW, so it became a full-height column and each key
 * tag stretched to the viewport.
 */
export function KeyStrip(): ReactElement {
  const { properties, activeId } = useRingProperties();

  return (
    <nav
      aria-label="Properties"
      className="kr-key-strip kr-scroll-x"
      style={{
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
            {p.isDemo && <DemoBadge size="small" />}
            {p.attentionCount > 0 && <AttentionCount property={p} />}
          </NavLink>
        );
      })}
    </nav>
  );
}

export function KeyRail(): ReactElement {
  const { properties, activeId } = useRingProperties();
  const { session, logout } = useSession();
  const isOwner = session?.user.role === "owner";
  const owned = properties.filter((p) => p.stage === "owned");
  const prospects = properties.filter((p) => p.stage === "prospect");

  return (
    <nav
      aria-label="Properties"
      className="kr-rail hidden shrink-0 flex-col lg:flex"
        style={{
          width: "var(--rail-w)",
          background: "var(--bg-2)",
          borderRight: "1px solid var(--line)",
          padding: "22px 16px 16px",
        }}
      >
        <NavLink
          to="/"
          end
          aria-label="The keyring — all properties"
          title="The keyring"
          className="kr-master-key"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "6px 6px 12px",
            color: "var(--ink)",
          }}
        >
          {/* The ring itself, not a key: this is the way back to ALL of them.
              A key here would say "one property", which is the one thing this
              link does not mean. */}
          <RingMark size={26} />
          <span className="kr-label" style={{ color: "var(--ink-2)" }}>
            On the ring · {properties.filter((p) => p.stage === "owned").length}
          </span>
        </NavLink>

        <div style={{ position: "relative", marginTop: 12 }}>
          {/* The wire, sized by the list itself.
              It used to derive its height from the key count times a hardcoded
              46px row. The moment a row grew — a name wrapping to two lines —
              the wire fell short and left the last key or two hanging off the
              end of it. Anchoring top AND bottom to the list means it cannot
              disagree with the rows again, whatever they end up containing.
              Decorative. */}
          {owned.length > 0 && (
            <span
              aria-hidden="true"
              style={{
                position: "absolute",
                left: 15,
                top: RING_INSET,
                bottom: RING_INSET,
                width: 17,
                border: "2px solid var(--metal)",
                borderRadius: 999,
                pointerEvents: "none",
              }}
            />
          )}

          <ul style={{ position: "relative", listStyle: "none", margin: 0, padding: 0 }}>
            {owned.map((p) => (
              <li key={p.id}>
                <KeyRow property={p} active={p.id === activeId} dimmed={activeId !== null} />
              </li>
            ))}
          </ul>
        </div>

        {/* Prospects hang below the ring, not on it — they are buildings you
            are considering, not keys you hold, and they are left out of every
            portfolio total for the same reason. */}
        {prospects.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <span className="kr-label" style={{ display: "block", paddingLeft: 6, marginBottom: 6 }}>
              Considering · {prospects.length}
            </span>
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {prospects.map((p) => (
                <li key={p.id}>
                  <KeyRow property={p} active={p.id === activeId} dimmed={activeId !== null} />
                </li>
              ))}
            </ul>
          </div>
        )}

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
            <RailLink to="/search">Search</RailLink>
            <RailLink to="/vendors">Vendors</RailLink>
            {isOwner && <RailLink to="/admin">Admin</RailLink>}
            <RailLink to="/settings">Settings</RailLink>
          </div>

          {/* Everything the desktop top bar used to hold. It was a whole band
              of chrome across the top for four controls that belong with the
              other standing links, so the bar is gone on desktop and its
              contents live here at the foot of the ring. */}
          <div
            style={{
              marginTop: 16,
              paddingTop: 14,
              borderTop: "1px solid var(--line)",
              display: "grid",
              gap: 10,
            }}
          >
            <GlobalPresenceBar />
            {session && (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <NavLink
                  to="/settings"
                  title={session.user.displayName}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    minWidth: 0,
                    flex: 1,
                    color: "var(--ink)",
                  }}
                >
                  <Avatar user={session.user} size={28} />
                  <span
                    style={{
                      minWidth: 0,
                      fontSize: 13,
                      fontWeight: 600,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {session.user.displayName}
                  </span>
                </NavLink>
                <ThemeToggle compact />
                <NotificationBell />
              </div>
            )}
            <button
              type="button"
              onClick={() => void logout()}
              className="kr-rail-link"
              style={{
                justifySelf: "start",
                paddingLeft: 6,
                fontSize: 12.5,
                color: "var(--ink-3)",
              }}
            >
              Log out
            </button>
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

  const isProspect = property.stage === "prospect";
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
    // Dashed for a prospect: the key is drawn but not cut yet.
    border: active
      ? `1px solid ${hero.border(color, 0.35)}`
      : isProspect
        ? "1px dashed var(--line)"
        : "1px solid transparent",
    color: "var(--ink)",
  };

  return (
    <NavLink to={`/p/${property.id}`} className="kr-key-row" style={style}>
      {/* holeColor is the RAIL background so the ring wire shows through the
          bow — the whole reason the glyph paints its hole rather than
          leaving it transparent. */}
      <KeyGlyph color={color} size="rail" holeColor={active ? "transparent" : "var(--bg-2)"} />
      <span style={{ minWidth: 0, flex: 1 }}>
        {/* Two lines before it clips. A rail whose whole job is telling the
            keys apart was rendering "Maple Street Duplex" as "Maple Street…",
            and at one line that was the common case, not the edge case. */}
        <span
          style={{
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: 2,
            fontSize: 14,
            fontWeight: active ? 700 : 600,
            lineHeight: 1.25,
            overflow: "hidden",
            overflowWrap: "anywhere",
          }}
        >
          {property.name}
        </span>
        {/* The subtitle takes the clipping instead — it is the secondary line,
            and its wrapping is what pushed rows past the height the wire had
            assumed. Mono at 0.08em tracking was wide enough that "2 DOORS ·
            FULL" broke onto two lines in a narrow rail. */}
        <span
          className="kr-label"
          style={{
            display: "block",
            fontSize: 10,
            letterSpacing: "0.06em",
            marginTop: 2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {isProspect ? "Prospect" : `${doors} · ${state}`}
        {property.isDemo && (
          <>
            {" "}
            <DemoBadge size="small" />
          </>
        )}
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
