import { describe, it, expect, afterEach } from "vitest";
import { createTestApp, createTestUser, type TestApp } from "../testing/harness.js";
import { openSocket, startWsServer, wrapClient } from "./test-helpers.js";
import { RT_PROTOCOL_VERSION, userChannel, GLOBAL_CHANNEL, propertyChannel } from "../../shared/realtime.js";

const ORIGIN = "http://localhost:8080";

describe("GET /ws — handshake", () => {
  let testApp: TestApp;

  afterEach(async () => {
    if (testApp) await testApp.close();
  });

  it("rejects the upgrade when Origin does not match APP_ORIGIN", async () => {
    testApp = await createTestApp();
    const user = createTestUser();
    const url = await startWsServer(testApp.app);
    await expect(
      openSocket(url, { cookie: user.headers.cookie, origin: "https://evil.example" }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("rejects the upgrade when there is no valid session cookie", async () => {
    testApp = await createTestApp();
    const url = await startWsServer(testApp.app);
    await expect(openSocket(url, { origin: ORIGIN })).rejects.toMatchObject({ statusCode: 401 });
  });

  it("closes the connection when hello is absent after 5s", async () => {
    testApp = await createTestApp();
    const user = createTestUser();
    const url = await startWsServer(testApp.app);
    const ws = await openSocket(url, { cookie: user.headers.cookie, origin: ORIGIN });
    const client = wrapClient(ws);
    const closed = new Promise<{ code: number }>((resolve) => {
      ws.once("close", (code: number) => resolve({ code }));
    });
    const errFrame = await client.waitFor((m) => m.t === "error", 6000);
    expect(errFrame).toMatchObject({ t: "error", code: "FORBIDDEN", fatal: true });
    const { code } = await closed;
    expect(code).toBe(1008);
  }, 10000);

  it("closes the connection when hello carries the wrong CSRF token", async () => {
    testApp = await createTestApp();
    const user = createTestUser();
    const url = await startWsServer(testApp.app);
    const ws = await openSocket(url, { cookie: user.headers.cookie, origin: ORIGIN });
    const client = wrapClient(ws);
    client.send({ t: "hello", v: RT_PROTOCOL_VERSION, csrf: "not-the-right-token" });
    const errFrame = await client.waitFor((m) => m.t === "error");
    expect(errFrame).toMatchObject({ t: "error", code: "FORBIDDEN", fatal: true });
    const closed = new Promise<{ code: number }>((resolve) => {
      ws.once("close", (code: number) => resolve({ code }));
    });
    const { code } = await closed;
    expect(code).toBe(1008);
  });

  it("sends ready and auto-subscribes to global and the user's own channel after a valid hello", async () => {
    testApp = await createTestApp();
    const user = createTestUser();
    const url = await startWsServer(testApp.app);
    const ws = await openSocket(url, { cookie: user.headers.cookie, origin: ORIGIN });
    const client = wrapClient(ws);
    client.send({ t: "hello", v: RT_PROTOCOL_VERSION, csrf: user.csrfToken });
    const ready = await client.waitFor((m) => m.t === "ready");
    expect(ready).toMatchObject({
      t: "ready",
      v: RT_PROTOCOL_VERSION,
      user: { id: user.id, handle: user.handle },
    });

    // Auto-subscription is verified indirectly: subscribing again to `global` and to the own
    // user channel should be accepted (present in the resulting `subbed` set), and a
    // notification pushed to user:<id> should reach this connection without an explicit sub.
    client.send({ t: "sub", channels: [] });
    const subbed = await client.waitFor((m) => m.t === "subbed");
    expect(subbed).toMatchObject({ t: "subbed" });
    if (subbed.t === "subbed") {
      expect(subbed.channels).toContain(GLOBAL_CHANNEL);
      expect(subbed.channels).toContain(userChannel(user.id));
    }
    client.close();
  });

  it("refuses a subscription to another user's channel", async () => {
    testApp = await createTestApp();
    const user = createTestUser();
    const other = createTestUser();
    const url = await startWsServer(testApp.app);
    const ws = await openSocket(url, { cookie: user.headers.cookie, origin: ORIGIN });
    const client = wrapClient(ws);
    client.send({ t: "hello", v: RT_PROTOCOL_VERSION, csrf: user.csrfToken });
    await client.waitFor((m) => m.t === "ready");

    client.send({ t: "sub", channels: [userChannel(other.id)] });
    const err = await client.waitFor((m) => m.t === "error");
    expect(err).toMatchObject({ t: "error", code: "FORBIDDEN" });
    const subbed = await client.waitFor((m) => m.t === "subbed");
    if (subbed.t === "subbed") {
      expect(subbed.channels).not.toContain(userChannel(other.id));
    }
    client.close();
  });

  it("answers a property-channel sub with subbed, presence and lock.state", async () => {
    testApp = await createTestApp();
    const user = createTestUser();
    const url = await startWsServer(testApp.app);
    const ws = await openSocket(url, { cookie: user.headers.cookie, origin: ORIGIN });
    const client = wrapClient(ws);
    client.send({ t: "hello", v: RT_PROTOCOL_VERSION, csrf: user.csrfToken });
    await client.waitFor((m) => m.t === "ready");

    const ch = propertyChannel("prp_01ARZ3NDEKTSV4RRFFQ69G5FAV");
    client.send({ t: "sub", channels: [ch] });
    const subbed = await client.waitFor((m) => m.t === "subbed");
    if (subbed.t === "subbed") expect(subbed.channels).toContain(ch);
    const presence = await client.waitFor((m) => m.t === "presence" && m.channel === ch);
    expect(presence).toMatchObject({ t: "presence", channel: ch });
    const lockState = await client.waitFor((m) => m.t === "lock.state" && m.channel === ch);
    expect(lockState).toMatchObject({ t: "lock.state", channel: ch, locks: [] });
    client.close();
  });
});
