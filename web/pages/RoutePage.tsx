import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
  type RefObject,
} from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  LocateResult,
  RouteHomeBase,
  RoutePayload,
  RouteStop,
  RouteTask,
} from "../../shared/types";
import { directionsLinks, milesBetween, planRoute, type LatLng } from "../../shared/route-plan";
import { apiGet, apiPatch, apiPost, apiPut, ApiClientError } from "../lib/api";
import { qk } from "../lib/query";
import { formatDate } from "../lib/format";
import { Button } from "../components/Button";
import { EmptyState, ErrorNotice, Field, Spinner, TextInput } from "../components/Form";

/**
 * The maintenance route — every open work order across the ring, as one loop.
 *
 * The ask: "a tool that creates a route based on what's needed to be done, so a
 * todo with a map on the most efficient way of doing everything."
 *
 * The page is the to-do list; the map is there to show the list's order makes
 * sense. Stops are ordered in the browser (shared/route-plan.ts) so "skip this
 * one today" re-plans instantly, and the drive itself is handed to Google Maps
 * with the stops already in order — the app draws its own map from coordinates
 * and loads nothing from a map provider.
 */
const ROUTE_KEY = qk.maintenanceRoute;

type Located = RouteStop & LatLng;

/** A plain surface, matching the dashboard's sections. */
const PANEL = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: 16,
} as const;

function isLocated(s: RouteStop): s is Located {
  return s.latitude !== null && s.longitude !== null;
}

export function RoutePage(): ReactElement {
  const route = useQuery({
    queryKey: ROUTE_KEY,
    queryFn: () => apiGet<RoutePayload>("/api/maintenance/route"),
  });
  const [skipped, setSkipped] = useState<Set<string>>(new Set());

  const data = route.data;
  const plan = useMemo(() => {
    if (!data?.home) return null;
    const stops = data.stops.filter(isLocated).filter((s) => !skipped.has(s.propertyId));
    return planRoute(data.home, stops);
  }, [data, skipped]);

  if (route.isPending) return <Spinner label="Working out the route…" />;
  if (route.isError || !data) return <ErrorNotice message="Couldn't load the route." />;

  const unlocated = data.stops.filter((s) => !isLocated(s));
  const skippedStops = data.stops.filter((s) => isLocated(s) && skipped.has(s.propertyId));
  const jobCount = plan ? plan.order.reduce((n, s) => n + s.tasks.length, 0) : 0;

  const toggleSkip = (id: string): void =>
    setSkipped((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div style={{ paddingTop: 28 }}>
      <h1 className="kr-display kr-h1" style={{ margin: 0 }}>
        The route
      </h1>
      <p
        style={{
          margin: "10px 0 0",
          maxWidth: 560,
          fontSize: 15,
          lineHeight: 1.5,
          color: "var(--ink-2)",
        }}
      >
        {data.stops.length === 0
          ? "Nothing is open on any property. No route needed."
          : !data.home
            ? "Every open work order across the ring, in the shortest loop from your door. Set where you start to plan it."
            : plan && plan.order.length > 0
              ? `${plan.order.length === 1 ? "1 stop" : `${plan.order.length} stops`}, ${jobCount === 1 ? "1 job" : `${jobCount} jobs`}, about ${Math.round(plan.totalMiles)} miles round trip as the crow flies.`
              : "Nothing left on today's route."}
      </p>

      <HomeBaseCard home={data.home} />

      {unlocated.length > 0 && <LocateCard stops={unlocated} />}

      {data.home && plan && plan.order.length > 0 && (
        <>
          <RouteMap home={data.home} stops={plan.order} />
          <DirectionsButtons home={data.home} stops={plan.order} />
          <ol
            style={{ listStyle: "none", margin: "18px 0 0", padding: 0, display: "grid", gap: 14 }}
          >
            {plan.order.map((stop, i) => (
              <StopCard
                key={stop.propertyId}
                stop={stop}
                index={i + 1}
                milesIn={plan.legMiles[i] ?? 0}
                onSkip={() => toggleSkip(stop.propertyId)}
              />
            ))}
          </ol>
          <p className="kr-label" style={{ margin: "14px 0 0" }}>
            Back home · {plan.legMiles[plan.legMiles.length - 1]!.toFixed(1)} mi
          </p>
        </>
      )}

      {skippedStops.length > 0 && (
        <section style={{ margin: "26px 0 0" }}>
          <h2 className="kr-label" style={{ margin: "0 0 8px" }}>
            Not today
          </h2>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
            {skippedStops.map((s) => (
              <li key={s.propertyId} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ flex: 1, color: "var(--ink-2)", fontSize: 14 }}>
                  {s.name} · {s.tasks.length === 1 ? "1 job" : `${s.tasks.length} jobs`}
                </span>
                <Button variant="ghost" onClick={() => toggleSkip(s.propertyId)}>
                  Add back
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.stops.length === 0 && (
        <EmptyState
          title="All caught up."
          detail="Open work orders on any property will show up here as stops."
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------ home base -- */

function HomeBaseCard({ home }: { home: RouteHomeBase | null }): ReactElement {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(home === null);
  const [address, setAddress] = useState(home?.address ?? "");
  const [coords, setCoords] = useState("");
  const [needCoords, setNeedCoords] = useState(false);

  const save = useMutation({
    mutationFn: (body: { address: string; latitude?: number; longitude?: number }) =>
      apiPut<RouteHomeBase>("/api/maintenance/route/home", body),
    onSuccess: () => {
      setEditing(false);
      setNeedCoords(false);
      setCoords("");
      void queryClient.invalidateQueries({ queryKey: ROUTE_KEY });
    },
    onError: (err) => {
      // Not found, or the lookup is down: either way, typing the point works.
      if (err instanceof ApiClientError) setNeedCoords(true);
    },
  });

  const coordsParsed = parseCoords(coords);

  function submit(e: FormEvent): void {
    e.preventDefault();
    if (needCoords && coordsParsed) save.mutate({ address: address.trim(), ...coordsParsed });
    else save.mutate({ address: address.trim() });
  }

  if (!editing && home) {
    return (
      <p style={{ margin: "14px 0 0", fontSize: 14, color: "var(--ink-2)" }}>
        Starting and ending at <strong style={{ color: "var(--ink)" }}>{home.address}</strong>{" "}
        <button
          type="button"
          onClick={() => setEditing(true)}
          style={{ color: "var(--ink-3)", textDecoration: "underline", fontSize: 13 }}
        >
          Change
        </button>
      </p>
    );
  }

  return (
    <form onSubmit={submit} style={{ ...PANEL, margin: "18px 0 0", padding: 16, maxWidth: 520 }}>
      <Field
        label="Where does your day start and end?"
        hint="Your own home base — the others on the team set theirs."
      >
        <TextInput
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Street, city, state"
          autoComplete="street-address"
        />
      </Field>
      {needCoords && (
        <Field
          label="Coordinates"
          hint="Couldn't place that address. In Google Maps, long-press the spot and copy the numbers it shows, e.g. 36.0307, -75.6760."
          error={coords && !coordsParsed ? "Two numbers, latitude then longitude." : undefined}
        >
          <TextInput
            value={coords}
            onChange={(e) => setCoords(e.target.value)}
            placeholder="36.0307, -75.6760"
          />
        </Field>
      )}
      {save.error && <ErrorNotice message={save.error.message} />}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <Button
          type="submit"
          disabled={!address.trim() || save.isPending || (needCoords && !coordsParsed)}
        >
          {save.isPending ? "Saving…" : "Save home base"}
        </Button>
        {home && (
          <Button type="button" variant="secondary" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

/** "36.03, -75.67" → a point, or null. Accepts the comma or a space between. */
export function parseCoords(text: string): { latitude: number; longitude: number } | null {
  const m = text.trim().match(/^(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const latitude = Number(m[1]);
  const longitude = Number(m[2]);
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

/* --------------------------------------------------------- finding stops -- */

function LocateCard({ stops }: { stops: RouteStop[] }): ReactElement {
  const queryClient = useQueryClient();
  const [failed, setFailed] = useState<Set<string>>(new Set());

  const locate = useMutation({
    mutationFn: () => apiPost<LocateResult>("/api/maintenance/route/locate"),
    onSuccess: (r) => {
      setFailed(new Set(r.failed.map((f) => f.propertyId)));
      void queryClient.invalidateQueries({ queryKey: ROUTE_KEY });
    },
  });

  const tried = locate.isSuccess;
  return (
    <section style={{ ...PANEL, margin: "18px 0 0", padding: 16 }}>
      <p style={{ margin: 0, fontSize: 14, color: "var(--ink-2)" }}>
        {stops.length === 1 ? "1 property isn't" : `${stops.length} properties aren't`} on the map
        yet, so {stops.length === 1 ? "it's" : "they're"} not in the route. Finding them sends each
        address once to the US Census Bureau's address lookup.
      </p>
      {!tried && (
        <div style={{ marginTop: 10 }}>
          <Button onClick={() => locate.mutate()} disabled={locate.isPending}>
            {locate.isPending ? "Finding…" : "Find them on the map"}
          </Button>
        </div>
      )}
      {locate.error && (
        <div style={{ marginTop: 10 }}>
          <ErrorNotice message={locate.error.message} />
        </div>
      )}
      {(tried || locate.isError) && (
        <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "grid", gap: 10 }}>
          {stops
            .filter((s) => !tried || failed.has(s.propertyId))
            .map((s) => (
              <ManualPoint key={s.propertyId} stop={s} />
            ))}
        </ul>
      )}
    </section>
  );
}

function ManualPoint({ stop }: { stop: RouteStop }): ReactElement {
  const queryClient = useQueryClient();
  const [coords, setCoords] = useState("");
  const parsed = parseCoords(coords);
  const save = useMutation({
    mutationFn: () => apiPut(`/api/maintenance/route/locations/${stop.propertyId}`, parsed),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ROUTE_KEY }),
  });
  return (
    <li>
      <Field
        label={`${stop.name} — ${stop.address}`}
        hint="Couldn't find this address. Paste its coordinates from Google Maps (long-press the spot)."
        error={save.error?.message}
      >
        <span style={{ display: "flex", gap: 8 }}>
          <TextInput
            value={coords}
            onChange={(e) => setCoords(e.target.value)}
            placeholder="36.0307, -75.6760"
          />
          <Button onClick={() => save.mutate()} disabled={!parsed || save.isPending}>
            Place
          </Button>
        </span>
      </Field>
    </li>
  );
}

/* ------------------------------------------------------------------ map -- */

const PAD = 30;
/** Room under the plot for the scale bar, so a stop is never drawn over it. */
const BAR_BAND = 30;

/**
 * The element's rendered width, so the map can be drawn in real pixels: a
 * marker is the same size on a phone as on a desktop instead of shrinking with
 * a scaled viewBox. Falls back to a fixed width where ResizeObserver is absent
 * (tests, very old browsers).
 */
function useWidth(fallback: number): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry?.contentRect.width ?? 0);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/**
 * The loop, drawn from coordinates. No tiles: the shape of the route and where
 * the stops sit relative to each other is what this answers, and the maps app
 * has the streets.
 *
 * Projection is equirectangular with longitude scaled by cos(latitude), which
 * keeps distances true to within a hair across a few miles of coast.
 */
function RouteMap({ home, stops }: { home: LatLng; stops: Located[] }): ReactElement {
  const [boxRef, MAP_W] = useWidth(640);
  const points: LatLng[] = [home, ...stops];
  const meanLat = points.reduce((s, p) => s + p.latitude, 0) / points.length;
  const k = Math.cos((meanLat * Math.PI) / 180);
  const xs = points.map((p) => p.longitude * k);
  const ys = points.map((p) => -p.latitude);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  // A single stop next door would otherwise divide by ~0.
  const spanX = Math.max(maxX - minX, 0.005);
  const spanY = Math.max(maxY - minY, 0.005);
  // The box follows the route's shape — a run down a barrier island is tall and
  // thin — within limits, so a phone is not handed a wide strip of empty map.
  const MAP_H = Math.round(
    Math.min(560, Math.max(240, (MAP_W - PAD * 2) * (spanY / spanX) + PAD * 2 + BAR_BAND)),
  );
  const plotH = MAP_H - BAR_BAND;
  const scale = Math.min((MAP_W - PAD * 2) / spanX, (plotH - PAD * 2) / spanY);
  const offX = (MAP_W - spanX * scale) / 2;
  const offY = (plotH - spanY * scale) / 2;
  const project = (p: LatLng): [number, number] => [
    offX + (p.longitude * k - minX) * scale,
    offY + (-p.latitude - minY) * scale,
  ];

  const loop = [home, ...stops, home].map(project);
  const [hx, hy] = project(home);

  // Scale bar: a round number of miles about a fifth of the width.
  const milesAcross = milesBetween(
    { latitude: meanLat, longitude: minX / k },
    { latitude: meanLat, longitude: (minX + MAP_W / scale) / k },
  );
  const target = milesAcross / 5;
  const nice = [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 50].find((n) => n >= target) ?? 100;
  const barPx = (nice / milesAcross) * MAP_W;

  return (
    <figure style={{ margin: "18px 0 0" }}>
      <div ref={boxRef}>
        <svg
          viewBox={`0 0 ${MAP_W} ${MAP_H}`}
          role="img"
          aria-label={`Map of the route: home, then ${stops.map((s) => s.name).join(", ")}, then home.`}
          style={{
            width: "100%",
            height: MAP_H,
            display: "block",
            background: "var(--panel-2)",
            border: "1px solid var(--line)",
            borderRadius: 18,
          }}
        >
          <polyline
            points={loop.map(([x, y]) => `${x},${y}`).join(" ")}
            fill="none"
            stroke="var(--ink-3)"
            strokeWidth={2}
            strokeDasharray="6 5"
            strokeLinejoin="round"
          />
          {stops.map((s, i) => {
            const [x, y] = project(s);
            return (
              <g key={s.propertyId}>
                <title>{`${i + 1}. ${s.name}`}</title>
                <circle
                  cx={x}
                  cy={y}
                  r={13}
                  fill={s.heroColor ?? "var(--ink-2)"}
                  stroke="var(--panel)"
                  strokeWidth={2.5}
                />
                <text
                  x={x}
                  y={y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={12}
                  fontWeight={700}
                  fill="#fff"
                >
                  {i + 1}
                </text>
              </g>
            );
          })}
          {/* Drawn last so a property next door to home never hides it. */}
          <g>
            <title>Home base</title>
            <rect
              x={hx - 11}
              y={hy - 11}
              width={22}
              height={22}
              rx={5}
              fill="var(--ink)"
              stroke="var(--panel)"
              strokeWidth={2}
            />
            <path
              d={`M${hx - 5} ${hy + 1} L${hx} ${hy - 4} L${hx + 5} ${hy + 1} M${hx - 3.5} ${hy} V${hy + 4.5} H${hx + 3.5} V${hy}`}
              stroke="var(--panel)"
              strokeWidth={1.6}
              fill="none"
            />
          </g>
          <g transform={`translate(${PAD - 10}, ${MAP_H - BAR_BAND / 2 - 2})`}>
            <line x1={0} y1={0} x2={barPx} y2={0} stroke="var(--ink-3)" strokeWidth={2} />
            <line x1={0} y1={-4} x2={0} y2={4} stroke="var(--ink-3)" strokeWidth={2} />
            <line x1={barPx} y1={-4} x2={barPx} y2={4} stroke="var(--ink-3)" strokeWidth={2} />
            <text x={barPx + 6} y={0} dominantBaseline="central" fontSize={11} fill="var(--ink-3)">
              {nice} mi
            </text>
          </g>
        </svg>
      </div>
      <figcaption className="kr-label" style={{ marginTop: 6, fontSize: 9 }}>
        Straight lines between stops · north is up
      </figcaption>
    </figure>
  );
}

/* ---------------------------------------------------------- directions -- */

function DirectionsButtons({
  home,
  stops,
}: {
  home: RouteHomeBase;
  stops: Located[];
}): ReactElement {
  const links = directionsLinks(
    home.address,
    stops.map((s) => s.address),
  );
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "14px 0 0" }}>
      {links.map((href, i) => (
        <a
          key={href}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="kr-btn kr-btn-primary tap-target inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold"
        >
          {links.length === 1 ? "Drive it in Google Maps" : `Drive leg ${i + 1} of ${links.length}`}
        </a>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- to-do -- */

const PRIORITY_LABEL: Record<RouteTask["priority"], string | null> = {
  urgent: "Urgent",
  high: "High",
  normal: null,
  low: null,
};

function StopCard(props: {
  stop: Located;
  index: number;
  milesIn: number;
  onSkip: () => void;
}): ReactElement {
  const { stop, index, milesIn, onSkip } = props;
  return (
    <li style={{ ...PANEL, padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span
          aria-hidden="true"
          style={{
            display: "grid",
            placeItems: "center",
            width: 28,
            height: 28,
            flex: "none",
            borderRadius: 999,
            background: stop.heroColor ?? "var(--ink-2)",
            color: "#fff",
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          {index}
        </span>
        <span style={{ minWidth: 0, flex: 1 }}>
          <Link
            to={`/p/${stop.propertyId}/maintenance`}
            style={{ fontWeight: 600, color: "var(--ink)" }}
          >
            {stop.name}
          </Link>
          <span style={{ display: "block", fontSize: 12.5, color: "var(--ink-3)" }}>
            {stop.address} · {milesIn.toFixed(1)} mi from the last stop
          </span>
        </span>
        <Button variant="ghost" onClick={onSkip}>
          Not today
        </Button>
      </div>
      <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0, display: "grid", gap: 6 }}>
        {stop.tasks.map((t) => (
          <TaskRow key={t.workOrderId} task={t} propertyId={stop.propertyId} />
        ))}
      </ul>
    </li>
  );
}

function TaskRow({ task, propertyId }: { task: RouteTask; propertyId: string }): ReactElement {
  const queryClient = useQueryClient();
  const done = useMutation({
    mutationFn: () =>
      apiPatch(`/api/work-orders/${task.workOrderId}`, {
        status: "done",
        expectedVersion: task.version,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ROUTE_KEY });
      void queryClient.invalidateQueries({ queryKey: qk.dossier(propertyId) });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard });
    },
  });
  const label = PRIORITY_LABEL[task.priority];
  const when = task.dueDate
    ? `due ${formatDate(task.dueDate)}`
    : task.scheduledFor
      ? `scheduled ${formatDate(task.scheduledFor)}`
      : null;
  return (
    <li style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
      <input
        type="checkbox"
        aria-label={`Mark "${task.title}" done`}
        checked={done.isPending || done.isSuccess}
        disabled={done.isPending || done.isSuccess}
        onChange={() => done.mutate()}
        style={{ marginTop: 3, width: 18, height: 18, flex: "none" }}
      />
      <span style={{ minWidth: 0, flex: 1, fontSize: 14 }}>
        <Link
          to={`/p/${propertyId}/maintenance?wo=${task.workOrderId}`}
          style={{ color: "var(--ink)" }}
        >
          {task.title}
        </Link>
        <span style={{ color: "var(--ink-3)", fontSize: 12.5 }}>
          {" "}
          · WO-{task.number}
          {task.unitLabel ? ` · ${task.unitLabel}` : ""}
          {when ? ` · ${when}` : ""}
        </span>
        {label && (
          <span
            className="kr-label"
            style={{
              marginLeft: 8,
              fontSize: 9,
              color: task.priority === "urgent" ? "var(--warn)" : "var(--ink-2)",
            }}
          >
            {label}
          </span>
        )}
        {done.error && (
          <span role="alert" style={{ display: "block", fontSize: 12, color: "var(--warn)" }}>
            {done.error.message}
          </span>
        )}
      </span>
    </li>
  );
}
