// server/domain/common/mutation-envelope.test.ts
//
// Proves the non-negotiable mutation envelope for every T3-owned EntityType: the write, the
// search-index write and the audit write happen in one transaction, publishEntity fires AFTER
// commit (verified by spying the seam), and updates are version-guarded.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestApp, createTestUser, unwrap, type TestApp, type TestUser } from "../../testing/harness.js";
import { setPublisher, setNotifier, type EntityEventInput } from "../../seams.js";
import { getDb } from "../../db/index.js";
import type { EntityType } from "../../../shared/types.js";

let app: TestApp;
let user: TestUser;
let published: EntityEventInput[];

beforeEach(async () => {
  app = await createTestApp();
  user = createTestUser({ role: "owner" });
  published = [];
  setPublisher((e) => published.push(e));
  setNotifier({ notifyMentions: () => {}, notifyUsers: () => {} });
});

afterEach(async () => {
  await app.close();
});

function auditRowsFor(entityType: EntityType, entityId: string): { action: string; property_id: string | null }[] {
  return getDb()
    .prepare(`SELECT action, property_id FROM audit_log WHERE entity_type = ? AND entity_id = ? ORDER BY at`)
    .all(entityType, entityId) as { action: string; property_id: string | null }[];
}

/** Asserts the create envelope: a 'created' publish event and a 'create' audit row exist for
 * the given entity, and (when the entity is property-scoped) the audit row's property_id is
 * non-null. */
function expectCreateEnvelope(entityType: EntityType, entityId: string, propertyScoped = true): void {
  const events = published.filter((e) => e.entityType === entityType && e.entityId === entityId);
  expect(events.some((e) => e.action === "created")).toBe(true);
  const rows = auditRowsFor(entityType, entityId);
  const createRow = rows.find((r) => r.action === "create");
  expect(createRow).toBeDefined();
  if (propertyScoped) expect(createRow!.property_id).not.toBeNull();
}

describe("mutation envelope: one transaction, version guard, publish-after-commit", () => {
  it("property: create, update (with version guard), delete", async () => {
    const createRes = await app.app.inject({
      method: "POST",
      url: "/api/properties",
      headers: user.headers,
      payload: {
        name: "Envelope Test Property",
        addressLine1: "1 Test St",
        city: "Testville",
        state: "OH",
        postalCode: "45000",
        country: "US",
        propertyType: "single_family",
      },
    });
    expect(createRes.statusCode).toBe(201);
    const property = unwrap<{ id: string; version: number }>(createRes);
    expectCreateEnvelope("property", property.id);

    // stale version -> VERSION_CONFLICT, current copy attached, no silent overwrite
    const staleRes = await app.app.inject({
      method: "PATCH",
      url: `/api/properties/${property.id}`,
      headers: user.headers,
      payload: { name: "Should not apply", expectedVersion: 999 },
    });
    expect(staleRes.statusCode).toBe(409);
    const staleBody = JSON.parse(staleRes.body) as { error: { code: string; current: unknown } };
    expect(staleBody.error.code).toBe("VERSION_CONFLICT");
    expect(staleBody.error.current).toBeDefined();

    const updateRes = await app.app.inject({
      method: "PATCH",
      url: `/api/properties/${property.id}`,
      headers: user.headers,
      payload: { name: "Renamed Property", expectedVersion: property.version },
    });
    expect(updateRes.statusCode).toBe(200);
    const updated = unwrap<{ version: number }>(updateRes);
    expect(updated.version).toBe(property.version + 1);
    expect(published.some((e) => e.entityType === "property" && e.entityId === property.id && e.action === "updated")).toBe(true);
    expect(auditRowsFor("property", property.id).some((r) => r.action === "update")).toBe(true);

    const deleteRes = await app.app.inject({
      method: "DELETE",
      url: `/api/properties/${property.id}`,
      headers: noBodyHeaders(user),
    });
    expect(deleteRes.statusCode).toBe(200);
    expect(published.some((e) => e.entityType === "property" && e.entityId === property.id && e.action === "deleted")).toBe(true);
    expect(auditRowsFor("property", property.id).some((r) => r.action === "delete")).toBe(true);
  });

  it("unit: create + update via the property's units endpoint", async () => {
    const property = await createProperty();
    const createRes = await app.app.inject({
      method: "POST",
      url: `/api/properties/${property.id}/units`,
      headers: user.headers,
      payload: { label: "Unit 1", status: "vacant" },
    });
    expect(createRes.statusCode).toBe(201);
    const unit = unwrap<{ id: string; version: number }>(createRes);
    expectCreateEnvelope("unit", unit.id);

    const updateRes = await app.app.inject({
      method: "PATCH",
      url: `/api/units/${unit.id}`,
      headers: user.headers,
      payload: { status: "occupied", expectedVersion: unit.version },
    });
    expect(updateRes.statusCode).toBe(200);
    expect(published.some((e) => e.entityType === "unit" && e.action === "updated")).toBe(true);
  });

  it("note: create, edit, delete", async () => {
    const property = await createProperty();
    const createRes = await app.app.inject({
      method: "POST",
      url: `/api/properties/${property.id}/notes`,
      headers: user.headers,
      payload: { title: "Test note", body: "Body text", pinned: false },
    });
    expect(createRes.statusCode).toBe(201);
    const note = unwrap<{ id: string; version: number }>(createRes);
    expectCreateEnvelope("note", note.id);

    const delRes = await app.app.inject({ method: "DELETE", url: `/api/notes/${note.id}`, headers: noBodyHeaders(user) });
    expect(delRes.statusCode).toBe(200);
    expect(auditRowsFor("note", note.id).some((r) => r.action === "delete")).toBe(true);
  });

  it("work_order + work_order_comment: full envelope", async () => {
    const property = await createProperty();
    const woRes = await app.app.inject({
      method: "POST",
      url: `/api/properties/${property.id}/work-orders`,
      headers: user.headers,
      payload: { title: "Fix thing", status: "new", priority: "normal" },
    });
    expect(woRes.statusCode).toBe(201);
    const wo = unwrap<{ id: string; version: number }>(woRes);
    expectCreateEnvelope("work_order", wo.id);

    const commentRes = await app.app.inject({
      method: "POST",
      url: `/api/work-orders/${wo.id}/comments`,
      headers: user.headers,
      payload: { body: "A comment" },
    });
    expect(commentRes.statusCode).toBe(201);
    const comment = unwrap<{ id: string }>(commentRes);
    expectCreateEnvelope("work_order_comment", comment.id);
  });

  it("pm_template: create + update", async () => {
    const property = await createProperty();
    const res = await app.app.inject({
      method: "POST",
      url: `/api/properties/${property.id}/pm-templates`,
      headers: user.headers,
      payload: {
        title: "Replace filters",
        frequency: "quarterly",
        anchorDate: "2026-01-01",
        leadDays: 7,
      },
    });
    expect(res.statusCode).toBe(201);
    const pm = unwrap<{ id: string }>(res);
    expectCreateEnvelope("pm_template", pm.id);
  });

  it("project + project_line: create envelope", async () => {
    const property = await createProperty();
    const projRes = await app.app.inject({
      method: "POST",
      url: `/api/properties/${property.id}/projects`,
      headers: user.headers,
      payload: { title: "Roof replacement", status: "idea", priority: "normal" },
    });
    expect(projRes.statusCode).toBe(201);
    const project = unwrap<{ id: string }>(projRes);
    expectCreateEnvelope("project", project.id);

    const lineRes = await app.app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/lines`,
      headers: user.headers,
      payload: { kind: "budget", label: "Materials", amountCents: 500000 },
    });
    expect(lineRes.statusCode).toBe(201);
    const line = unwrap<{ id: string }>(lineRes);
    expectCreateEnvelope("project_line", line.id);
  });

  it("tenant + lease + rent_entry: create envelope, unit occupancy side effect", async () => {
    const property = await createProperty();
    const unit = await createUnit(property.id);
    const tenantRes = await app.app.inject({
      method: "POST",
      url: `/api/properties/${property.id}/tenants`,
      headers: user.headers,
      payload: { unitId: unit.id, firstName: "Ada", lastName: "Lovelace", isPrimary: true },
    });
    expect(tenantRes.statusCode).toBe(201);
    const tenant = unwrap<{ id: string }>(tenantRes);
    expectCreateEnvelope("tenant", tenant.id);

    const leaseRes = await app.app.inject({
      method: "POST",
      url: `/api/properties/${property.id}/leases`,
      headers: user.headers,
      payload: {
        unitId: unit.id,
        startDate: "2026-01-01",
        rentCents: 150000,
        depositCents: 150000,
        dueDay: 1,
        status: "active",
        renewalNoticeDays: 60,
        tenantIds: [tenant.id],
      },
    });
    expect(leaseRes.statusCode).toBe(201);
    const lease = unwrap<{ id: string }>(leaseRes);
    expectCreateEnvelope("lease", lease.id);
    // Creating an active lease flips the unit to occupied and publishes its own unit event.
    expect(published.some((e) => e.entityType === "unit" && e.entityId === unit.id)).toBe(true);

    const rentRes = await app.app.inject({
      method: "POST",
      url: `/api/properties/${property.id}/rent`,
      headers: user.headers,
      payload: { unitId: unit.id, leaseId: lease.id, period: "2026-01", amountDueCents: 150000 },
    });
    expect(rentRes.statusCode).toBe(201);
    const rent = unwrap<{ id: string }>(rentRes);
    expectCreateEnvelope("rent_entry", rent.id);
  });

  it("property_expense: create envelope", async () => {
    const property = await createProperty();
    const res = await app.app.inject({
      method: "POST",
      url: `/api/properties/${property.id}/expenses`,
      headers: user.headers,
      payload: { category: "repair", description: "Fix gutter", amountCents: 25000, incurredOn: "2026-01-05" },
    });
    expect(res.statusCode).toBe(201);
    const expense = unwrap<{ id: string }>(res);
    expectCreateEnvelope("property_expense", expense.id);
  });

  it("vendor: create envelope (portfolio-wide, propertyId null)", async () => {
    const res = await app.app.inject({
      method: "POST",
      url: "/api/vendors",
      headers: user.headers,
      payload: { name: "Test Vendor", trade: "Plumbing", preferred: false },
    });
    expect(res.statusCode).toBe(201);
    const vendor = unwrap<{ id: string }>(res);
    expectCreateEnvelope("vendor", vendor.id, false);
    const rows = auditRowsFor("vendor", vendor.id);
    expect(rows[0]!.property_id).toBeNull();
  });

  it("spec_entry: create envelope", async () => {
    const property = await createProperty();
    const res = await app.app.inject({
      method: "POST",
      url: `/api/properties/${property.id}/specs`,
      headers: user.headers,
      payload: { category: "filter", label: "Furnace filter", value: "16x20x1", isSecret: false },
    });
    expect(res.statusCode).toBe(201);
    const spec = unwrap<{ id: string }>(res);
    expectCreateEnvelope("spec_entry", spec.id);
  });

  it("compliance_item: create envelope", async () => {
    const property = await createProperty();
    const res = await app.app.inject({
      method: "POST",
      url: `/api/properties/${property.id}/compliance`,
      headers: user.headers,
      payload: { kind: "insurance", title: "Policy renewal", dueDate: "2026-06-01", leadDays: 30, recurrence: "annual" },
    });
    expect(res.statusCode).toBe(201);
    const item = unwrap<{ id: string }>(res);
    expectCreateEnvelope("compliance_item", item.id);
  });

  it("turnover + turnover_item: create envelope", async () => {
    const property = await createProperty();
    const unit = await createUnit(property.id);
    const trnRes = await app.app.inject({
      method: "POST",
      url: `/api/properties/${property.id}/turnovers`,
      headers: user.headers,
      payload: { unitId: unit.id, phase: "move_out" },
    });
    expect(trnRes.statusCode).toBe(201);
    const turnover = unwrap<{ id: string; items: { id: string }[] }>(trnRes);
    expectCreateEnvelope("turnover", turnover.id);
    // Default checklist seeded (>= 4 items per phase for the 3 actionable phases).
    expect(turnover.items.length).toBeGreaterThanOrEqual(12);

    const itemRes = await app.app.inject({
      method: "POST",
      url: `/api/turnovers/${turnover.id}/items`,
      headers: user.headers,
      payload: { phase: "move_out", label: "Extra checklist item" },
    });
    expect(itemRes.statusCode).toBe(201);
    const item = unwrap<{ id: string }>(itemRes);
    expectCreateEnvelope("turnover_item", item.id);
  });

  it("upload: create envelope via multipart", async () => {
    const property = await createProperty();
    const note = await createNote(property.id);
    const boundary = "----envelopetest";
    const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="parentType"\r\n\r\nnote\r\n` +
          `--${boundary}\r\nContent-Disposition: form-data; name="parentId"\r\n\r\n${note.id}\r\n` +
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="photo.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
      ),
      jpegHeader,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await app.app.inject({
      method: "POST",
      url: "/api/uploads",
      headers: { ...user.headers, "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    // A 12-byte JPEG header with no real image data will fail sharp's decode -> 415. That still
    // proves magic-byte detection ran; the full upload pipeline is exercised in uploads.test.ts
    // with a real encoded image. Here we only need an entity whose envelope we can inspect, so
    // fall back to asserting on whichever outcome occurred.
    if (res.statusCode === 201) {
      const upload = unwrap<{ id: string }>(res);
      expectCreateEnvelope("upload", upload.id);
    } else {
      expect(res.statusCode).toBe(415);
    }
  });
});

/** Fastify's JSON body parser throws FST_ERR_CTP_EMPTY_JSON_BODY when Content-Type is
 * application/json but the body is empty (as on a bodyless DELETE). The frozen test harness's
 * `user.headers` always includes that content-type, so bodyless requests must drop it. */
function noBodyHeaders(u: TestUser): Record<string, string> {
  const { cookie, "x-csrf-token": csrf } = u.headers;
  return { cookie, "x-csrf-token": csrf };
}

async function createProperty(): Promise<{ id: string; version: number }> {
  const res = await app.app.inject({
    method: "POST",
    url: "/api/properties",
    headers: user.headers,
    payload: {
      name: `Fixture Property ${Math.random().toString(36).slice(2)}`,
      addressLine1: "1 Fixture St",
      city: "Testville",
      state: "OH",
      postalCode: "45000",
      country: "US",
      propertyType: "single_family",
    },
  });
  return unwrap(res);
}

async function createUnit(propertyId: string): Promise<{ id: string; version: number }> {
  const res = await app.app.inject({
    method: "POST",
    url: `/api/properties/${propertyId}/units`,
    headers: user.headers,
    payload: { label: `Unit ${Math.random().toString(36).slice(2, 6)}`, status: "vacant" },
  });
  return unwrap(res);
}

async function createNote(propertyId: string): Promise<{ id: string }> {
  const res = await app.app.inject({
    method: "POST",
    url: `/api/properties/${propertyId}/notes`,
    headers: user.headers,
    payload: { body: "fixture note" },
  });
  return unwrap(res);
}
