// server/domain/routing/routes.ts — the maintenance route: what needs doing, and where.
//
// GET  /api/maintenance/route                         open work, grouped by property, with points
// POST /api/maintenance/route/locate                  look up points for stops that have none
// PUT  /api/maintenance/route/locations/:propertyId   set a property's point by hand
// PUT  /api/maintenance/route/home                    set where your day starts and ends
//
// The server does not order the stops. It returns them with their points and
// the client runs shared/route-plan.ts, so ticking a stop off as "not today"
// re-plans the loop without a round trip.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../../db/index.js";
import { requireAuth, requireUser } from "../../auth/middleware.js";
import { parseBody, parseParams, zId, zText } from "../../lib/validate.js";
import { ApiError, notFound, ok } from "../../lib/errors.js";
import { nowIso } from "../../lib/time.js";
import { geocode, type Point } from "./geocoder.js";
import type { AppContext } from "../../context.js";
import type {
  LocateResult,
  LocationSource,
  Priority,
  RouteHomeBase,
  RoutePayload,
  RouteStop,
  WorkOrderStatus,
} from "../../../shared/types.js";

const zLatitude = z.number().min(-90).max(90);
const zLongitude = z.number().min(-180).max(180);

const ManualPointSchema = z.object({ latitude: zLatitude, longitude: zLongitude }).strict();

const HomeSchema = z
  .object({
    address: zText(300).min(1),
    // Both or neither: with them the address is a label and the point is used
    // as given; without them the address is looked up.
    latitude: zLatitude.optional(),
    longitude: zLongitude.optional(),
  })
  .strict()
  .refine((b) => (b.latitude === undefined) === (b.longitude === undefined), {
    message: "Give both latitude and longitude, or neither.",
  });

interface PropertyAddressRow {
  id: string;
  name: string;
  address_line1: string;
  address_line2: string | null;
  city: string;
  state: string;
  postal_code: string;
  hero_color: string | null;
}

export function oneLineAddress(p: PropertyAddressRow): string {
  const street = p.address_line2 ? `${p.address_line1} ${p.address_line2}` : p.address_line1;
  return `${street}, ${p.city}, ${p.state} ${p.postal_code}`.replace(/\s+/g, " ").trim();
}

/** What a stored point was found for. A different key means the address changed since. */
function addressKey(address: string): string {
  return address
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const OPEN_STATUSES: WorkOrderStatus[] = ["new", "triaged", "scheduled", "in_progress"];

/** Owned, on-the-ring properties with at least one open work order. */
function propertiesWithOpenWork(): PropertyAddressRow[] {
  return getDb()
    .prepare(
      `SELECT p.id, p.name, p.address_line1, p.address_line2, p.city, p.state, p.postal_code, p.hero_color
         FROM properties p
        WHERE p.archived_at IS NULL AND p.stage = 'owned'
          AND EXISTS (SELECT 1 FROM work_orders w
                       WHERE w.property_id = p.id
                         AND w.status IN (${OPEN_STATUSES.map(() => "?").join(",")}))
        ORDER BY p.sort_order, p.name`,
    )
    .all(...OPEN_STATUSES) as PropertyAddressRow[];
}

interface LocationRow {
  latitude: number;
  longitude: number;
  address_key: string;
  source: LocationSource;
}

/** The stored point, if it was found for the property's current address. */
function currentLocation(p: PropertyAddressRow): LocationRow | null {
  const row = getDb()
    .prepare(
      `SELECT latitude, longitude, address_key, source FROM property_locations WHERE property_id = ?`,
    )
    .get(p.id) as LocationRow | undefined;
  if (!row || row.address_key !== addressKey(oneLineAddress(p))) return null;
  return row;
}

function saveLocation(p: PropertyAddressRow, point: Point, source: LocationSource): void {
  getDb()
    .prepare(
      `INSERT INTO property_locations (property_id, latitude, longitude, address_key, source, located_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(property_id) DO UPDATE SET
         latitude = excluded.latitude, longitude = excluded.longitude,
         address_key = excluded.address_key, source = excluded.source, located_at = excluded.located_at`,
    )
    .run(p.id, point.latitude, point.longitude, addressKey(oneLineAddress(p)), source, nowIso());
}

function homeBaseFor(userId: string): RouteHomeBase | null {
  const row = getDb()
    .prepare(
      `SELECT address, latitude, longitude, source, updated_at FROM route_home_bases WHERE user_id = ?`,
    )
    .get(userId) as
    | {
        address: string;
        latitude: number;
        longitude: number;
        source: LocationSource;
        updated_at: string;
      }
    | undefined;
  if (!row) return null;
  return {
    address: row.address,
    latitude: row.latitude,
    longitude: row.longitude,
    source: row.source,
    updatedAt: row.updated_at,
  };
}

interface TaskRow {
  id: string;
  property_id: string;
  number: number;
  title: string;
  status: WorkOrderStatus;
  priority: Priority;
  due_date: string | null;
  scheduled_for: string | null;
  unit_label: string | null;
  version: number;
}

const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

function buildRoute(userId: string): RoutePayload {
  const properties = propertiesWithOpenWork();
  const tasks = getDb()
    .prepare(
      `SELECT w.id, w.property_id, w.number, w.title, w.status, w.priority, w.due_date, w.scheduled_for,
              w.version, u.label AS unit_label
         FROM work_orders w
         LEFT JOIN units u ON u.id = w.unit_id
        WHERE w.status IN (${OPEN_STATUSES.map(() => "?").join(",")})`,
    )
    .all(...OPEN_STATUSES) as TaskRow[];

  const byProperty = new Map<string, TaskRow[]>();
  for (const t of tasks) {
    const list = byProperty.get(t.property_id) ?? [];
    list.push(t);
    byProperty.set(t.property_id, list);
  }

  const stops: RouteStop[] = properties.map((p) => {
    const loc = currentLocation(p);
    // Most pressing first within a stop: priority, then the earliest date.
    const list = (byProperty.get(p.id) ?? []).sort(
      (a, b) =>
        PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
        (a.due_date ?? a.scheduled_for ?? "9999").localeCompare(
          b.due_date ?? b.scheduled_for ?? "9999",
        ) ||
        a.number - b.number,
    );
    return {
      propertyId: p.id,
      name: p.name,
      address: oneLineAddress(p),
      heroColor: p.hero_color,
      latitude: loc?.latitude ?? null,
      longitude: loc?.longitude ?? null,
      locationSource: loc?.source ?? null,
      tasks: list.map((t) => ({
        workOrderId: t.id,
        number: t.number,
        title: t.title,
        status: t.status,
        priority: t.priority,
        dueDate: t.due_date,
        scheduledFor: t.scheduled_for,
        unitLabel: t.unit_label,
        version: t.version,
      })),
    };
  });

  return { home: homeBaseFor(userId), stops };
}

const LOOKUP_FAILED =
  "The address lookup couldn't be reached. Try again in a minute, or enter the coordinates by hand.";

export function registerRoutingRoutes(app: FastifyInstance, _ctx: AppContext): void {
  const db = getDb();

  app.get("/api/maintenance/route", { preHandler: [requireAuth] }, async (req) => {
    const user = requireUser(req);
    return ok(buildRoute(user.id));
  });

  app.post("/api/maintenance/route/locate", { preHandler: [requireAuth] }, async () => {
    const result: LocateResult = { located: [], failed: [] };
    // One at a time: a handful of addresses, and a public service that should
    // not be hit with a burst. A transport failure on one stops the batch —
    // the rest would fail the same way — and is reported as an error.
    for (const p of propertiesWithOpenWork()) {
      if (currentLocation(p)) continue;
      const address = oneLineAddress(p);
      let point: Point | null;
      try {
        point = await geocode(address);
      } catch {
        throw new ApiError("INTERNAL", LOOKUP_FAILED);
      }
      if (point) {
        saveLocation(p, point, "geocoder");
        result.located.push(p.id);
      } else {
        result.failed.push({ propertyId: p.id, name: p.name, address });
      }
    }
    return ok(result);
  });

  app.put(
    "/api/maintenance/route/locations/:propertyId",
    { preHandler: [requireAuth] },
    async (req) => {
      const { propertyId } = parseParams(req, z.object({ propertyId: zId }).strict());
      const point = parseBody(req, ManualPointSchema);
      const p = db
        .prepare(
          `SELECT id, name, address_line1, address_line2, city, state, postal_code, hero_color
           FROM properties WHERE id = ?`,
        )
        .get(propertyId) as PropertyAddressRow | undefined;
      if (!p) throw notFound("Property");
      saveLocation(p, point, "manual");
      return ok({ propertyId, ...point, locationSource: "manual" as const });
    },
  );

  app.put("/api/maintenance/route/home", { preHandler: [requireAuth] }, async (req) => {
    const user = requireUser(req);
    const body = parseBody(req, HomeSchema);
    let point: Point;
    let source: LocationSource;
    if (body.latitude !== undefined && body.longitude !== undefined) {
      point = { latitude: body.latitude, longitude: body.longitude };
      source = "manual";
    } else {
      let found: Point | null;
      try {
        found = await geocode(body.address);
      } catch {
        throw new ApiError("INTERNAL", LOOKUP_FAILED);
      }
      if (!found) {
        throw new ApiError(
          "VALIDATION_FAILED",
          "Couldn't find that address on the map. Check it includes the city and state, or enter its coordinates.",
        );
      }
      point = found;
      source = "geocoder";
    }
    const at = nowIso();
    db.prepare(
      `INSERT INTO route_home_bases (user_id, address, latitude, longitude, source, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         address = excluded.address, latitude = excluded.latitude, longitude = excluded.longitude,
         source = excluded.source, updated_at = excluded.updated_at`,
    ).run(user.id, body.address, point.latitude, point.longitude, source, at);
    return ok(homeBaseFor(user.id));
  });
}
