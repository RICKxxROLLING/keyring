// server/realtime/version-conflict.integration.test.ts
//
// Proves the no-lost-writes reconciliation described in design.md §C8.7: a stale
// `expectedVersion` PATCH returns VERSION_CONFLICT carrying the server's current copy, and a
// second (subscribed) client receives the realtime broadcast for the write that won.
//
// This genuinely requires T3's domain module (POST/PATCH /api/properties) to be present — see
// §C13: "Anything that genuinely requires two workstreams ... is an integration test ...
// written by the workstream that owns the consumer side (T2 for that example), guarded to skip
// when registerDomain is a stub." In this worktree `server/domain/register.ts` is the Category B
// stub (it mounts no routes), so this test detects that and no-ops. It will exercise real
// behavior once T3's domain module is merged in.
//
// The exact request body below matches `CreateInput<Property>` as printed in shared/types.ts
// (§C4) at the time this was written; if T3's actual Zod schema treats any of these fields as
// optional/defaulted differently, this test may need a small adjustment post-merge — that risk
// is inherent to writing against a not-yet-integrated sibling workstream.

import { describe, it, expect, afterEach } from "vitest";
import { createTestApp, createTestUser, unwrap, type TestApp } from "../testing/harness.js";
import { openSocket, startWsServer, wrapClient, type WsTestClient } from "./test-helpers.js";
import { RT_PROTOCOL_VERSION, propertyChannel } from "../../shared/realtime.js";
import type { PropertyView } from "../../shared/types.js";

const ORIGIN = "http://localhost:8080";

async function connect(url: string, cookie: string, csrf: string): Promise<WsTestClient> {
  const ws = await openSocket(url, { cookie, origin: ORIGIN });
  const client = wrapClient(ws);
  client.send({ t: "hello", v: RT_PROTOCOL_VERSION, csrf });
  await client.waitFor((m) => m.t === "ready");
  return client;
}

describe("version-conflict reconciliation (T2 <- T3 integration)", () => {
  let testApp: TestApp;

  afterEach(async () => {
    if (testApp) await testApp.close();
  });

  it("stale PATCH -> VERSION_CONFLICT with current; subscribed client sees the winning write", async () => {
    testApp = await createTestApp();
    const alice = createTestUser({ handle: "vcalice" });
    const bob = createTestUser({ handle: "vcbob" });

    // Cheap, side-effect-free probe: a GET never needs a request body, so a 404 here reliably
    // means registerDomain has mounted no routes (the stub), not a validation failure.
    const probe = await testApp.app.inject({
      method: "GET",
      url: "/api/properties",
      headers: alice.headers,
    });
    if (probe.statusCode === 404) {
      console.warn(
        "[version-conflict.integration] server/domain/register.ts is the Category B stub in " +
          "this worktree; skipping. This test exercises real behavior once T3's domain module " +
          "is merged in.",
      );
      return;
    }

    const createRes = await testApp.app.inject({
      method: "POST",
      url: "/api/properties",
      headers: alice.headers,
      payload: {
        name: "Test Property",
        addressLine1: "123 Main St",
        addressLine2: null,
        city: "Springfield",
        state: "NY",
        postalCode: "10001",
        country: "US",
        propertyType: "single_family",
        yearBuilt: null,
        sqft: null,
        lotSqft: null,
        parcelNumber: null,
        purchaseDate: null,
        purchasePriceCents: null,
        mortgageLender: null,
        mortgagePaymentCents: null,
        insuranceCarrier: null,
        insurancePolicyNumber: null,
        coverUploadId: null,
        notes: null,
        sortOrder: 0,
        archivedAt: null,
      },
    });
    const created = unwrap<PropertyView>({ statusCode: createRes.statusCode, body: createRes.body });

    const url = await startWsServer(testApp.app);
    const bobClient = await connect(url, bob.headers.cookie, bob.csrfToken);
    const ch = propertyChannel(created.id);
    bobClient.send({ t: "sub", channels: [ch] });
    await bobClient.waitFor((m) => m.t === "subbed");

    // The winning write.
    const patch1 = await testApp.app.inject({
      method: "PATCH",
      url: `/api/properties/${created.id}`,
      headers: alice.headers,
      payload: { name: "Updated Name", expectedVersion: created.version },
    });
    expect(patch1.statusCode).toBe(200);
    const updated = unwrap<PropertyView>({ statusCode: patch1.statusCode, body: patch1.body });
    expect(updated.version).toBeGreaterThan(created.version);

    // Bob sees the broadcast for the write that won.
    const entityFrame = await bobClient.waitFor((m) => m.t === "entity" && m.entityId === created.id);
    if (entityFrame.t === "entity") {
      expect(entityFrame.version).toBe(updated.version);
    }

    // A stale PATCH using the original (now superseded) version is rejected with the server's
    // current copy attached.
    const patch2 = await testApp.app.inject({
      method: "PATCH",
      url: `/api/properties/${created.id}`,
      headers: alice.headers,
      payload: { name: "Conflicting Name", expectedVersion: created.version },
    });
    expect(patch2.statusCode).toBe(409);
    const conflictBody = JSON.parse(patch2.body) as {
      ok: false;
      error: { code: string; current: PropertyView };
    };
    expect(conflictBody.error.code).toBe("VERSION_CONFLICT");
    expect(conflictBody.error.current.version).toBe(updated.version);

    bobClient.close();
  });
});
