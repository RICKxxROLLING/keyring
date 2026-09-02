import { NavLink, Outlet, useParams } from "react-router-dom";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type { PropertyDossier } from "../../shared/types";
import { summarizeDiligence } from "../../shared/diligence-checklist";
import { apiGet } from "../lib/api";
import { qk } from "../lib/query";
import { usePropertyChannel } from "../lib/realtime";
import { formatCents } from "../lib/format";
import { PropertyPresenceBar } from "../components/PresenceBar";
import { ErrorNotice, Spinner } from "../components/Form";
import { KeyGlyph, hero } from "../components/KeyGlyph";
import { ProspectBanner } from "../components/ProspectBanner";
import { DemoBadge } from "../components/DemoBadge";
import { EditPropertyDialog } from "../components/EditPropertyDialog";
import { Button } from "../components/Button";

/**
 * One property — the design handoff's screen 2.
 *
 * The hero colour carries the page: a tinted header wash, a matching bottom
 * border, tinted chips, and the active tab sitting flush against the header's
 * edge so the two read as one surface.
 *
 * TABS. The design shows five; the app has more modules than that. The five are
 * the ones with a designed home, and the rest are reachable from Overview
 * rather than being deleted — a tab bar with a dozen items is the thing the
 * design was deliberately avoiding, but losing a feature to make a bar look
 * calm is worse. Every route still exists and still works if linked or
 * bookmarked.
 */
const OWNED_TABS = [
  { to: "overview", label: "Overview" },
  { to: "tenants", label: "Tenants" },
  { to: "money", label: "Ledger" },
  { to: "maintenance", label: "Maintenance" },
  { to: "files", label: "Papers" },
];

/**
 * A property you are considering gets a different bar, not the same bar with
 * two extra items.
 *
 * Tenants and Maintenance are gone because a house you do not own has neither,
 * and a tab that is empty by definition trains you to stop reading the bar. In
 * their place are the three things a decision actually consists of: what it
 * would cost to get it rentable, what you still have to verify, and what the
 * people looking at it think.
 *
 * Both routes still exist. Someone who bookmarked a prospect's Tenants tab, or
 * who is carrying an inherited lease, still gets the page — see NotForProspect
 * in the tabs themselves.
 *
 * The numbers runs the other way: it is here and nowhere else. Once the house
 * is yours the question stops being "should I buy this" and becomes "how is it
 * doing", which the Ledger answers from real rent and real expenses rather than
 * from assumptions. Leaving a projection tab on an owned property would invite
 * reading forecasts as facts.
 */
const PROSPECT_TABS = [
  { to: "overview", label: "Overview" },
  { to: "deal", label: "The numbers" },
  { to: "projects", label: "Renovation" },
  { to: "diligence", label: "Diligence" },
  { to: "discussion", label: "Discussion" },
  { to: "money", label: "Ledger" },
  { to: "files", label: "Papers" },
];

export function DossierPage(): ReactElement {
  const { propertyId } = useParams<{ propertyId: string }>();
  const [editing, setEditing] = useState(false);
  usePropertyChannel(propertyId ?? null);

  const dossier = useQuery({
    queryKey: qk.dossier(propertyId ?? ""),
    queryFn: () => apiGet<PropertyDossier>(`/api/properties/${propertyId}/dossier`),
    enabled: Boolean(propertyId),
  });

  if (dossier.isPending) return <Spinner label="Loading property…" />;
  if (dossier.isError || !dossier.data) {
    return <ErrorNotice message="Couldn't load this property." />;
  }

  const { property } = dossier.data;
  const color = property.heroColor;
  const qf = property.quickFacts;
  const filled = qf.unitCount - qf.vacantUnits;

  return (
    <div>
      {/* ---------------------------------------------------- hero header --- */}
      <header
        style={{
          // Full-bleed within the content column: the wash should reach the
          // page edges, not sit in a card.
          marginInline: "calc(clamp(12px, 3vw, 28px) * -1)",
          padding: "22px clamp(12px, 3vw, 28px) 0",
          background: hero.tint(color, 11),
          borderBottom: `1px solid ${hero.border(color, 0.28)}`,
        }}
      >
        <nav className="kr-label" aria-label="Breadcrumb" style={{ marginBottom: 14 }}>
          <NavLink to="/" style={{ color: "var(--ink-3)" }}>
            The keyring
          </NavLink>
          <span aria-hidden="true"> / </span>
          <span style={{ color: "var(--ink-2)" }}>{property.name}</span>
        </nav>

        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 0, flex: 1 }}>
            <span className="hidden sm:inline">
              <KeyGlyph color={color} size="hero" holeColor="transparent" />
            </span>
            <span className="sm:hidden">
              <KeyGlyph color={color} size="rail" holeColor="transparent" />
            </span>
            <div style={{ minWidth: 0 }}>
              <h1 className="kr-display kr-h-property" style={{ margin: 0 }}>
                {property.name}
              </h1>
              <p className="kr-label" style={{ margin: "8px 0 0", fontSize: 10 }}>
                {property.addressLine1}, {property.city} {property.state}
                {property.yearBuilt ? ` · Built ${property.yearBuilt}` : ""}
              </p>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: "auto" }}>
            <PropertyPresenceBar propertyId={property.id} />
            {/* Cutting a key asks for the minimum on purpose; this is where the
                rest of it gets filled in, or corrected, afterwards. */}
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Edit details
            </Button>
          </div>
        </div>

        {/* Chips: the facts you say out loud when describing the building. */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "16px 0 0" }}>
          {property.isDemo && <DemoBadge />}
          <Chip color={color}>{propertyTypeLabel(property.propertyType)}</Chip>
          <Chip color={color}>
            {qf.unitCount === 1 ? "1 door" : `${qf.unitCount} doors`} · {filled} filled
          </Chip>
          {property.purchaseDate && property.stage === "owned" && (
            <Chip color={color}>Owned since {property.purchaseDate.slice(0, 4)}</Chip>
          )}
        </div>

        {property.stage === "prospect" && <ProspectBanner property={property} />}

        <EditPropertyDialog
          property={property}
          open={editing}
          onClose={() => setEditing(false)}
        />

        {/* Tabs sit flush to the header's bottom edge; the active one matches
            the panel and eats the border so header and body read as one. */}
        <nav
          className="kr-scroll-x"
          aria-label="Property sections"
          style={{ marginTop: 18, marginBottom: -1 }}
        >
          <div style={{ display: "flex", gap: 4, minWidth: "max-content" }}>
            {(property.stage === "prospect" ? PROSPECT_TABS : OWNED_TABS).map((tab) => (
              <NavLink
                key={tab.to}
                to={tab.to}
                className="kr-tab"
                style={({ isActive }) => ({
                  padding: "10px 16px",
                  minHeight: 44,
                  display: "flex",
                  alignItems: "center",
                  borderRadius: "11px 11px 0 0",
                  border: isActive ? `1px solid ${hero.border(color, 0.28)}` : "1px solid transparent",
                  borderBottomColor: isActive ? "var(--panel)" : "transparent",
                  background: isActive ? "var(--panel)" : "transparent",
                  color: isActive ? "var(--ink)" : "var(--ink-3)",
                  fontSize: 13.5,
                  fontWeight: isActive ? 600 : 500,
                  whiteSpace: "nowrap",
                })}
              >
                {tab.label}
              </NavLink>
            ))}
          </div>
        </nav>
      </header>

      {/* ----------------------------------------------------- stat strip --- */}
      <div
        className="kr-scroll-x"
        style={{
          margin: "22px 0",
          border: "1px solid var(--line)",
          borderRadius: 14,
          background: "var(--line-soft)",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(150px, 1fr))",
            gap: 1,
            minWidth: "max-content",
          }}
        >
          {/* A prospect has no rent roll, no doors filled and no open requests,
              so showing four zeroes would be four lies with a confident face.
              These are the numbers that are actually moving while you decide. */}
          {property.stage === "prospect" ? (
            <ProspectStats dossier={dossier.data} color={color} />
          ) : (
            <>
              <Stat label="Rent roll" value={`${formatCents(qf.monthlyRentCents)}`} suffix="/mo" />
              <Stat
                label="Collected this month"
                value={
                  qf.ytdRentReceivedCents >= qf.monthlyRentCents
                    ? "All in"
                    : formatCents(qf.ytdRentReceivedCents)
                }
                valueColor={
                  qf.ytdRentReceivedCents >= qf.monthlyRentCents ? "var(--ok)" : undefined
                }
              />
              <Stat label="Doors filled" value={`${filled} of ${qf.unitCount}`} />
              <Stat
                label="Open requests"
                value={String(qf.openWorkOrders)}
                valueColor={qf.openWorkOrders > 0 ? hero.solid(color) : undefined}
              />
            </>
          )}
        </div>
      </div>

      <Outlet context={dossier.data} />
    </div>
  );
}

function Chip({ color, children }: { color: string | null; children: React.ReactNode }): ReactElement {
  return (
    <span
      style={{
        padding: "5px 12px",
        borderRadius: 999,
        background: "var(--panel)",
        border: `1px solid ${hero.border(color, 0.35)}`,
        fontSize: 12.5,
        color: "var(--ink-2)",
      }}
    >
      {children}
    </span>
  );
}

function Stat({
  label,
  value,
  suffix,
  valueColor,
}: {
  label: string;
  value: string;
  suffix?: string;
  valueColor?: string;
}): ReactElement {
  return (
    <div style={{ background: "var(--panel)", padding: "16px 18px" }}>
      <span className="kr-label" style={{ fontSize: 9.5 }}>
        {label}
      </span>
      <p
        className="kr-display kr-tabular"
        style={{
          margin: "8px 0 0",
          fontSize: 24,
          lineHeight: 1,
          letterSpacing: "-0.018em",
          color: valueColor ?? "var(--ink)",
        }}
      >
        {value}
        {suffix && (
          <span style={{ fontSize: 13, color: "var(--ink-3)", fontFamily: "var(--font-sans)" }}>
            {suffix}
          </span>
        )}
      </p>
    </div>
  );
}

function propertyTypeLabel(t: string): string {
  return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * The four numbers that move while you are deciding.
 *
 * Renovation is budget-and-spent rather than one figure because the gap is the
 * story: a plan with nothing spent against it is a guess, and a plan already
 * over is the thing you needed to notice. Diligence and the thread are counts
 * of what is still open, not of what exists — a checklist that says "19 items"
 * tells you nothing you did not already know.
 */
function ProspectStats({
  dossier,
  color,
}: {
  dossier: PropertyDossier;
  color: string | null;
}): ReactElement {
  const budget = dossier.projects.reduce((sum, p) => sum + p.budgetTotalCents, 0);
  const spent = dossier.projects.reduce((sum, p) => sum + p.actualTotalCents, 0);
  const diligence = summarizeDiligence(dossier.diligence);
  const likes = dossier.discussion.filter((c) => c.sentiment === "like").length;
  const concerns = dossier.discussion.filter((c) => c.sentiment === "dislike").length;

  return (
    <>
      <Stat label="Renovation budget" value={formatCents(budget)} />
      <Stat
        label="Spent so far"
        value={formatCents(spent)}
        valueColor={budget > 0 && spent > budget ? "var(--crit)" : undefined}
      />
      <Stat
        label="Still to verify"
        value={
          diligence.total === 0 ? "—" : `${diligence.outstanding} of ${diligence.total}`
        }
        valueColor={diligence.blocked > 0 ? "var(--warn)" : undefined}
      />
      <Stat
        label="Likes / concerns"
        value={`${likes} / ${concerns}`}
        valueColor={concerns > likes ? "var(--warn)" : hero.solid(color)}
      />
    </>
  );
}
