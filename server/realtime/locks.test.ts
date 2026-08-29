import { describe, it, expect, afterEach, vi } from "vitest";
import { createTestApp, createTestUser, type TestApp } from "../testing/harness.js";
import { openSocket, startWsServer, wrapClient, type WsTestClient } from "./test-helpers.js";
import { runJobNow } from "../lib/scheduler.js";
import {
  RT_PROTOCOL_VERSION,
  propertyChannel,
  LOCK_TTL_MS,
  LOCK_IDLE_TAKEOVER_MS,
  type LockKey,
} from "../../shared/realtime.js";

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

describe("soft field locks", () => {
  let testApp: TestApp;

  afterEach(async () => {
    vi.useRealTimers();
    if (testApp) await testApp.close();
  });

  it("acquire on a free key grants it", async () => {
    testApp = await createTestApp();
    const alice = createTestUser({ handle: "alocka" });
    const url = await startWsServer(testApp.app);
    const ch = propertyChannel("prp_lock0000000000000000000001");
    const a = await connect(url, alice.headers.cookie, alice.csrfToken, ch);

    a.send({ t: "lock.acquire", key: KEY });
    const granted = await a.waitFor((m) => m.t === "lock.granted");
    expect(granted).toMatchObject({ t: "lock.granted", key: KEY, holder: { id: alice.id } });
    a.close();
  });

  it("a second connection is denied with the holder and canTakeoverAt", async () => {
    testApp = await createTestApp();
    const alice = createTestUser({ handle: "alockb" });
    const bob = createTestUser({ handle: "blockb" });
    const url = await startWsServer(testApp.app);
    const ch = propertyChannel("prp_lock0000000000000000000002");
    const a = await connect(url, alice.headers.cookie, alice.csrfToken, ch);
    const b = await connect(url, bob.headers.cookie, bob.csrfToken, ch);

    a.send({ t: "lock.acquire", key: KEY });
    await a.waitFor((m) => m.t === "lock.granted");

    b.send({ t: "lock.acquire", key: KEY });
    const denied = await b.waitFor((m) => m.t === "lock.denied");
    expect(denied).toMatchObject({ t: "lock.denied", key: KEY, holder: { id: alice.id } });
    if (denied.t === "lock.denied") {
      expect(typeof denied.canTakeoverAt).toBe("string");
    }
    a.close();
    b.close();
  });

  it("heartbeat extends expiresAt", async () => {
    testApp = await createTestApp();
    const alice = createTestUser({ handle: "alockc" });
    const url = await startWsServer(testApp.app);
    const ch = propertyChannel("prp_lock0000000000000000000003");
    const a = await connect(url, alice.headers.cookie, alice.csrfToken, ch);

    a.send({ t: "lock.acquire", key: KEY });
    const granted1 = await a.waitFor((m) => m.t === "lock.granted");
    const expiresAt1 = granted1.t === "lock.granted" ? granted1.expiresAt : "";
    // acquireLock also broadcasts an initial lock.state to the channel (with the same
    // expiresAt as the grant) — drain it so the next waitFor below picks up the heartbeat's
    // lock.state, not this stale one still sitting in the backlog.
    await a.waitFor((m) => m.t === "lock.state" && m.channel === ch);

    // Keep fake time active until the server has actually processed the heartbeat and replied —
    // vi.useFakeTimers only fakes Date (not socket I/O), so the real WS round-trip still
    // completes; restoring real time too early would make the server compute expiresAt from the
    // (barely advanced) real clock instead, making the two timestamps indistinguishable.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() + 5000));
    a.send({ t: "lock.heartbeat", key: KEY });
    const state = await a.waitFor((m) => m.t === "lock.state" && m.channel === ch && m.locks.length > 0);
    vi.useRealTimers();

    const expiresAt2 = state.t === "lock.state" ? state.locks[0]!.expiresAt : "";
    expect(Date.parse(expiresAt2)).toBeGreaterThan(Date.parse(expiresAt1));
    a.close();
  });

  it("a lock with no heartbeat for LOCK_TTL_MS is swept and announced as expired", async () => {
    testApp = await createTestApp();
    const alice = createTestUser({ handle: "alockd" });
    const url = await startWsServer(testApp.app);
    const ch = propertyChannel("prp_lock0000000000000000000004");
    const a = await connect(url, alice.headers.cookie, alice.csrfToken, ch);

    a.send({ t: "lock.acquire", key: KEY });
    await a.waitFor((m) => m.t === "lock.granted");

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() + LOCK_TTL_MS + 1000));
    await runJobNow("realtime-lock-sweep");
    vi.useRealTimers();

    const released = await a.waitFor((m) => m.t === "lock.released");
    expect(released).toMatchObject({ t: "lock.released", key: KEY, reason: "expired" });
    a.close();
  });

  it("destroying the holder's socket releases the lock as disconnected", async () => {
    testApp = await createTestApp();
    const alice = createTestUser({ handle: "alocke" });
    const bob = createTestUser({ handle: "blocke" });
    const url = await startWsServer(testApp.app);
    const ch = propertyChannel("prp_lock0000000000000000000005");
    const a = await connect(url, alice.headers.cookie, alice.csrfToken, ch);
    const b = await connect(url, bob.headers.cookie, bob.csrfToken, ch);

    a.send({ t: "lock.acquire", key: KEY });
    await a.waitFor((m) => m.t === "lock.granted");

    a.close();
    const released = await b.waitFor((m) => m.t === "lock.released");
    expect(released).toMatchObject({ t: "lock.released", key: KEY, reason: "disconnected" });
    b.close();
  });

  it("force takeover before canTakeoverAt is denied; after it succeeds and releases the old holder", async () => {
    testApp = await createTestApp();
    const alice = createTestUser({ handle: "alockf" });
    const bob = createTestUser({ handle: "blockf" });
    const url = await startWsServer(testApp.app);
    const ch = propertyChannel("prp_lock0000000000000000000006");
    const a = await connect(url, alice.headers.cookie, alice.csrfToken, ch);
    const b = await connect(url, bob.headers.cookie, bob.csrfToken, ch);

    a.send({ t: "lock.acquire", key: KEY });
    await a.waitFor((m) => m.t === "lock.granted");

    // Premature takeover: denied, state unchanged.
    b.send({ t: "lock.acquire", key: KEY, force: true });
    const stillDenied = await b.waitFor((m) => m.t === "lock.denied");
    expect(stillDenied).toMatchObject({ t: "lock.denied", key: KEY, holder: { id: alice.id } });

    // Jump past the idle-takeover window. Keep fake time active until both resulting frames
    // have actually arrived — see the note in the heartbeat test above.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() + LOCK_IDLE_TAKEOVER_MS + 1000));
    b.send({ t: "lock.acquire", key: KEY, force: true });

    const released = await a.waitFor((m) => m.t === "lock.released");
    const granted = await b.waitFor((m) => m.t === "lock.granted");
    vi.useRealTimers();

    expect(released).toMatchObject({ t: "lock.released", key: KEY, reason: "takeover" });
    expect(granted).toMatchObject({ t: "lock.granted", key: KEY, holder: { id: bob.id } });

    a.close();
    b.close();
  });
});
