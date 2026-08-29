import { describe, it, expect, afterEach } from "vitest";
import { createTestApp, createTestUser, type TestApp } from "../testing/harness.js";
import { openSocket, startWsServer, wrapClient, type WsTestClient } from "./test-helpers.js";
import { getDb } from "../db/index.js";
import { RT_PROTOCOL_VERSION, propertyChannel, type LockKey } from "../../shared/realtime.js";

const ORIGIN = "http://localhost:8080";
const KEY: LockKey = { entityType: "note", entityId: "not_01ARZ3NDEKTSV4RRFFQ69G5FAV", field: "body" };

async function connect(url: string, cookie: string, csrf: string, channel: string): Promise<WsTestClient> {
  const ws = await openSocket(url, { cookie, origin: ORIGIN });
  const client = wrapClient(ws);
  client.send({ t: "hello", v: RT_PROTOCOL_VERSION, csrf });
  await client.waitFor((m) => m.t === "ready");
  client.send({ t: "sub", channels: [channel] });
  await client.waitFor((m) => m.t === "lock.state" && m.channel === channel);
  return client;
}

describe("draft streaming", () => {
  let testApp: TestApp;

  afterEach(async () => {
    if (testApp) await testApp.close();
  });

  it("fans drafts out to the channel excluding the sender", async () => {
    testApp = await createTestApp();
    const alice = createTestUser({ handle: "draftalice" });
    const bob = createTestUser({ handle: "draftbob" });
    const url = await startWsServer(testApp.app);
    const ch = propertyChannel("prp_draft000000000000000000001");
    const a = await connect(url, alice.headers.cookie, alice.csrfToken, ch);
    const b = await connect(url, bob.headers.cookie, bob.csrfToken, ch);

    a.send({ t: "lock.acquire", key: KEY });
    await a.waitFor((m) => m.t === "lock.granted");

    a.send({ t: "draft", key: KEY, value: "hello", seq: 1 });
    const received = await b.waitFor((m) => m.t === "draft");
    expect(received).toMatchObject({ t: "draft", key: KEY, value: "hello", seq: 1, from: { id: alice.id } });

    // The sender never receives its own draft frame back.
    let senderGotEcho = false;
    const raceTimeout = new Promise((resolve) => setTimeout(resolve, 300));
    const echoCheck = a.waitFor((m) => m.t === "draft").then(() => {
      senderGotEcho = true;
    });
    await Promise.race([echoCheck, raceTimeout]);
    expect(senderGotEcho).toBe(false);

    a.close();
    b.close();
  });

  it("drops frames whose seq is not strictly increasing", async () => {
    testApp = await createTestApp();
    const alice = createTestUser({ handle: "draftalice2" });
    const bob = createTestUser({ handle: "draftbob2" });
    const url = await startWsServer(testApp.app);
    const ch = propertyChannel("prp_draft000000000000000000002");
    const a = await connect(url, alice.headers.cookie, alice.csrfToken, ch);
    const b = await connect(url, bob.headers.cookie, bob.csrfToken, ch);

    a.send({ t: "lock.acquire", key: KEY });
    await a.waitFor((m) => m.t === "lock.granted");

    a.send({ t: "draft", key: KEY, value: "v1", seq: 5 });
    const first = await b.waitFor((m) => m.t === "draft");
    expect(first).toMatchObject({ value: "v1", seq: 5 });

    // Duplicate / stale seq — must be dropped, not delivered.
    a.send({ t: "draft", key: KEY, value: "stale", seq: 5 });
    a.send({ t: "draft", key: KEY, value: "older", seq: 3 });
    // Next legitimate increasing draft proves the connection is still alive and only the
    // higher seq got through.
    a.send({ t: "draft", key: KEY, value: "v2", seq: 6 });
    const next = await b.waitFor((m) => m.t === "draft" && m.seq !== 5);
    expect(next).toMatchObject({ value: "v2", seq: 6 });

    a.close();
    b.close();
  });

  it("never touches the database — row count is unchanged across a draft broadcast", async () => {
    testApp = await createTestApp();
    const alice = createTestUser({ handle: "draftalice3" });
    const bob = createTestUser({ handle: "draftbob3" });
    const url = await startWsServer(testApp.app);
    const ch = propertyChannel("prp_draft000000000000000000003");
    const a = await connect(url, alice.headers.cookie, alice.csrfToken, ch);
    const b = await connect(url, bob.headers.cookie, bob.csrfToken, ch);

    a.send({ t: "lock.acquire", key: KEY });
    await a.waitFor((m) => m.t === "lock.granted");

    function countAllRows(): number {
      const db = getDb();
      const tables = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
        .all() as { name: string }[];
      let total = 0;
      for (const { name } of tables) {
        const row = db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get() as { n: number };
        total += row.n;
      }
      return total;
    }

    const before = countAllRows();
    for (let i = 1; i <= 20; i++) {
      a.send({ t: "draft", key: KEY, value: `keystroke ${i}`, seq: i });
    }
    await b.waitFor((m) => m.t === "draft" && m.seq === 20);
    const after = countAllRows();
    expect(after).toBe(before);

    a.close();
    b.close();
  });
});
