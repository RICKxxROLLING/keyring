// web/pages/RoutePage.test.tsx — the maintenance route as a to-do list with a map.
//
// The ask: "a tool that creates a route based on what's needed to be done, so a
// todo with a map on the most efficient way of doing everything."
import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import type { RoutePayload, RouteStop } from "../../shared/types";
import { server } from "../mocks/server";
import { RoutePage, parseCoords } from "./RoutePage";

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <RoutePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function stop(
  id: string,
  name: string,
  lat: number | null,
  lng: number | null,
  titles: string[],
): RouteStop {
  return {
    propertyId: id,
    name,
    address: `${name} Rd, Kill Devil Hills, NC 27948`,
    heroColor: "oklch(0.6 0.1 200)",
    latitude: lat,
    longitude: lng,
    locationSource: lat === null ? null : "geocoder",
    tasks: titles.map((title, i) => ({
      workOrderId: `wor_${id}${i}`,
      number: i + 1,
      title,
      status: "new",
      priority: "normal",
      dueDate: null,
      scheduledFor: null,
      unitLabel: null,
      version: 3,
    })),
  };
}

const HOME = {
  address: "1 Home St, Kitty Hawk, NC",
  latitude: 36.1,
  longitude: -75.71,
  source: "geocoder" as const,
  updatedAt: "2026-10-01T00:00:00.000Z",
};

function serve(payload: RoutePayload): void {
  server.use(
    http.get("/api/maintenance/route", () => HttpResponse.json({ ok: true, data: payload })),
  );
}

const BEACH: RoutePayload = {
  home: HOME,
  stops: [
    stop("c", "South", 35.9, -75.59, ["Fix deck"]),
    stop("a", "North", 36.05, -75.68, ["Replace filter", "Check smoke alarms"]),
    stop("b", "Middle", 35.98, -75.64, ["Patch drywall"]),
  ],
};

function stopNames(): string[] {
  const list = screen.getAllByRole("list")[0]!;
  return within(list)
    .getAllByRole("listitem")
    .filter((li) => li.parentElement === list)
    .map((li) => within(li).getAllByRole("link")[0]!.textContent ?? "");
}

describe("RoutePage", () => {
  it("orders the stops into the shortest loop and draws it", async () => {
    // Home in the middle, a house at each corner of a square: the shortest loop
    // goes around the edge and never cuts across to the opposite corner.
    serve({
      home: { ...HOME, latitude: 36.0, longitude: -75.65 },
      stops: [
        stop("sw", "SW", 35.95, -75.7, ["Fix deck"]),
        stop("ne", "NE", 36.05, -75.6, ["Replace filter", "Check smoke alarms"]),
        stop("nw", "NW", 36.05, -75.7, ["Patch drywall"]),
        stop("se", "SE", 35.95, -75.6, ["Mow"]),
      ],
    });
    renderPage();

    expect(
      await screen.findByText(/4 stops, 5 jobs, about \d+ miles round trip/),
    ).toBeInTheDocument();
    const names = stopNames();
    const opposite: Record<string, string> = { NE: "SW", SW: "NE", NW: "SE", SE: "NW" };
    for (let i = 0; i + 1 < names.length; i++) expect(names[i + 1]).not.toBe(opposite[names[i]!]);
    expect(screen.getByRole("img", { name: /Map of the route/ })).toBeInTheDocument();
  });

  it("hands the ordered stops to Google Maps, starting and ending at home", async () => {
    serve(BEACH);
    renderPage();
    const link = await screen.findByRole("link", { name: "Drive it in Google Maps" });
    const url = new URL(link.getAttribute("href")!);
    expect(url.searchParams.get("origin")).toBe(HOME.address);
    expect(url.searchParams.get("destination")).toBe(HOME.address);
    const waypoints = url.searchParams.get("waypoints")!.split("|");
    expect(waypoints).toHaveLength(3);
    expect(waypoints.map((w) => w.split(" Rd")[0])).toEqual(stopNames());
  });

  it("re-plans when a stop is left for another day, and can add it back", async () => {
    serve(BEACH);
    renderPage();
    await screen.findByText(/3 stops/);

    const middle = screen.getByRole("link", { name: "Middle" }).closest("li")!;
    await userEvent.click(within(middle).getByRole("button", { name: "Not today" }));
    expect(screen.getByText(/2 stops, 3 jobs/)).toBeInTheDocument();
    expect(stopNames()).not.toContain("Middle");

    await userEvent.click(screen.getByRole("button", { name: "Add back" }));
    expect(screen.getByText(/3 stops, 4 jobs/)).toBeInTheDocument();
  });

  it("ticking a job off marks the work order done", async () => {
    serve(BEACH);
    const patches: { id: string; body: Record<string, unknown> }[] = [];
    server.use(
      http.patch("/api/work-orders/:id", async ({ params, request }) => {
        patches.push({
          id: String(params.id),
          body: (await request.json()) as Record<string, unknown>,
        });
        return HttpResponse.json({ ok: true, data: {} });
      }),
    );
    renderPage();

    await userEvent.click(
      await screen.findByRole("checkbox", { name: 'Mark "Patch drywall" done' }),
    );
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({ id: "wor_b0", body: { status: "done", expectedVersion: 3 } });
  });

  it("asks where the day starts before planning anything", async () => {
    serve({ ...BEACH, home: null });
    let saved: unknown = null;
    server.use(
      http.put("/api/maintenance/route/home", async ({ request }) => {
        saved = await request.json();
        return HttpResponse.json({
          ok: true,
          data: { ...HOME, address: "10 Shop Ln, Nags Head, NC" },
        });
      }),
    );
    renderPage();

    expect(await screen.findByText(/Set where you start/)).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Map of the route/ })).not.toBeInTheDocument();
    await userEvent.type(
      screen.getByPlaceholderText("Street, city, state"),
      "10 Shop Ln, Nags Head, NC",
    );
    await userEvent.click(screen.getByRole("button", { name: "Save home base" }));
    await waitFor(() => expect(saved).toEqual({ address: "10 Shop Ln, Nags Head, NC" }));
  });

  it("offers coordinates when the home address can't be found", async () => {
    serve({ ...BEACH, home: null });
    const bodies: unknown[] = [];
    server.use(
      http.put("/api/maintenance/route/home", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        bodies.push(body);
        if (body["latitude"] === undefined) {
          return HttpResponse.json(
            {
              ok: false,
              error: {
                code: "VALIDATION_FAILED",
                message: "Couldn't find that address on the map.",
              },
            },
            { status: 422 },
          );
        }
        return HttpResponse.json({ ok: true, data: { ...HOME, source: "manual" } });
      }),
    );
    renderPage();

    await userEvent.type(await screen.findByPlaceholderText("Street, city, state"), "The shop");
    await userEvent.click(screen.getByRole("button", { name: "Save home base" }));
    expect(await screen.findByText("Couldn't find that address on the map.")).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText("36.0307, -75.6760"), "35.95, -75.62");
    await userEvent.click(screen.getByRole("button", { name: "Save home base" }));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]).toEqual({ address: "The shop", latitude: 35.95, longitude: -75.62 });
  });

  it("keeps a property it can't place out of the route, and says so", async () => {
    serve({ ...BEACH, stops: [...BEACH.stops, stop("d", "Unplaced", null, null, ["Mow"])] });
    renderPage();
    expect(await screen.findByText(/1 property isn't on the map yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Find them on the map" })).toBeInTheDocument();
    expect(stopNames()).not.toContain("Unplaced");
  });

  it("has nothing to plan when nothing is open", async () => {
    serve({ home: HOME, stops: [] });
    renderPage();
    expect(await screen.findByText("All caught up.")).toBeInTheDocument();
  });
});

describe("parseCoords", () => {
  it("reads what Google Maps copies, and refuses nonsense", () => {
    expect(parseCoords("36.0307, -75.6760")).toEqual({ latitude: 36.0307, longitude: -75.676 });
    expect(parseCoords("36.0307 -75.6760")).toEqual({ latitude: 36.0307, longitude: -75.676 });
    expect(parseCoords("hello")).toBeNull();
    expect(parseCoords("95, 10")).toBeNull();
  });
});
