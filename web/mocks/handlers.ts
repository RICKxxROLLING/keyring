// web/mocks/handlers.ts — MSW handlers implementing §C6.6 for every endpoint the UI calls.
// Backs both `VITE_USE_MOCKS=1 npm run dev:web` (web/mocks/browser.ts) and component tests
// (web/mocks/server.ts). Fixtures live in ./fixtures.ts, typed against shared/types.ts.
import { http, HttpResponse } from "msw";
import type {
  ApiErrorBody,
  AttentionItem,
  ComplianceItemView,
  DashboardPayload,
  ErrorCode,
  Invite,
  LeaseView,
  Notification,
  NoteView,
  Page,
  PmTemplate,
  PropertyCard,
  PropertyDossier,
  PropertyExpense,
  PropertyView,
  ProjectLine,
  ProjectView,
  RentEntry,
  SearchHit,
  SessionInfo,
  SpecEntryView,
  Tenant,
  TimelineEvent,
  TurnoverItem,
  TurnoverView,
  Unit,
  Upload,
  User,
  Vendor,
  WorkOrderCommentView,
  WorkOrderView,
} from "../../shared/types";
import * as fx from "./fixtures";

/* ------------------------------------------------------------------- helpers */

function ok<T>(data: T, status = 200) {
  return HttpResponse.json({ ok: true, data }, { status });
}

function err(code: ErrorCode, message: string, status: number, extra?: Partial<ApiErrorBody>) {
  const body: ApiErrorBody = { code, message, requestId: `req_mock_${Date.now()}`, ...extra };
  return HttpResponse.json({ ok: false, error: body }, { status });
}

function page<T>(items: T[], limit = 50): Page<T> {
  return { items: items.slice(0, limit), nextCursor: null, total: items.length };
}

function checkVersion(current: { version: number }, body: Record<string, unknown>): boolean {
  const expected = body["expectedVersion"];
  return typeof expected === "number" && expected === current.version;
}

const SESSION: SessionInfo = {
  user: fx.users[0]!,
  csrfToken: "mock-csrf-token",
  expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString(),
  serverTime: new Date().toISOString(),
  timezone: "America/New_York",
};

function propertyCard(p: PropertyView): PropertyCard {
  return {
    id: p.id,
    name: p.name,
    addressLine1: p.addressLine1,
    city: p.city,
    state: p.state,
    status: p.status,
    coverUrl: p.coverUrl,
    quickFacts: p.quickFacts,
    attentionCount: fx.attentionItems.filter((a) => a.propertyId === p.id).length,
  };
}

function dossierFor(propertyId: string): PropertyDossier | null {
  const property = fx.properties.find((p) => p.id === propertyId);
  if (!property) return null;
  return {
    property,
    notes: fx.notes.filter((n) => n.propertyId === propertyId),
    workOrders: fx.workOrders.filter((w) => w.propertyId === propertyId),
    pmTemplates: fx.pmTemplates.filter((t) => t.propertyId === propertyId),
    projects: fx.projects.filter((p) => p.propertyId === propertyId),
    tenants: fx.tenants.filter((t) => t.propertyId === propertyId),
    leases: fx.leases.filter((l) => l.propertyId === propertyId),
    rentEntries: fx.rentEntries.filter((r) => r.propertyId === propertyId),
    expenses: fx.expenses.filter((e) => e.propertyId === propertyId),
    money: moneySummaryFor(propertyId),
    specs: fx.specs.filter((s) => s.propertyId === propertyId),
    compliance: fx.compliance.filter((c) => c.propertyId === propertyId),
    turnovers: fx.turnovers.filter((t) => t.propertyId === propertyId),
    vendors: fx.vendors,
    attachments: fx.uploads.filter((u) => u.propertyId === propertyId),
    attention: fx.attentionItems.filter((a) => a.propertyId === propertyId),
    generatedAt: new Date().toISOString(),
  };
}

function moneySummaryFor(propertyId: string) {
  const rents = fx.rentEntries.filter((r) => r.propertyId === propertyId);
  const exps = fx.expenses.filter((e) => e.propertyId === propertyId);
  const rentDue = rents.reduce((s, r) => s + r.amountDueCents, 0);
  const rentReceived = rents.reduce((s, r) => s + r.amountReceivedCents, 0);
  const expenseCents = exps.reduce((s, e) => s + e.amountCents, 0);
  const byCategory = Object.entries(
    exps.reduce<Record<string, number>>((acc, e) => {
      acc[e.category] = (acc[e.category] ?? 0) + e.amountCents;
      return acc;
    }, {}),
  ).map(([category, amountCents]) => ({ category: category as PropertyExpense["category"], amountCents }));
  return {
    propertyId,
    period: { from: new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) },
    rentDueCents: rentDue,
    rentReceivedCents: rentReceived,
    rentOutstandingCents: rentDue - rentReceived,
    expenseCents,
    netCents: rentReceived - expenseCents,
    byCategory,
    byMonth: [],
  };
}

/* ----------------------------------------------------------------------- T1 */

const authHandlers = [
  http.get("/api/setup/status", () => ok({ needsSetup: false })),

  http.post("/api/setup/bootstrap", () =>
    err("SETUP_ALREADY_DONE", "Setup has already completed.", 409),
  ),

  http.post("/api/auth/login", async ({ request }) => {
    const body = (await request.json()) as { email?: string; password?: string };
    const user = fx.users.find((u) => u.email === body.email);
    if (!user) return err("FORBIDDEN", "Incorrect email or password.", 403);
    return ok({ mfaToken: "mock-mfa-token", expiresAt: new Date(Date.now() + 600000).toISOString() });
  }),

  http.post("/api/auth/login/totp", async ({ request }) => {
    const body = (await request.json()) as { code?: string };
    if (body.code !== "123456") return err("FORBIDDEN", "Incorrect code.", 403);
    return ok(SESSION);
  }),

  http.post("/api/auth/login/recovery", async ({ request }) => {
    const body = (await request.json()) as { recoveryCode?: string };
    if (!body.recoveryCode) return err("FORBIDDEN", "Incorrect recovery code.", 403);
    return ok(SESSION);
  }),

  http.post("/api/auth/logout", () => ok({ ok: true })),

  http.get("/api/auth/me", () => ok(SESSION)),

  http.post("/api/auth/password", () => ok({ ok: true })),

  http.post("/api/auth/recovery-codes/regenerate", () =>
    ok({ codes: Array.from({ length: 10 }, (_, i) => `abcde-${String(i).padStart(5, "0")}`), generatedAt: new Date().toISOString() }),
  ),

  http.get("/api/invites", () => ok(page<Invite>(fx.invites))),

  http.post("/api/invites", async ({ request }) => {
    const body = (await request.json()) as { email: string; role: Invite["role"] };
    const invite: Invite = {
      id: fx.genId("inv"),
      email: body.email,
      role: body.role,
      createdBy: fx.CURRENT_USER_ID,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 72 * 3600000).toISOString(),
      acceptedAt: null,
      acceptedUserId: null,
      revokedAt: null,
      inviteUrl: `${location.origin}/invite/mock-token-${Date.now()}`,
    };
    fx.invites.unshift(invite);
    return ok(invite, 201);
  }),

  http.delete("/api/invites/:id", ({ params }) => {
    const idx = fx.invites.findIndex((i) => i.id === params.id);
    if (idx === -1) return err("NOT_FOUND", "Invite not found.", 404);
    fx.invites.splice(idx, 1);
    return ok({ id: params.id as string, deleted: true });
  }),

  http.get("/api/invites/:token/preview", () =>
    ok({ email: "newmanager@keyring.example", role: "manager" as const, valid: true, expiresAt: new Date(Date.now() + 3600000).toISOString() }),
  ),

  http.post("/api/invites/:token/accept", () =>
    ok({
      userId: fx.genId("usr"),
      mfaToken: "mock-mfa-token",
      enrollment: { secret: "MOCKSECRET234", otpauthUrl: "otpauth://totp/Keyring:new@keyring.example?secret=MOCKSECRET234&issuer=Keyring" },
    }),
  ),

  http.post("/api/invites/accept/verify", () =>
    ok({ session: SESSION, codes: undefined, recovery: { codes: Array.from({ length: 10 }, (_, i) => `abcde-${String(i).padStart(5, "0")}`), generatedAt: new Date().toISOString() } }),
  ),

  http.get("/api/users", () => ok(page<User>(fx.users))),

  http.patch("/api/users/:id", async ({ params, request }) => {
    const user = fx.users.find((u) => u.id === params.id);
    if (!user) return err("NOT_FOUND", "User not found.", 404);
    const body = (await request.json()) as Record<string, unknown>;
    Object.assign(user, body, { version: user.version + 1, updatedAt: new Date().toISOString() });
    return ok(user);
  }),

  http.post("/api/users/:id/totp/reset", () => ok({ ok: true })),

  http.patch("/api/users/me", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    Object.assign(fx.users[0]!, body, { version: fx.users[0]!.version + 1, updatedAt: new Date().toISOString() });
    return ok(fx.users[0]!);
  }),

  http.get("/api/audit", () => ok(page(fx.auditEntries))),
];

/* ----------------------------------------------------------------------- T2 */

const realtimeHandlers = [
  http.get("/api/notifications", ({ request }) => {
    const url = new URL(request.url);
    const unreadOnly = url.searchParams.get("unreadOnly") === "true";
    const items = unreadOnly ? fx.notifications.filter((n) => !n.readAt) : fx.notifications;
    return ok(page<Notification>(items));
  }),

  http.get("/api/notifications/unread-count", () =>
    ok({ unread: fx.notifications.filter((n) => !n.readAt).length }),
  ),

  http.post("/api/notifications/:id/read", ({ params }) => {
    const n = fx.notifications.find((x) => x.id === params.id);
    if (!n) return err("NOT_FOUND", "Notification not found.", 404);
    n.readAt = new Date().toISOString();
    return ok(n);
  }),

  http.post("/api/notifications/read-all", () => {
    let marked = 0;
    for (const n of fx.notifications) {
      if (!n.readAt) {
        n.readAt = new Date().toISOString();
        marked += 1;
      }
    }
    return ok({ marked });
  }),

  http.delete("/api/notifications/:id", ({ params }) => {
    const idx = fx.notifications.findIndex((n) => n.id === params.id);
    if (idx === -1) return err("NOT_FOUND", "Notification not found.", 404);
    fx.notifications.splice(idx, 1);
    return ok({ id: params.id as string, deleted: true });
  }),

  http.get("/api/presence", () => ok({ channels: [] })),
];

/* ----------------------------------------------------------------------- T3 */

const aggregateHandlers = [
  http.get("/api/dashboard", () => {
    const payload: DashboardPayload = {
      properties: fx.properties.map(propertyCard),
      needsAttention: fx.attentionItems,
      totals: {
        properties: fx.properties.length,
        units: fx.units.length,
        occupied: fx.units.filter((u) => u.status === "occupied").length,
        vacant: fx.units.filter((u) => u.status === "vacant").length,
        openWorkOrders: fx.workOrders.filter((w) => w.status !== "done" && w.status !== "cancelled").length,
        monthlyRentCents: fx.properties.reduce((s, p) => s + p.quickFacts.monthlyRentCents, 0),
        rentCollectedThisMonthCents: fx.rentEntries.reduce((s, r) => s + r.amountReceivedCents, 0),
      },
      generatedAt: new Date().toISOString(),
    };
    return ok(payload);
  }),

  http.get("/api/properties/:propertyId/dossier", ({ params }) => {
    const dossier = dossierFor(params.propertyId as string);
    if (!dossier) return err("NOT_FOUND", "Property not found.", 404);
    return ok(dossier);
  }),

  http.get("/api/properties/:propertyId/timeline", ({ params }) => {
    const items: TimelineEvent[] = fx.auditEntries
      .filter((a) => a.propertyId === params.propertyId)
      .map((a) => ({ id: a.id, at: a.at, actor: a.actor, actorLabel: a.actorLabel, action: a.action, entityType: a.entityType, entityId: a.entityId, summary: a.summary, url: null }));
    return ok(page(items));
  }),

  http.get("/api/search", ({ request }) => {
    const q = new URL(request.url).searchParams.get("q")?.toLowerCase().trim() ?? "";
    const hits: SearchHit[] = [];
    if (q) {
      for (const n of fx.notes) {
        if (n.body.toLowerCase().includes(q) || n.title?.toLowerCase().includes(q)) {
          const p = fx.properties.find((pr) => pr.id === n.propertyId);
          hits.push({
            entityType: "note",
            entityId: n.id,
            propertyId: n.propertyId,
            propertyName: p?.name ?? null,
            title: n.title ?? n.body.slice(0, 60),
            snippet: n.body.replace(new RegExp(q, "i"), (m) => `<mark>${m}</mark>`),
            url: `/p/${n.propertyId}/notes`,
            updatedAt: n.updatedAt,
            rank: 1,
          });
        }
      }
      for (const w of fx.workOrders) {
        if (w.title.toLowerCase().includes(q)) {
          hits.push({
            entityType: "work_order",
            entityId: w.id,
            propertyId: w.propertyId,
            propertyName: w.propertyName,
            title: w.title,
            snippet: w.title.replace(new RegExp(q, "i"), (m) => `<mark>${m}</mark>`),
            url: `/p/${w.propertyId}/maintenance?wo=${w.id}`,
            updatedAt: w.updatedAt,
            rank: 1,
          });
        }
      }
    }
    return ok(page(hits));
  }),

  http.get("/api/attention", ({ request }) => {
    const propertyId = new URL(request.url).searchParams.get("propertyId");
    const items = propertyId ? fx.attentionItems.filter((a) => a.propertyId === propertyId) : fx.attentionItems;
    return ok(page<AttentionItem>(items));
  }),

  http.get("/api/properties", ({ request }) => {
    const includeArchived = new URL(request.url).searchParams.get("includeArchived") === "true";
    const items = includeArchived ? fx.properties : fx.properties.filter((p) => !p.archivedAt);
    return ok(page<PropertyView>(items));
  }),

  http.post("/api/properties", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const now = new Date().toISOString();
    const created: PropertyView = {
      id: fx.genId("prp"),
      name: String(body["name"] ?? "New property"),
      addressLine1: String(body["addressLine1"] ?? ""),
      addressLine2: (body["addressLine2"] as string | null) ?? null,
      city: String(body["city"] ?? ""),
      state: String(body["state"] ?? ""),
      postalCode: String(body["postalCode"] ?? ""),
      country: String(body["country"] ?? "US"),
      propertyType: (body["propertyType"] as PropertyView["propertyType"]) ?? "single_family",
      yearBuilt: (body["yearBuilt"] as number | null) ?? null,
      sqft: (body["sqft"] as number | null) ?? null,
      lotSqft: (body["lotSqft"] as number | null) ?? null,
      parcelNumber: (body["parcelNumber"] as string | null) ?? null,
      purchaseDate: (body["purchaseDate"] as string | null) ?? null,
      purchasePriceCents: (body["purchasePriceCents"] as number | null) ?? null,
      mortgageLender: (body["mortgageLender"] as string | null) ?? null,
      mortgagePaymentCents: (body["mortgagePaymentCents"] as number | null) ?? null,
      insuranceCarrier: (body["insuranceCarrier"] as string | null) ?? null,
      insurancePolicyNumber: (body["insurancePolicyNumber"] as string | null) ?? null,
      coverUploadId: null,
      notes: (body["notes"] as string | null) ?? null,
      sortOrder: fx.properties.length,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
      createdBy: fx.CURRENT_USER_ID,
      updatedBy: fx.CURRENT_USER_ID,
      version: 1,
      units: [],
      quickFacts: {
        unitCount: 0, occupiedUnits: 0, vacantUnits: 0, monthlyRentCents: 0, openWorkOrders: 0, urgentWorkOrders: 0,
        overdueWorkOrders: 0, activeProjects: 0, nextLeaseExpiry: null, nextComplianceDue: null, ytdExpenseCents: 0,
        ytdRentReceivedCents: 0, lastActivityAt: null,
      },
      status: "stable",
      coverUrl: null,
    };
    fx.properties.push(created);
    return ok(created, 201);
  }),

  http.get("/api/properties/:propertyId", ({ params }) => {
    const p = fx.properties.find((x) => x.id === params.propertyId);
    if (!p) return err("NOT_FOUND", "Property not found.", 404);
    return ok(p);
  }),

  http.patch("/api/properties/:propertyId", async ({ params, request }) => {
    const p = fx.properties.find((x) => x.id === params.propertyId);
    if (!p) return err("NOT_FOUND", "Property not found.", 404);
    const body = (await request.json()) as Record<string, unknown>;
    if (!checkVersion(p, body)) return err("VERSION_CONFLICT", "This property was changed by someone else.", 409, { current: p });
    Object.assign(p, body, { version: p.version + 1, updatedAt: new Date().toISOString(), updatedBy: fx.CURRENT_USER_ID });
    delete (p as unknown as Record<string, unknown>)["expectedVersion"];
    return ok(p);
  }),

  http.get("/api/properties/:propertyId/units", ({ params }) => ok(page<Unit>(fx.units.filter((u) => u.propertyId === params.propertyId)))),

  http.post("/api/properties/:propertyId/units", async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const now = new Date().toISOString();
    const unit: Unit = {
      id: fx.genId("unt"),
      propertyId: params.propertyId as string,
      label: String(body["label"] ?? "New unit"),
      bedrooms: (body["bedrooms"] as number | null) ?? null,
      bathrooms: (body["bathrooms"] as number | null) ?? null,
      sqft: (body["sqft"] as number | null) ?? null,
      floor: (body["floor"] as string | null) ?? null,
      marketRentCents: (body["marketRentCents"] as number | null) ?? null,
      status: (body["status"] as Unit["status"]) ?? "vacant",
      notes: (body["notes"] as string | null) ?? null,
      sortOrder: fx.units.length,
      createdAt: now,
      updatedAt: now,
      createdBy: fx.CURRENT_USER_ID,
      updatedBy: fx.CURRENT_USER_ID,
      version: 1,
    };
    fx.units.push(unit);
    return ok(unit, 201);
  }),

  http.patch("/api/units/:id", async ({ params, request }) => {
    const u = fx.units.find((x) => x.id === params.id);
    if (!u) return err("NOT_FOUND", "Unit not found.", 404);
    const body = (await request.json()) as Record<string, unknown>;
    if (!checkVersion(u, body)) return err("VERSION_CONFLICT", "This unit was changed by someone else.", 409, { current: u });
    Object.assign(u, body, { version: u.version + 1, updatedAt: new Date().toISOString(), updatedBy: fx.CURRENT_USER_ID });
    return ok(u);
  }),

  http.delete("/api/units/:id", ({ params }) => {
    const idx = fx.units.findIndex((u) => u.id === params.id);
    if (idx === -1) return err("NOT_FOUND", "Unit not found.", 404);
    fx.units.splice(idx, 1);
    return ok({ id: params.id as string, deleted: true });
  }),
];

/* ------------------------------------------------------------------ notes */

const noteHandlers = [
  http.get("/api/properties/:propertyId/notes", ({ params }) => ok(page<NoteView>(fx.notes.filter((n) => n.propertyId === params.propertyId)))),

  http.post("/api/properties/:propertyId/notes", async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const now = new Date().toISOString();
    const note: NoteView = {
      id: fx.genId("not"),
      propertyId: params.propertyId as string,
      unitId: (body["unitId"] as string | null) ?? null,
      title: (body["title"] as string | null) ?? null,
      body: String(body["body"] ?? ""),
      pinned: Boolean(body["pinned"]),
      createdAt: now,
      updatedAt: now,
      createdBy: fx.CURRENT_USER_ID,
      updatedBy: fx.CURRENT_USER_ID,
      version: 1,
      author: fx.userRef(fx.CURRENT_USER_ID),
      lastEditor: fx.userRef(fx.CURRENT_USER_ID),
      attachments: [],
    };
    fx.notes.unshift(note);
    return ok(note, 201);
  }),

  http.patch("/api/notes/:id", async ({ params, request }) => {
    const n = fx.notes.find((x) => x.id === params.id);
    if (!n) return err("NOT_FOUND", "Note not found.", 404);
    const body = (await request.json()) as Record<string, unknown>;
    if (!checkVersion(n, body)) return err("VERSION_CONFLICT", "This note was changed by someone else while you were editing.", 409, { current: n });
    Object.assign(n, body, { version: n.version + 1, updatedAt: new Date().toISOString(), updatedBy: fx.CURRENT_USER_ID, lastEditor: fx.userRef(fx.CURRENT_USER_ID) });
    return ok(n);
  }),

  http.delete("/api/notes/:id", ({ params }) => {
    const idx = fx.notes.findIndex((n) => n.id === params.id);
    if (idx === -1) return err("NOT_FOUND", "Note not found.", 404);
    fx.notes.splice(idx, 1);
    return ok({ id: params.id as string, deleted: true });
  }),
];

/* ------------------------------------------------------------ work orders */

const workOrderHandlers = [
  http.get("/api/work-orders", ({ request }) => {
    const url = new URL(request.url);
    const propertyId = url.searchParams.get("propertyId");
    let items = fx.workOrders;
    if (propertyId) items = items.filter((w) => w.propertyId === propertyId);
    return ok(page<WorkOrderView>(items));
  }),

  http.post("/api/properties/:propertyId/work-orders", async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const now = new Date().toISOString();
    const propertyId = params.propertyId as string;
    const property = fx.properties.find((p) => p.id === propertyId);
    const number = fx.workOrders.filter((w) => w.propertyId === propertyId).length + 1;
    const unit = fx.units.find((u) => u.id === body["unitId"]);
    const wo: WorkOrderView = {
      id: fx.genId("wo"),
      propertyId,
      unitId: (body["unitId"] as string | null) ?? null,
      number,
      title: String(body["title"] ?? "New work order"),
      description: (body["description"] as string | null) ?? null,
      status: "new",
      priority: (body["priority"] as WorkOrderView["priority"]) ?? "normal",
      assigneeId: (body["assigneeId"] as string | null) ?? null,
      vendorId: (body["vendorId"] as string | null) ?? null,
      dueDate: (body["dueDate"] as string | null) ?? null,
      scheduledFor: (body["scheduledFor"] as string | null) ?? null,
      completedAt: null,
      estimateCents: (body["estimateCents"] as number | null) ?? null,
      costCents: (body["costCents"] as number | null) ?? null,
      source: "manual",
      pmTemplateId: null,
      createdAt: now,
      updatedAt: now,
      createdBy: fx.CURRENT_USER_ID,
      updatedBy: fx.CURRENT_USER_ID,
      version: 1,
      unitLabel: unit?.label ?? null,
      propertyName: property?.name ?? "",
      assignee: body["assigneeId"] ? fx.userRef(body["assigneeId"] as string) : null,
      vendor: fx.vendors.find((v) => v.id === body["vendorId"]) ?? null,
      commentCount: 0,
      attachments: [],
      isOverdue: false,
    };
    fx.workOrders.unshift(wo);
    return ok(wo, 201);
  }),

  http.get("/api/work-orders/:id", ({ params }) => {
    const w = fx.workOrders.find((x) => x.id === params.id);
    if (!w) return err("NOT_FOUND", "Work order not found.", 404);
    return ok(w);
  }),

  http.patch("/api/work-orders/:id", async ({ params, request }) => {
    const w = fx.workOrders.find((x) => x.id === params.id);
    if (!w) return err("NOT_FOUND", "Work order not found.", 404);
    const body = (await request.json()) as Record<string, unknown>;
    if (!checkVersion(w, body)) return err("VERSION_CONFLICT", "This work order was changed by someone else.", 409, { current: w });
    if (body["status"] === "done") body["completedAt"] = new Date().toISOString();
    if (body["status"] && body["status"] !== "done") body["completedAt"] = null;
    if (body["assigneeId"] !== undefined) (body as Record<string, unknown>)["assignee"] = body["assigneeId"] ? fx.userRef(body["assigneeId"] as string) : null;
    if (body["vendorId"] !== undefined) (body as Record<string, unknown>)["vendor"] = fx.vendors.find((v) => v.id === body["vendorId"]) ?? null;
    Object.assign(w, body, { version: w.version + 1, updatedAt: new Date().toISOString(), updatedBy: fx.CURRENT_USER_ID });
    return ok(w);
  }),

  http.delete("/api/work-orders/:id", ({ params }) => {
    const idx = fx.workOrders.findIndex((w) => w.id === params.id);
    if (idx === -1) return err("NOT_FOUND", "Work order not found.", 404);
    fx.workOrders.splice(idx, 1);
    return ok({ id: params.id as string, deleted: true });
  }),

  http.get("/api/work-orders/:id/comments", ({ params }) => ok(page<WorkOrderCommentView>(fx.workOrderComments.filter((c) => c.workOrderId === params.id)))),

  http.post("/api/work-orders/:id/comments", async ({ params, request }) => {
    const body = (await request.json()) as { body: string };
    const now = new Date().toISOString();
    const comment: WorkOrderCommentView = {
      id: fx.genId("woc"),
      workOrderId: params.id as string,
      body: body.body,
      createdAt: now,
      updatedAt: now,
      createdBy: fx.CURRENT_USER_ID,
      updatedBy: fx.CURRENT_USER_ID,
      version: 1,
      author: fx.userRef(fx.CURRENT_USER_ID),
      attachments: [],
    };
    fx.workOrderComments.push(comment);
    const wo = fx.workOrders.find((w) => w.id === params.id);
    if (wo) wo.commentCount += 1;
    return ok(comment, 201);
  }),

  http.get("/api/properties/:propertyId/pm-templates", ({ params }) => ok(page<PmTemplate>(fx.pmTemplates.filter((t) => t.propertyId === params.propertyId)))),

  http.post("/api/properties/:propertyId/pm-templates", async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const now = new Date().toISOString();
    const tpl: PmTemplate = {
      id: fx.genId("pmt"),
      propertyId: params.propertyId as string,
      unitId: (body["unitId"] as string | null) ?? null,
      title: String(body["title"] ?? "New PM template"),
      description: (body["description"] as string | null) ?? null,
      priority: (body["priority"] as PmTemplate["priority"]) ?? "normal",
      assigneeId: (body["assigneeId"] as string | null) ?? null,
      vendorId: (body["vendorId"] as string | null) ?? null,
      frequency: (body["frequency"] as PmTemplate["frequency"]) ?? "annual",
      intervalDays: (body["intervalDays"] as number | null) ?? null,
      anchorDate: String(body["anchorDate"] ?? now.slice(0, 10)),
      leadDays: (body["leadDays"] as number) ?? 7,
      nextDueDate: String(body["anchorDate"] ?? now.slice(0, 10)),
      lastGeneratedDate: null,
      active: true,
      createdAt: now,
      updatedAt: now,
      createdBy: fx.CURRENT_USER_ID,
      updatedBy: fx.CURRENT_USER_ID,
      version: 1,
    };
    fx.pmTemplates.push(tpl);
    return ok(tpl, 201);
  }),

  http.patch("/api/pm-templates/:id", async ({ params, request }) => {
    const t = fx.pmTemplates.find((x) => x.id === params.id);
    if (!t) return err("NOT_FOUND", "PM template not found.", 404);
    const body = (await request.json()) as Record<string, unknown>;
    if (!checkVersion(t, body)) return err("VERSION_CONFLICT", "This template was changed by someone else.", 409, { current: t });
    Object.assign(t, body, { version: t.version + 1, updatedAt: new Date().toISOString(), updatedBy: fx.CURRENT_USER_ID });
    return ok(t);
  }),

  http.delete("/api/pm-templates/:id", ({ params }) => {
    const idx = fx.pmTemplates.findIndex((t) => t.id === params.id);
    if (idx === -1) return err("NOT_FOUND", "Template not found.", 404);
    fx.pmTemplates.splice(idx, 1);
    return ok({ id: params.id as string, deleted: true });
  }),

  http.post("/api/pm-templates/:id/generate", () => ok({ workOrder: null, skipped: true })),
];

/* --------------------------------------------------------------- projects */

const projectHandlers = [
  http.get("/api/properties/:propertyId/projects", ({ params }) => ok(page<ProjectView>(fx.projects.filter((p) => p.propertyId === params.propertyId)))),

  http.post("/api/properties/:propertyId/projects", async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const now = new Date().toISOString();
    const proj: ProjectView = {
      id: fx.genId("prj"),
      propertyId: params.propertyId as string,
      title: String(body["title"] ?? "New project"),
      description: (body["description"] as string | null) ?? null,
      status: (body["status"] as ProjectView["status"]) ?? "idea",
      priority: (body["priority"] as ProjectView["priority"]) ?? "normal",
      ownerId: (body["ownerId"] as string | null) ?? null,
      targetStart: (body["targetStart"] as string | null) ?? null,
      targetEnd: (body["targetEnd"] as string | null) ?? null,
      actualStart: null,
      actualEnd: null,
      budgetCents: (body["budgetCents"] as number | null) ?? null,
      createdAt: now,
      updatedAt: now,
      createdBy: fx.CURRENT_USER_ID,
      updatedBy: fx.CURRENT_USER_ID,
      version: 1,
      owner: body["ownerId"] ? fx.userRef(body["ownerId"] as string) : null,
      lines: [],
      budgetTotalCents: (body["budgetCents"] as number | null) ?? 0,
      actualTotalCents: 0,
      varianceCents: (body["budgetCents"] as number | null) ?? 0,
      attachments: [],
    };
    fx.projects.unshift(proj);
    return ok(proj, 201);
  }),

  http.get("/api/projects/:id", ({ params }) => {
    const p = fx.projects.find((x) => x.id === params.id);
    if (!p) return err("NOT_FOUND", "Project not found.", 404);
    return ok(p);
  }),

  http.patch("/api/projects/:id", async ({ params, request }) => {
    const p = fx.projects.find((x) => x.id === params.id);
    if (!p) return err("NOT_FOUND", "Project not found.", 404);
    const body = (await request.json()) as Record<string, unknown>;
    if (!checkVersion(p, body)) return err("VERSION_CONFLICT", "This project was changed by someone else.", 409, { current: p });
    Object.assign(p, body, { version: p.version + 1, updatedAt: new Date().toISOString(), updatedBy: fx.CURRENT_USER_ID });
    return ok(p);
  }),

  http.delete("/api/projects/:id", ({ params }) => {
    const idx = fx.projects.findIndex((p) => p.id === params.id);
    if (idx === -1) return err("NOT_FOUND", "Project not found.", 404);
    fx.projects.splice(idx, 1);
    return ok({ id: params.id as string, deleted: true });
  }),

  http.post("/api/projects/:id/lines", async ({ params, request }) => {
    const proj = fx.projects.find((p) => p.id === params.id);
    if (!proj) return err("NOT_FOUND", "Project not found.", 404);
    const body = (await request.json()) as Record<string, unknown>;
    const now = new Date().toISOString();
    const line: ProjectLine = {
      id: fx.genId("pln"),
      projectId: proj.id,
      kind: (body["kind"] as ProjectLine["kind"]) ?? "expense",
      label: String(body["label"] ?? ""),
      category: (body["category"] as ProjectLine["category"]) ?? null,
      amountCents: Number(body["amountCents"] ?? 0),
      incurredOn: (body["incurredOn"] as string | null) ?? null,
      vendorId: (body["vendorId"] as string | null) ?? null,
      note: (body["note"] as string | null) ?? null,
      createdAt: now,
      updatedAt: now,
      createdBy: fx.CURRENT_USER_ID,
      updatedBy: fx.CURRENT_USER_ID,
      version: 1,
    };
    proj.lines.push(line);
    proj.budgetTotalCents = proj.lines.filter((l) => l.kind === "budget").reduce((s, l) => s + l.amountCents, 0);
    proj.actualTotalCents = proj.lines.filter((l) => l.kind === "expense").reduce((s, l) => s + l.amountCents, 0);
    proj.varianceCents = proj.budgetTotalCents - proj.actualTotalCents;
    return ok(line, 201);
  }),

  http.patch("/api/project-lines/:id", async ({ params, request }) => {
    for (const proj of fx.projects) {
      const line = proj.lines.find((l) => l.id === params.id);
      if (line) {
        const body = (await request.json()) as Record<string, unknown>;
        if (!checkVersion(line, body)) return err("VERSION_CONFLICT", "This line was changed by someone else.", 409, { current: line });
        Object.assign(line, body, { version: line.version + 1, updatedAt: new Date().toISOString(), updatedBy: fx.CURRENT_USER_ID });
        proj.budgetTotalCents = proj.lines.filter((l) => l.kind === "budget").reduce((s, l) => s + l.amountCents, 0);
        proj.actualTotalCents = proj.lines.filter((l) => l.kind === "expense").reduce((s, l) => s + l.amountCents, 0);
        proj.varianceCents = proj.budgetTotalCents - proj.actualTotalCents;
        return ok(line);
      }
    }
    return err("NOT_FOUND", "Project line not found.", 404);
  }),

  http.delete("/api/project-lines/:id", ({ params }) => {
    for (const proj of fx.projects) {
      const idx = proj.lines.findIndex((l) => l.id === params.id);
      if (idx !== -1) {
        proj.lines.splice(idx, 1);
        return ok({ id: params.id as string, deleted: true });
      }
    }
    return err("NOT_FOUND", "Project line not found.", 404);
  }),
];

/* ---------------------------------------------------------- tenants/leases */

const tenantHandlers = [
  http.get("/api/properties/:propertyId/tenants", ({ params }) => ok(page<Tenant>(fx.tenants.filter((t) => t.propertyId === params.propertyId)))),

  http.post("/api/properties/:propertyId/tenants", async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const now = new Date().toISOString();
    const tenant: Tenant = {
      id: fx.genId("ten"),
      propertyId: params.propertyId as string,
      unitId: (body["unitId"] as string | null) ?? null,
      firstName: String(body["firstName"] ?? ""),
      lastName: String(body["lastName"] ?? ""),
      email: (body["email"] as string | null) ?? null,
      phone: (body["phone"] as string | null) ?? null,
      emergencyContactName: (body["emergencyContactName"] as string | null) ?? null,
      emergencyContactPhone: (body["emergencyContactPhone"] as string | null) ?? null,
      notes: (body["notes"] as string | null) ?? null,
      isPrimary: Boolean(body["isPrimary"]),
      movedInAt: (body["movedInAt"] as string | null) ?? null,
      movedOutAt: null,
      createdAt: now,
      updatedAt: now,
      createdBy: fx.CURRENT_USER_ID,
      updatedBy: fx.CURRENT_USER_ID,
      version: 1,
    };
    fx.tenants.push(tenant);
    return ok(tenant, 201);
  }),

  http.patch("/api/tenants/:id", async ({ params, request }) => {
    const t = fx.tenants.find((x) => x.id === params.id);
    if (!t) return err("NOT_FOUND", "Tenant not found.", 404);
    const body = (await request.json()) as Record<string, unknown>;
    if (!checkVersion(t, body)) return err("VERSION_CONFLICT", "This tenant was changed by someone else.", 409, { current: t });
    Object.assign(t, body, { version: t.version + 1, updatedAt: new Date().toISOString(), updatedBy: fx.CURRENT_USER_ID });
    return ok(t);
  }),

  http.delete("/api/tenants/:id", ({ params }) => {
    const idx = fx.tenants.findIndex((t) => t.id === params.id);
    if (idx === -1) return err("NOT_FOUND", "Tenant not found.", 404);
    fx.tenants.splice(idx, 1);
    return ok({ id: params.id as string, deleted: true });
  }),

  http.get("/api/properties/:propertyId/leases", ({ params }) => ok(page<LeaseView>(fx.leases.filter((l) => l.propertyId === params.propertyId)))),

  http.post("/api/properties/:propertyId/leases", async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const now = new Date().toISOString();
    const unit = fx.units.find((u) => u.id === body["unitId"]);
    const tenantIds = (body["tenantIds"] as string[] | undefined) ?? [];
    const lease: LeaseView = {
      id: fx.genId("lse"),
      propertyId: params.propertyId as string,
      unitId: String(body["unitId"] ?? ""),
      startDate: String(body["startDate"] ?? now.slice(0, 10)),
      endDate: (body["endDate"] as string | null) ?? null,
      rentCents: Number(body["rentCents"] ?? 0),
      depositCents: Number(body["depositCents"] ?? 0),
      dueDay: Number(body["dueDay"] ?? 1),
      status: (body["status"] as LeaseView["status"]) ?? "active",
      renewalNoticeDays: Number(body["renewalNoticeDays"] ?? 60),
      documentUploadId: null,
      notes: (body["notes"] as string | null) ?? null,
      createdAt: now,
      updatedAt: now,
      createdBy: fx.CURRENT_USER_ID,
      updatedBy: fx.CURRENT_USER_ID,
      version: 1,
      unitLabel: unit?.label ?? "",
      tenants: fx.tenants.filter((t) => tenantIds.includes(t.id)),
      daysUntilExpiry: null,
      attachments: [],
    };
    fx.leases.push(lease);
    if (unit && lease.status === "active") unit.status = "occupied";
    return ok(lease, 201);
  }),

  http.get("/api/leases/:id", ({ params }) => {
    const l = fx.leases.find((x) => x.id === params.id);
    if (!l) return err("NOT_FOUND", "Lease not found.", 404);
    return ok(l);
  }),

  http.patch("/api/leases/:id", async ({ params, request }) => {
    const l = fx.leases.find((x) => x.id === params.id);
    if (!l) return err("NOT_FOUND", "Lease not found.", 404);
    const body = (await request.json()) as Record<string, unknown>;
    if (!checkVersion(l, body)) return err("VERSION_CONFLICT", "This lease was changed by someone else.", 409, { current: l });
    Object.assign(l, body, { version: l.version + 1, updatedAt: new Date().toISOString(), updatedBy: fx.CURRENT_USER_ID });
    return ok(l);
  }),

  http.delete("/api/leases/:id", ({ params }) => {
    const idx = fx.leases.findIndex((l) => l.id === params.id);
    if (idx === -1) return err("NOT_FOUND", "Lease not found.", 404);
    fx.leases.splice(idx, 1);
    return ok({ id: params.id as string, deleted: true });
  }),
];

/* --------------------------------------------------------------------- money */

const moneyHandlers = [
  http.get("/api/properties/:propertyId/rent", ({ params }) => ok(page<RentEntry>(fx.rentEntries.filter((r) => r.propertyId === params.propertyId)))),

  http.post("/api/properties/:propertyId/rent", async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const now = new Date().toISOString();
    const entry: RentEntry = {
      id: fx.genId("rnt"),
      propertyId: params.propertyId as string,
      unitId: String(body["unitId"] ?? ""),
      leaseId: (body["leaseId"] as string | null) ?? null,
      period: String(body["period"] ?? now.slice(0, 7)),
      amountDueCents: Number(body["amountDueCents"] ?? 0),
      amountReceivedCents: Number(body["amountReceivedCents"] ?? 0),
      receivedOn: (body["receivedOn"] as string | null) ?? null,
      method: (body["method"] as string | null) ?? null,
      status: (body["status"] as RentEntry["status"]) ?? "unpaid",
      note: (body["note"] as string | null) ?? null,
      createdAt: now,
      updatedAt: now,
      createdBy: fx.CURRENT_USER_ID,
      updatedBy: fx.CURRENT_USER_ID,
      version: 1,
    };
    fx.rentEntries.push(entry);
    return ok(entry, 201);
  }),

  http.patch("/api/rent/:id", async ({ params, request }) => {
    const r = fx.rentEntries.find((x) => x.id === params.id);
    if (!r) return err("NOT_FOUND", "Rent entry not found.", 404);
    const body = (await request.json()) as Record<string, unknown>;
    if (!checkVersion(r, body)) return err("VERSION_CONFLICT", "This rent entry was changed by someone else.", 409, { current: r });
    Object.assign(r, body, { version: r.version + 1, updatedAt: new Date().toISOString(), updatedBy: fx.CURRENT_USER_ID });
    if (typeof body["amountReceivedCents"] === "number" && body["status"] === undefined) {
      r.status = r.amountReceivedCents >= r.amountDueCents ? "paid" : r.amountReceivedCents > 0 ? "partial" : "unpaid";
    }
    return ok(r);
  }),

  http.delete("/api/rent/:id", ({ params }) => {
    const idx = fx.rentEntries.findIndex((r) => r.id === params.id);
    if (idx === -1) return err("NOT_FOUND", "Rent entry not found.", 404);
    fx.rentEntries.splice(idx, 1);
    return ok({ id: params.id as string, deleted: true });
  }),

  http.post("/api/properties/:propertyId/rent/generate", () => ok(page<RentEntry>(fx.rentEntries.filter((r) => r.propertyId)))),

  http.get("/api/properties/:propertyId/expenses", ({ params }) => ok(page<PropertyExpense>(fx.expenses.filter((e) => e.propertyId === params.propertyId)))),

  http.post("/api/properties/:propertyId/expenses", async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const now = new Date().toISOString();
    const expense: PropertyExpense = {
      id: fx.genId("exp"),
      propertyId: params.propertyId as string,
      unitId: (body["unitId"] as string | null) ?? null,
      category: (body["category"] as PropertyExpense["category"]) ?? "other",
      description: String(body["description"] ?? ""),
      amountCents: Number(body["amountCents"] ?? 0),
      incurredOn: String(body["incurredOn"] ?? now.slice(0, 10)),
      vendorId: (body["vendorId"] as string | null) ?? null,
      workOrderId: (body["workOrderId"] as string | null) ?? null,
      projectId: (body["projectId"] as string | null) ?? null,
      note: (body["note"] as string | null) ?? null,
      createdAt: now,
      updatedAt: now,
      createdBy: fx.CURRENT_USER_ID,
      updatedBy: fx.CURRENT_USER_ID,
      version: 1,
    };
    fx.expenses.unshift(expense);
    return ok(expense, 201);
  }),

  http.patch("/api/expenses/:id", async ({ params, request }) => {
    const e = fx.expenses.find((x) => x.id === params.id);
    if (!e) return err("NOT_FOUND", "Expense not found.", 404);
    const body = (await request.json()) as Record<string, unknown>;
    if (!checkVersion(e, body)) return err("VERSION_CONFLICT", "This expense was changed by someone else.", 409, { current: e });
    Object.assign(e, body, { version: e.version + 1, updatedAt: new Date().toISOString(), updatedBy: fx.CURRENT_USER_ID });
    return ok(e);
  }),

  http.delete("/api/expenses/:id", ({ params }) => {
    const idx = fx.expenses.findIndex((e) => e.id === params.id);
    if (idx === -1) return err("NOT_FOUND", "Expense not found.", 404);
    fx.expenses.splice(idx, 1);
    return ok({ id: params.id as string, deleted: true });
  }),

  http.get("/api/properties/:propertyId/money/summary", ({ params }) => ok(moneySummaryFor(params.propertyId as string))),
];

/* ------------------------------------------------------------------ vendors */

const vendorHandlers = [
  http.get("/api/vendors", ({ request }) => {
    const url = new URL(request.url);
    const q = url.searchParams.get("q")?.toLowerCase();
    let items = fx.vendors.filter((v) => !v.archivedAt);
    if (q) items = items.filter((v) => v.name.toLowerCase().includes(q));
    return ok(page<Vendor>(items));
  }),

  http.post("/api/vendors", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const now = new Date().toISOString();
    const vendor: Vendor = {
      id: fx.genId("ven"),
      name: String(body["name"] ?? ""),
      company: (body["company"] as string | null) ?? null,
      trade: String(body["trade"] ?? ""),
      phone: (body["phone"] as string | null) ?? null,
      email: (body["email"] as string | null) ?? null,
      website: (body["website"] as string | null) ?? null,
      address: (body["address"] as string | null) ?? null,
      notes: (body["notes"] as string | null) ?? null,
      rating: (body["rating"] as number | null) ?? null,
      preferred: Boolean(body["preferred"]),
      licenseNumber: (body["licenseNumber"] as string | null) ?? null,
      insuranceExpiresOn: (body["insuranceExpiresOn"] as string | null) ?? null,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
      createdBy: fx.CURRENT_USER_ID,
      updatedBy: fx.CURRENT_USER_ID,
      version: 1,
    };
    fx.vendors.push(vendor);
    return ok(vendor, 201);
  }),

  http.get("/api/vendors/:id", ({ params }) => {
    const v = fx.vendors.find((x) => x.id === params.id);
    if (!v) return err("NOT_FOUND", "Vendor not found.", 404);
    return ok(v);
  }),

  http.patch("/api/vendors/:id", async ({ params, request }) => {
    const v = fx.vendors.find((x) => x.id === params.id);
    if (!v) return err("NOT_FOUND", "Vendor not found.", 404);
    const body = (await request.json()) as Record<string, unknown>;
    if (!checkVersion(v, body)) return err("VERSION_CONFLICT", "This vendor was changed by someone else.", 409, { current: v });
    Object.assign(v, body, { version: v.version + 1, updatedAt: new Date().toISOString(), updatedBy: fx.CURRENT_USER_ID });
    return ok(v);
  }),

  http.delete("/api/vendors/:id", ({ params }) => {
    const idx = fx.vendors.findIndex((v) => v.id === params.id);
    if (idx === -1) return err("NOT_FOUND", "Vendor not found.", 404);
    fx.vendors.splice(idx, 1);
    return ok({ id: params.id as string, deleted: true });
  }),
];

/* --------------------------------------------------------------- spec vault */

const specHandlers = [
  http.get("/api/properties/:propertyId/specs", ({ params }) => ok(page<SpecEntryView>(fx.specs.filter((s) => s.propertyId === params.propertyId)))),

  http.post("/api/properties/:propertyId/specs", async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const now = new Date().toISOString();
    const isSecret = Boolean(body["isSecret"]);
    const spec: SpecEntryView = {
      id: fx.genId("spc"),
      propertyId: params.propertyId as string,
      unitId: (body["unitId"] as string | null) ?? null,
      category: (body["category"] as SpecEntryView["category"]) ?? "other",
      label: String(body["label"] ?? ""),
      make: (body["make"] as string | null) ?? null,
      model: (body["model"] as string | null) ?? null,
      serial: (body["serial"] as string | null) ?? null,
      value: isSecret ? null : ((body["value"] as string | null) ?? null),
      valueMasked: isSecret,
      location: (body["location"] as string | null) ?? null,
      isSecret,
      installedOn: (body["installedOn"] as string | null) ?? null,
      warrantyExpiresOn: (body["warrantyExpiresOn"] as string | null) ?? null,
      vendorId: (body["vendorId"] as string | null) ?? null,
      notes: (body["notes"] as string | null) ?? null,
      createdAt: now,
      updatedAt: now,
      createdBy: fx.CURRENT_USER_ID,
      updatedBy: fx.CURRENT_USER_ID,
      version: 1,
      attachments: [],
    };
    fx.specs.push(spec);
    return ok(spec, 201);
  }),

  http.patch("/api/specs/:id", async ({ params, request }) => {
    const s = fx.specs.find((x) => x.id === params.id);
    if (!s) return err("NOT_FOUND", "Spec entry not found.", 404);
    const body = (await request.json()) as Record<string, unknown>;
    if (!checkVersion(s, body)) return err("VERSION_CONFLICT", "This entry was changed by someone else.", 409, { current: s });
    Object.assign(s, body, { version: s.version + 1, updatedAt: new Date().toISOString(), updatedBy: fx.CURRENT_USER_ID });
    return ok(s);
  }),

  http.delete("/api/specs/:id", ({ params }) => {
    const idx = fx.specs.findIndex((s) => s.id === params.id);
    if (idx === -1) return err("NOT_FOUND", "Spec entry not found.", 404);
    fx.specs.splice(idx, 1);
    return ok({ id: params.id as string, deleted: true });
  }),

  http.post("/api/specs/:id/reveal", ({ params }) => {
    const s = fx.specs.find((x) => x.id === params.id);
    if (!s) return err("NOT_FOUND", "Spec entry not found.", 404);
    const value = fx.revealSecret(params.id as string) ?? "(no value set)";
    return ok({ id: s.id, value });
  }),
];

/* --------------------------------------------------------------- compliance */

const complianceHandlers = [
  http.get("/api/properties/:propertyId/compliance", ({ params }) => ok(page<ComplianceItemView>(fx.compliance.filter((c) => c.propertyId === params.propertyId)))),

  http.post("/api/properties/:propertyId/compliance", async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const now = new Date().toISOString();
    const item: ComplianceItemView = {
      id: fx.genId("cmp"),
      propertyId: params.propertyId as string,
      unitId: (body["unitId"] as string | null) ?? null,
      kind: (body["kind"] as ComplianceItemView["kind"]) ?? "other",
      title: String(body["title"] ?? ""),
      authority: (body["authority"] as string | null) ?? null,
      reference: (body["reference"] as string | null) ?? null,
      dueDate: String(body["dueDate"] ?? now.slice(0, 10)),
      leadDays: Number(body["leadDays"] ?? 14),
      recurrence: (body["recurrence"] as ComplianceItemView["recurrence"]) ?? "none",
      state: "open",
      completedOn: null,
      costCents: (body["costCents"] as number | null) ?? null,
      vendorId: (body["vendorId"] as string | null) ?? null,
      notes: (body["notes"] as string | null) ?? null,
      createdAt: now,
      updatedAt: now,
      createdBy: fx.CURRENT_USER_ID,
      updatedBy: fx.CURRENT_USER_ID,
      version: 1,
      status: "ok",
      daysOut: Math.round((new Date(String(body["dueDate"])).getTime() - Date.now()) / 86400000),
      attachments: [],
    };
    fx.compliance.push(item);
    return ok(item, 201);
  }),

  http.patch("/api/compliance/:id", async ({ params, request }) => {
    const c = fx.compliance.find((x) => x.id === params.id);
    if (!c) return err("NOT_FOUND", "Compliance item not found.", 404);
    const body = (await request.json()) as Record<string, unknown>;
    if (!checkVersion(c, body)) return err("VERSION_CONFLICT", "This item was changed by someone else.", 409, { current: c });
    Object.assign(c, body, { version: c.version + 1, updatedAt: new Date().toISOString(), updatedBy: fx.CURRENT_USER_ID });
    return ok(c);
  }),

  http.delete("/api/compliance/:id", ({ params }) => {
    const idx = fx.compliance.findIndex((c) => c.id === params.id);
    if (idx === -1) return err("NOT_FOUND", "Compliance item not found.", 404);
    fx.compliance.splice(idx, 1);
    return ok({ id: params.id as string, deleted: true });
  }),

  http.post("/api/compliance/:id/complete", async ({ params, request }) => {
    const c = fx.compliance.find((x) => x.id === params.id);
    if (!c) return err("NOT_FOUND", "Compliance item not found.", 404);
    const body = (await request.json()) as Record<string, unknown>;
    if (!checkVersion(c, body)) return err("VERSION_CONFLICT", "This item was changed by someone else.", 409, { current: c });
    c.state = "done";
    c.status = "done";
    c.completedOn = String(body["completedOn"] ?? new Date().toISOString().slice(0, 10));
    c.version += 1;
    c.updatedAt = new Date().toISOString();
    return ok(c);
  }),
];

/* ----------------------------------------------------------------- turnover */

const turnoverHandlers = [
  http.get("/api/properties/:propertyId/turnovers", ({ params }) => ok(page<TurnoverView>(fx.turnovers.filter((t) => t.propertyId === params.propertyId)))),

  http.post("/api/properties/:propertyId/turnovers", async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const now = new Date().toISOString();
    const unit = fx.units.find((u) => u.id === body["unitId"]);
    const defaultItems: TurnoverItem[] = [
      "Final walkthrough", "Deep clean", "Paint touch-up", "Replace filters",
    ].map((label, i) => ({
      id: fx.genId("tri"), turnoverId: "", phase: "make_ready" as const, label, done: false, doneAt: null, doneBy: null,
      costCents: null, note: null, workOrderId: null, sortOrder: i, createdAt: now, updatedAt: now,
      createdBy: fx.CURRENT_USER_ID, updatedBy: fx.CURRENT_USER_ID, version: 1,
    }));
    const turnover: TurnoverView = {
      id: fx.genId("trn"),
      propertyId: params.propertyId as string,
      unitId: String(body["unitId"] ?? ""),
      phase: "move_out",
      moveOutDate: (body["moveOutDate"] as string | null) ?? null,
      targetReadyDate: (body["targetReadyDate"] as string | null) ?? null,
      moveInDate: null,
      outgoingLeaseId: (body["outgoingLeaseId"] as string | null) ?? null,
      incomingLeaseId: null,
      depositHeldCents: Number(body["depositHeldCents"] ?? 0),
      depositWithheldCents: 0,
      depositReturnedCents: 0,
      depositReturnedOn: null,
      depositNotes: null,
      conditionNotes: (body["conditionNotes"] as string | null) ?? null,
      closedAt: null,
      createdAt: now,
      updatedAt: now,
      createdBy: fx.CURRENT_USER_ID,
      updatedBy: fx.CURRENT_USER_ID,
      version: 1,
      unitLabel: unit?.label ?? "",
      items: defaultItems.map((it) => ({ ...it })),
      progress: { done: 0, total: defaultItems.length },
      attachments: [],
    };
    for (const it of turnover.items) it.turnoverId = turnover.id;
    fx.turnovers.push(turnover);
    return ok(turnover, 201);
  }),

  http.get("/api/turnovers/:id", ({ params }) => {
    const t = fx.turnovers.find((x) => x.id === params.id);
    if (!t) return err("NOT_FOUND", "Turnover not found.", 404);
    return ok(t);
  }),

  http.patch("/api/turnovers/:id", async ({ params, request }) => {
    const t = fx.turnovers.find((x) => x.id === params.id);
    if (!t) return err("NOT_FOUND", "Turnover not found.", 404);
    const body = (await request.json()) as Record<string, unknown>;
    if (!checkVersion(t, body)) return err("VERSION_CONFLICT", "This turnover was changed by someone else.", 409, { current: t });
    Object.assign(t, body, { version: t.version + 1, updatedAt: new Date().toISOString(), updatedBy: fx.CURRENT_USER_ID });
    return ok(t);
  }),

  http.delete("/api/turnovers/:id", ({ params }) => {
    const idx = fx.turnovers.findIndex((t) => t.id === params.id);
    if (idx === -1) return err("NOT_FOUND", "Turnover not found.", 404);
    fx.turnovers.splice(idx, 1);
    return ok({ id: params.id as string, deleted: true });
  }),

  http.post("/api/turnovers/:id/items", async ({ params, request }) => {
    const t = fx.turnovers.find((x) => x.id === params.id);
    if (!t) return err("NOT_FOUND", "Turnover not found.", 404);
    const body = (await request.json()) as Record<string, unknown>;
    const now = new Date().toISOString();
    const item: TurnoverItem = {
      id: fx.genId("tri"),
      turnoverId: t.id,
      phase: (body["phase"] as TurnoverItem["phase"]) ?? "make_ready",
      label: String(body["label"] ?? ""),
      done: false,
      doneAt: null,
      doneBy: null,
      costCents: (body["costCents"] as number | null) ?? null,
      note: (body["note"] as string | null) ?? null,
      workOrderId: (body["workOrderId"] as string | null) ?? null,
      sortOrder: t.items.length,
      createdAt: now,
      updatedAt: now,
      createdBy: fx.CURRENT_USER_ID,
      updatedBy: fx.CURRENT_USER_ID,
      version: 1,
    };
    t.items.push(item);
    t.progress = { done: t.items.filter((i) => i.done).length, total: t.items.length };
    return ok(item, 201);
  }),

  http.patch("/api/turnover-items/:id", async ({ params, request }) => {
    for (const t of fx.turnovers) {
      const item = t.items.find((i) => i.id === params.id);
      if (item) {
        const body = (await request.json()) as Record<string, unknown>;
        if (!checkVersion(item, body)) return err("VERSION_CONFLICT", "This item was changed by someone else.", 409, { current: item });
        if (body["done"] === true) {
          body["doneAt"] = new Date().toISOString();
          body["doneBy"] = fx.CURRENT_USER_ID;
        } else if (body["done"] === false) {
          body["doneAt"] = null;
          body["doneBy"] = null;
        }
        Object.assign(item, body, { version: item.version + 1, updatedAt: new Date().toISOString(), updatedBy: fx.CURRENT_USER_ID });
        t.progress = { done: t.items.filter((i) => i.done).length, total: t.items.length };
        return ok(item);
      }
    }
    return err("NOT_FOUND", "Turnover item not found.", 404);
  }),

  http.delete("/api/turnover-items/:id", ({ params }) => {
    for (const t of fx.turnovers) {
      const idx = t.items.findIndex((i) => i.id === params.id);
      if (idx !== -1) {
        t.items.splice(idx, 1);
        t.progress = { done: t.items.filter((i) => i.done).length, total: t.items.length };
        return ok({ id: params.id as string, deleted: true });
      }
    }
    return err("NOT_FOUND", "Turnover item not found.", 404);
  }),
];

/* ------------------------------------------------------------------ uploads */

const uploadHandlers = [
  http.post("/api/uploads", async ({ request }) => {
    const form = await request.formData();
    const file = form.get("file") as File | null;
    const parentType = String(form.get("parentType") ?? "property") as Upload["parentType"];
    const parentId = String(form.get("parentId") ?? "");
    const now = new Date().toISOString();
    const upload: Upload = {
      id: fx.genId("upl"),
      parentType,
      parentId,
      propertyId: fx.properties.find((p) => p.id === parentId)?.id ?? null,
      filename: file?.name ?? "upload.jpg",
      mime: file?.type ?? "image/jpeg",
      kind: file?.type === "application/pdf" ? "pdf" : "image",
      sizeBytes: file?.size ?? 0,
      width: null,
      height: null,
      hasThumb: file?.type !== "application/pdf",
      caption: (form.get("caption") as string | null) ?? null,
      uploadedBy: fx.CURRENT_USER_ID,
      createdAt: now,
      url: `/api/uploads/mock/raw`,
      thumbUrl: file?.type === "application/pdf" ? null : `/api/uploads/mock/thumb`,
    };
    fx.uploads.push(upload);
    return ok(upload, 201);
  }),

  http.get("/api/uploads", ({ request }) => {
    const url = new URL(request.url);
    const parentType = url.searchParams.get("parentType");
    const parentId = url.searchParams.get("parentId");
    const propertyId = url.searchParams.get("propertyId");
    let items = fx.uploads;
    if (parentType && parentId) items = items.filter((u) => u.parentType === parentType && u.parentId === parentId);
    if (propertyId) items = items.filter((u) => u.propertyId === propertyId);
    return ok(page<Upload>(items));
  }),

  http.get("/api/uploads/:id", ({ params }) => {
    const u = fx.uploads.find((x) => x.id === params.id);
    if (!u) return err("NOT_FOUND", "Upload not found.", 404);
    return ok(u);
  }),

  http.patch("/api/uploads/:id", async ({ params, request }) => {
    const u = fx.uploads.find((x) => x.id === params.id);
    if (!u) return err("NOT_FOUND", "Upload not found.", 404);
    const body = (await request.json()) as { caption?: string | null };
    u.caption = body.caption ?? null;
    return ok(u);
  }),

  http.delete("/api/uploads/:id", ({ params }) => {
    const idx = fx.uploads.findIndex((u) => u.id === params.id);
    if (idx === -1) return err("NOT_FOUND", "Upload not found.", 404);
    fx.uploads.splice(idx, 1);
    return ok({ id: params.id as string, deleted: true });
  }),
];

/* -------------------------------------------------------------------- ops */

const opsHandlers = [
  http.get("/healthz", () =>
    HttpResponse.json({ status: "ok", version: "1.0.0-mock", uptimeSeconds: 3600, dbOk: true, migrations: 4, time: new Date().toISOString() }),
  ),

  http.get("/api/ops/info", () =>
    ok({
      version: "1.0.0-mock",
      nodeVersion: "24.x",
      dbPath: "./data/keyring.db",
      dbSizeBytes: 4_200_000,
      walSizeBytes: 120_000,
      journalMode: "wal",
      uploadCount: fx.uploads.length,
      uploadBytes: 0,
      backupDir: "./data/backups",
      lastBackup: null,
      scheduledBackupAt: "03:15",
      retentionDays: 14,
      uptimeSeconds: 3600,
    }),
  ),

  http.get("/api/ops/backups", () => ok(page([]))),
  http.post("/api/ops/backups", () =>
    ok({ id: fx.genId("bkp"), kind: "manual" as const, status: "running" as const, startedAt: new Date().toISOString(), finishedAt: null, archiveName: null, sizeBytes: null, sha256: null, dbBytes: null, uploadsBytes: null, fileCount: null, retentionDeleted: 0, error: null }),
  ),
];

export const handlers = [
  ...authHandlers,
  ...realtimeHandlers,
  ...aggregateHandlers,
  ...noteHandlers,
  ...workOrderHandlers,
  ...projectHandlers,
  ...tenantHandlers,
  ...moneyHandlers,
  ...vendorHandlers,
  ...specHandlers,
  ...complianceHandlers,
  ...turnoverHandlers,
  ...uploadHandlers,
  ...opsHandlers,
];
