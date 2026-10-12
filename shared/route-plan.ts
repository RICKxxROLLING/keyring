// shared/route-plan.ts — the order to visit properties in, starting and ending at home.
//
// The ask: "a tool that creates a route based on what's needed to be done, so a
// todo with a map on the most efficient way of doing everything."
//
// DISTANCES ARE STRAIGHT LINES. The app makes no calls to a routing service, so
// it orders stops by great-circle distance and hands the ordered list to the
// phone's maps app for the actual driving. For a handful of houses in one area
// the shortest straight-line loop and the shortest driving loop are nearly
// always the same order; where water or a missing bridge makes them differ,
// the maps app still drives the right roads between the stops it was given.
//
// EXACT FOR A NORMAL DAY. Up to EXACT_LIMIT stops the loop is the true shortest
// (Held-Karp, O(n²·2ⁿ) — 12 stops is about 600k steps). Past that it is nearest
// neighbour improved by 2-opt, which is within a few percent in practice and
// still instant. A small portfolio will essentially never leave the exact path.

export interface LatLng {
  latitude: number;
  longitude: number;
}

/** Above this many stops, fall back from exact to heuristic. */
export const EXACT_LIMIT = 12;

const EARTH_RADIUS_MILES = 3958.8;

/** Great-circle distance in miles. */
export function milesBetween(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLng = (b.longitude - a.longitude) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface PlannedRoute<T> {
  /** The stops in visiting order. Home is implied at both ends. */
  order: T[];
  /** Miles for each leg: home → first, …, last → home. order.length + 1 entries (none if no stops). */
  legMiles: number[];
  totalMiles: number;
  /** True when the order is provably the shortest loop. */
  exact: boolean;
}

/**
 * The shortest loop from home through every stop and back.
 *
 * Generic over the stop type so the caller keeps whatever it hung on each stop
 * (the property, its tasks) without a lookup afterwards.
 */
export function planRoute<T extends LatLng>(home: LatLng, stops: readonly T[]): PlannedRoute<T> {
  if (stops.length === 0) return { order: [], legMiles: [], totalMiles: 0, exact: true };

  // Node 0 is home; stops are 1..n.
  const points: LatLng[] = [home, ...stops];
  const d: number[][] = points.map((p) => points.map((q) => milesBetween(p, q)));

  const exact = stops.length <= EXACT_LIMIT;
  const tour = exact ? heldKarp(d) : twoOpt(d, nearestNeighbour(d));

  const order = tour.map((i) => stops[i - 1]!);
  const path = [0, ...tour, 0];
  const legMiles: number[] = [];
  for (let i = 0; i + 1 < path.length; i++) legMiles.push(d[path[i]!]![path[i + 1]!]!);
  const totalMiles = legMiles.reduce((s, m) => s + m, 0);
  return { order, legMiles, totalMiles, exact };
}

/** Exact shortest round trip from node 0. Returns the visiting order of nodes 1..n-1. */
function heldKarp(d: number[][]): number[] {
  const m = d.length - 1; // stops
  const full = (1 << m) - 1;
  // cost[mask][j]: shortest path from home visiting exactly `mask`, ending at stop j (0-based).
  const cost: Float64Array[] = Array.from({ length: 1 << m }, () =>
    new Float64Array(m).fill(Infinity),
  );
  const prev: Int8Array[] = Array.from({ length: 1 << m }, () => new Int8Array(m).fill(-1));
  for (let j = 0; j < m; j++) cost[1 << j]![j] = d[0]![j + 1]!;

  for (let mask = 1; mask <= full; mask++) {
    const row = cost[mask]!;
    for (let j = 0; j < m; j++) {
      const here = row[j]!;
      if (!(mask & (1 << j)) || here === Infinity) continue;
      for (let k = 0; k < m; k++) {
        if (mask & (1 << k)) continue;
        const next = mask | (1 << k);
        const c = here + d[j + 1]![k + 1]!;
        if (c < cost[next]![k]!) {
          cost[next]![k] = c;
          prev[next]![k] = j;
        }
      }
    }
  }

  let best = Infinity;
  let last = 0;
  for (let j = 0; j < m; j++) {
    const c = cost[full]![j]! + d[j + 1]![0]!;
    if (c < best) {
      best = c;
      last = j;
    }
  }

  const order: number[] = [];
  let mask = full;
  let j = last;
  while (j !== -1) {
    order.push(j + 1);
    const p = prev[mask]![j]!;
    mask &= ~(1 << j);
    j = p;
  }
  return order.reverse();
}

function nearestNeighbour(d: number[][]): number[] {
  const left = new Set<number>();
  for (let i = 1; i < d.length; i++) left.add(i);
  const order: number[] = [];
  let at = 0;
  while (left.size > 0) {
    let best = -1;
    for (const i of left) if (best === -1 || d[at]![i]! < d[at]![best]!) best = i;
    order.push(best);
    left.delete(best);
    at = best;
  }
  return order;
}

/** Reverse segments while doing so shortens the loop. */
function twoOpt(d: number[][], order: number[]): number[] {
  const path = [0, ...order, 0];
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < path.length - 2; i++) {
      for (let k = i + 1; k < path.length - 1; k++) {
        const a = path[i - 1]!;
        const b = path[i]!;
        const c = path[k]!;
        const e = path[k + 1]!;
        const delta = d[a]![c]! + d[b]![e]! - d[a]![b]! - d[c]![e]!;
        if (delta < -1e-9) {
          path.splice(i, k - i + 1, ...path.slice(i, k + 1).reverse());
          improved = true;
        }
      }
    }
  }
  return path.slice(1, -1);
}

/**
 * Google Maps directions links for the loop, split into legs the app accepts.
 *
 * Google's URL scheme takes at most nine waypoints between origin and
 * destination (fewer are honoured on some phones), so a long day is cut into
 * consecutive legs: each one starts where the last ended. Addresses are used
 * rather than coordinates so the maps app shows street names and finds the
 * driveway, not a point on a parcel.
 */
export const MAX_WAYPOINTS = 9;

export function directionsLinks(homeAddress: string, stopAddresses: readonly string[]): string[] {
  if (stopAddresses.length === 0) return [];
  const all = [homeAddress, ...stopAddresses, homeAddress];
  const links: string[] = [];
  // Each leg covers origin + up to MAX_WAYPOINTS + destination.
  const span = MAX_WAYPOINTS + 1;
  for (let start = 0; start < all.length - 1; start += span) {
    const end = Math.min(start + span, all.length - 1);
    const origin = all[start]!;
    const destination = all[end]!;
    const waypoints = all.slice(start + 1, end);
    const params = new URLSearchParams({ api: "1", origin, destination, travelmode: "driving" });
    if (waypoints.length > 0) params.set("waypoints", waypoints.join("|"));
    links.push(`https://www.google.com/maps/dir/?${params.toString()}`);
  }
  return links;
}
