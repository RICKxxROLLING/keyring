import { describe, it, expect, afterEach } from "vitest";
import { createTestApp, createTestUser, unwrap, type TestApp } from "../testing/harness.js";
import { openSocket, startWsServer, wrapClient, type WsTestClient } from "./test-helpers.js";
import { RT_PROTOCOL_VERSION, propertyChannel } from "../../shared/realtime.js";
import type { PresenceUser } from "../../shared/realtime.js";

const ORIGIN = "http://localhost:8080";

async function connect(url: string, cookie: string, csrf: string): Promise<WsTestClient> {
  const ws = await openSocket(url, { cookie, origin: ORIGIN });
  const client = wrapClient(ws);
  client.send({ t: "hello", v: RT_PROTOCOL_VERSION, csrf });
  await client.waitFor((m) => m.t === "ready");
  return client;
}

describe("presence", () => {
  let testApp: TestApp;

  afterEach(async () => {
    if (testApp) await testApp.close();
  });

  it("two connections in one channel each see the other; disconnect rebroadcasts", async () => {
    testApp = await createTestApp();
    const alice = createTestUser({ handle: "alice" });
    const bob = createTestUser({ handle: "bob" });
    const url = await startWsServer(testApp.app);
    const ch = propertyChannel("prp_01ARZ3NDEKTSV4RRFFQ69G5FAV");

    const a = await connect(url, alice.headers.cookie, alice.csrfToken);
    a.send({ t: "sub", channels: [ch] });
    await a.waitFor((m) => m.t === "presence" && m.channel === ch); // initial: just Alice

    const b = await connect(url, bob.headers.cookie, bob.csrfToken);
    b.send({ t: "sub", channels: [ch] });
    // Bob's own subscribe response includes both members.
    const bPresence = await b.waitFor((m) => m.t === "presence" && m.channel === ch);
    if (bPresence.t === "presence") {
      const ids = bPresence.users.map((u: PresenceUser) => u.user.id);
      expect(ids).toContain(alice.id);
      expect(ids).toContain(bob.id);
    }
    // Alice is rebroadcast the updated (2-member) list when Bob joins.
    const aUpdated = await a.waitFor(
      (m) => m.t === "presence" && m.channel === ch && m.users.length === 2,
    );
    if (aUpdated.t === "presence") {
      expect(aUpdated.users.map((u: PresenceUser) => u.user.id).sort()).toEqual(
        [alice.id, bob.id].sort(),
      );
    }

    // Bob disconnects — Alice sees the member list shrink back to just herself.
    b.close();
    const afterLeave = await a.waitFor(
      (m) => m.t === "presence" && m.channel === ch && m.users.length === 1,
    );
    if (afterLeave.t === "presence") {
      expect(afterLeave.users[0]!.user.id).toBe(alice.id);
    }
    a.close();
  });

  it("propagates page and status updates", async () => {
    testApp = await createTestApp();
    const alice = createTestUser({ handle: "alice2" });
    const bob = createTestUser({ handle: "bob2" });
    const url = await startWsServer(testApp.app);
    const ch = propertyChannel("prp_01ARZ3NDEKTSV4RRFFQ69G5FAW");

    const a = await connect(url, alice.headers.cookie, alice.csrfToken);
    a.send({ t: "sub", channels: [ch] });
    await a.waitFor((m) => m.t === "presence" && m.channel === ch);

    const b = await connect(url, bob.headers.cookie, bob.csrfToken);
    b.send({ t: "sub", channels: [ch] });
    await b.waitFor((m) => m.t === "presence" && m.channel === ch);
    await a.waitFor((m) => m.t === "presence" && m.channel === ch && m.users.length === 2);

    b.send({ t: "presence", channel: ch, page: "/p/x/maintenance", status: "active" });
    const updated = await a.waitFor(
      (m) => m.t === "presence" && m.channel === ch && m.users.some((u: PresenceUser) => u.page === "/p/x/maintenance"),
    );
    if (updated.t === "presence") {
      const bobEntry = updated.users.find((u: PresenceUser) => u.user.id === bob.id)!;
      expect(bobEntry.page).toBe("/p/x/maintenance");
      expect(bobEntry.status).toBe("active");
    }
    a.close();
    b.close();
  });

  it("GET /api/presence returns the same data as the socket view", async () => {
    testApp = await createTestApp();
    const alice = createTestUser({ handle: "alice3" });
    const url = await startWsServer(testApp.app);
    const propertyId = "prp_01ARZ3NDEKTSV4RRFFQ69G5FAX";
    const ch = propertyChannel(propertyId);

    const a = await connect(url, alice.headers.cookie, alice.csrfToken);
    a.send({ t: "sub", channels: [ch] });
    await a.waitFor((m) => m.t === "presence" && m.channel === ch);

    const res = await testApp.app.inject({
      method: "GET",
      url: `/api/presence?propertyId=${propertyId}`,
      headers: alice.headers,
    });
    expect(res.statusCode).toBe(200);
    const data = unwrap<{ channels: { channel: string; users: PresenceUser[] }[] }>({
      statusCode: res.statusCode,
      body: res.body,
    });
    expect(data.channels).toHaveLength(1);
    expect(data.channels[0]!.channel).toBe(ch);
    expect(data.channels[0]!.users.map((u) => u.user.id)).toContain(alice.id);
    a.close();
  });
});
