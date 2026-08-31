import { useQuery } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type { DashboardPayload } from "../../shared/types";
import { apiGet } from "../lib/api";
import { qk } from "../lib/query";
import { useSession } from "../lib/session";
import { formatCents } from "../lib/format";
import { PropertyCard } from "../components/PropertyCard";
import { AttentionFeed } from "../components/AttentionFeed";
import { ErrorNotice, Spinner } from "../components/Form";
import { StatPlate, ProgressBar, DoorBars, RequestDots } from "../components/StatPlate";

/**
 * The keyring — portfolio overview, per the design handoff's screen 1.
 *
 * Copy tone is deliberately plainspoken and human ("Three doors", "Needs a
 * hand"), which is a design decision, not filler: the greeting sentence is
 * generated from the actual numbers so it says something true and specific
 * rather than greeting you and leaving you to read the tiles.
 */
export function DashboardPage(): ReactElement {
  const { session } = useSession();
  const dashboard = useQuery({
    queryKey: qk.dashboard,
    queryFn: () => apiGet<DashboardPayload>("/api/dashboard"),
  });

  if (dashboard.isPending) return <Spinner label="Loading your portfolio…" />;
  if (dashboard.isError) {
    return <ErrorNotice message="Couldn't load the dashboard. Pull to refresh." />;
  }

  const data = dashboard.data;
  const t = data.totals;
  const firstName = (session?.user.displayName ?? "").split(/\s+/)[0] ?? "there";

  const collectedPct =
    t.monthlyRentCents > 0 ? (t.rentCollectedThisMonthCents / t.monthlyRentCents) * 100 : 0;

  // One bar per door across the whole portfolio, coloured by owner, so a gap
  // reads as "that property has an empty door" rather than a bare count.
  const doors = data.properties.flatMap((p) =>
    Array.from({ length: p.quickFacts.unitCount }, (_, i) => ({
      key: `${p.id}-${i}`,
      color: p.heroColor,
      filled: i < p.quickFacts.unitCount - p.quickFacts.vacantUnits,
    })),
  );

  const requestDots = data.needsAttention.map((a, i) => ({
    key: `${a.propertyId}-${i}`,
    color: data.properties.find((p) => p.id === a.propertyId)?.heroColor ?? null,
  }));

  return (
    <div style={{ paddingTop: 28 }}>
      <h1
        className="kr-display"
        style={{ margin: 0, fontSize: 38, lineHeight: 1.1, letterSpacing: "-0.022em" }}
      >
        {greeting()}, {firstName}.
      </h1>
      <p
        style={{
          margin: "10px 0 0",
          maxWidth: 560,
          fontSize: 15,
          lineHeight: 1.5,
          color: "var(--ink-2)",
          textWrap: "pretty",
        }}
      >
        {summarySentence(data)}
      </p>

      <div
        style={{
          display: "grid",
          gap: 16,
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          margin: "26px 0 0",
        }}
      >
        <StatPlate
          label={`Collected in ${monthName()}`}
          figure={formatCents(t.rentCollectedThisMonthCents)}
          sidekick={`of ${formatCents(t.monthlyRentCents)}`}
          visual={<ProgressBar pct={collectedPct} color="oklch(0.655 0.085 128)" />}
          footnote={
            t.rentCollectedThisMonthCents >= t.monthlyRentCents
              ? "All in."
              : `${formatCents(t.monthlyRentCents - t.rentCollectedThisMonthCents)} outstanding`
          }
        />
        <StatPlate
          label="Doors filled"
          figure={String(t.occupied)}
          sidekick={`of ${t.units}`}
          visual={<DoorBars doors={doors} />}
          footnote={t.vacant === 0 ? "Every door filled." : `${t.vacant} vacant`}
        />
        <StatPlate
          label="Needs a hand"
          figure={String(data.needsAttention.length)}
          sidekick={data.needsAttention.length === 1 ? "open request" : "open requests"}
          visual={<RequestDots dots={requestDots} />}
          footnote={data.needsAttention.length === 0 ? "Nothing waiting." : undefined}
        />
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          margin: "34px 0 16px",
        }}
      >
        <h2
          className="kr-display"
          style={{ margin: 0, fontSize: 22, letterSpacing: "-0.014em" }}
        >
          On the ring
        </h2>
        <span className="kr-label">
          {data.properties.length === 1 ? "1 key" : `${data.properties.length} keys`}
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gap: 18,
          gridTemplateColumns: "repeat(auto-fill, minmax(288px, 1fr))",
        }}
      >
        {data.properties.map((p) => (
          <PropertyCard key={p.id} property={p} />
        ))}
      </div>

      <div
        style={{
          display: "grid",
          gap: 18,
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          margin: "34px 0 0",
        }}
      >
        <section
          style={{
            background: "var(--panel-2)",
            border: "1px solid var(--line)",
            borderRadius: 18,
            padding: "18px 20px 8px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              marginBottom: 6,
            }}
          >
            <h2 className="kr-display" style={{ margin: 0, fontSize: 19 }}>
              Needs a hand
            </h2>
            <span className="kr-label">
              {data.needsAttention.length} open
            </span>
          </div>
          <AttentionFeed items={data.needsAttention} properties={data.properties} />
        </section>
      </div>
    </div>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function monthName(): string {
  return new Date().toLocaleString(undefined, { month: "long" });
}

/**
 * One true sentence about the portfolio. Built from the numbers rather than
 * templated, so it reads like a person saying what is going on.
 */
function summarySentence(d: DashboardPayload): string {
  const t = d.totals;
  const doors =
    t.vacant === 0
      ? `All ${t.units} doors are filled.`
      : `${t.occupied} of ${t.units} doors are filled.`;

  if (d.needsAttention.length === 0) return `${doors} Nothing is asking for anything today.`;

  const names = [
    ...new Set(
      d.needsAttention
        .map((a) => d.properties.find((p) => p.id === a.propertyId)?.name)
        .filter((n): n is string => Boolean(n)),
    ),
  ];
  const keys =
    names.length === 1
      ? `${names[0]} is`
      : names.length === 2
        ? `${names[0]} and ${names[1]} are`
        : `${names.length} keys are`;
  return `${doors} ${keys} asking for something today.`;
}
