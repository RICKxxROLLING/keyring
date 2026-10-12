// shared/route-plan.test.ts — the order to visit properties in.
import { describe, expect, it } from "vitest";
import {
  EXACT_LIMIT,
  MAX_WAYPOINTS,
  directionsLinks,
  milesBetween,
  planRoute,
  type LatLng,
} from "./route-plan";

const at = (latitude: number, longitude: number, name = ""): LatLng & { name: string } => ({
  latitude,
  longitude,
  name,
});

/** Brute force over every permutation: the yardstick for "shortest". */
function bruteForceMiles(home: LatLng, stops: LatLng[]): number {
  let best = Infinity;
  const permute = (rest: LatLng[], path: LatLng[]): void => {
    if (rest.length === 0) {
      const loop = [home, ...path, home];
      let miles = 0;
      for (let i = 0; i + 1 < loop.length; i++) miles += milesBetween(loop[i]!, loop[i + 1]!);
      best = Math.min(best, miles);
      return;
    }
    rest.forEach((s, i) => permute([...rest.slice(0, i), ...rest.slice(i + 1)], [...path, s]));
  };
  permute(stops, []);
  return best;
}

/** Deterministic pseudo-random points around the Outer Banks. */
function scatter(count: number, seed: number): LatLng[] {
  let x = seed;
  const rand = (): number => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
  return Array.from({ length: count }, () => at(35.7 + rand() * 0.5, -75.8 + rand() * 0.3));
}

describe("milesBetween", () => {
  it("measures a known distance", () => {
    // Kill Devil Hills to Manteo is about 8½ miles as the crow flies.
    const miles = milesBetween(at(36.0307, -75.676), at(35.9082, -75.6757));
    expect(miles).toBeGreaterThan(8);
    expect(miles).toBeLessThan(9);
  });
});

describe("planRoute", () => {
  const home = at(36.0, -75.67, "home");

  it("has nothing to do with no stops", () => {
    expect(planRoute(home, [])).toEqual({ order: [], legMiles: [], totalMiles: 0, exact: true });
  });

  it("goes around the houses rather than criss-crossing between them", () => {
    // Home in the middle, four houses at the corners of a square, handed over
    // shuffled. (Houses in one straight line would be a poor test: out-and-back
    // along a line is the same distance in many orders.)
    const ne = at(36.05, -75.6, "ne");
    const se = at(35.95, -75.6, "se");
    const sw = at(35.95, -75.7, "sw");
    const nw = at(36.05, -75.7, "nw");
    const centre = at(36.0, -75.65, "home");
    const plan = planRoute(centre, [sw, ne, nw, se]);
    const names = plan.order.map((s) => s.name);
    const diagonal = (x: string, y: string): boolean =>
      (x === "ne" && y === "sw") ||
      (x === "sw" && y === "ne") ||
      (x === "nw" && y === "se") ||
      (x === "se" && y === "nw");
    for (let i = 0; i + 1 < names.length; i++)
      expect(diagonal(names[i]!, names[i + 1]!)).toBe(false);
    expect(plan.exact).toBe(true);
    expect(plan.legMiles).toHaveLength(5);
    expect(plan.totalMiles).toBeCloseTo(
      plan.legMiles.reduce((s, m) => s + m, 0),
      9,
    );
  });

  it("finds the true shortest loop for a normal day", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const stops = scatter(7, seed);
      const plan = planRoute(home, stops);
      expect(plan.totalMiles).toBeCloseTo(bruteForceMiles(home, stops), 6);
      expect(new Set(plan.order)).toEqual(new Set(stops));
    }
  });

  it("still visits every stop exactly once past the exact limit", () => {
    const stops = scatter(EXACT_LIMIT + 8, 42);
    const plan = planRoute(home, stops);
    expect(plan.exact).toBe(false);
    expect(plan.order).toHaveLength(stops.length);
    expect(new Set(plan.order)).toEqual(new Set(stops));
  });
});

describe("directionsLinks", () => {
  it("starts and ends at home with the stops as waypoints, in order", () => {
    const [link, ...more] = directionsLinks("1 Home Rd", ["10 A St", "20 B St"]);
    expect(more).toHaveLength(0);
    const url = new URL(link!);
    expect(url.origin + url.pathname).toBe("https://www.google.com/maps/dir/");
    expect(url.searchParams.get("origin")).toBe("1 Home Rd");
    expect(url.searchParams.get("destination")).toBe("1 Home Rd");
    expect(url.searchParams.get("waypoints")).toBe("10 A St|20 B St");
    expect(url.searchParams.get("travelmode")).toBe("driving");
  });

  it("splits a long day into legs that pick up where the last one ended", () => {
    const stops = Array.from({ length: MAX_WAYPOINTS + 4 }, (_, i) => `${i + 1} Stop St`);
    const links = directionsLinks("Home", stops).map((l) => new URL(l).searchParams);
    expect(links).toHaveLength(2);
    for (const p of links) {
      expect((p.get("waypoints") ?? "").split("|").filter(Boolean).length).toBeLessThanOrEqual(
        MAX_WAYPOINTS,
      );
    }
    expect(links[0]!.get("origin")).toBe("Home");
    expect(links[1]!.get("origin")).toBe(links[0]!.get("destination"));
    expect(links[1]!.get("destination")).toBe("Home");
    // Every stop appears exactly once across the legs, as a waypoint or a leg boundary.
    const visited = links.flatMap((p) => [
      ...(p.get("waypoints") ?? "").split("|").filter(Boolean),
      p.get("destination")!,
    ]);
    expect(visited.filter((v) => v !== "Home")).toEqual(stops);
  });

  it("has no links when there is nowhere to go", () => {
    expect(directionsLinks("Home", [])).toEqual([]);
  });
});
