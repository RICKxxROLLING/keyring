import { describe, it, expect, afterEach } from "vitest";
import { createTestApp, createTestUser, type TestApp } from "../testing/harness.js";
import { openSocket, startWsServer, wrapClient, type WsTestClient } from "./test-helpers.js";
import { publishEntity } from "../seams.js";
import { RT_PROTOCOL_VERSION, propertyChannel, GLOBAL_CHANNEL } from "../../shared/realtime.js";

const ORIGIN = "http://localhost:8080";

async function connect(url: string, cookie: string, csrf: string): Promise<WsTestClient> {
  const ws = await openSocket(url, { cookie, origin: ORIGIN });
  const client = wrapClient(ws);
  client.send({ t: "hello", v: RT_PROTOCOL_VERSION, csrf });
  await client.waitFor((m) => m.t === "ready");
  return client;
}

describe("entity broadcast (publishEntity via setPublisher)", () => {
  let testApp: TestApp;

  afterEach(async () => {
    if (testApp) await testApp.close();
  });

  it("reaches every subscriber of the target channel and nobody else, under 1s", async () => {
    testApp = await createTestApp();
    const inChannel = createTestUser({ handle: "entityin" });
    const outOfChannel = createTestUser({ handle: "entityout" });
    const url = await startWsServer(testApp.app);
    const propertyId = "prp_entity00000000000000000001";
    const ch = propertyChannel(propertyId);

    const subscriber = await connect(url, inChannel.headers.cookie, inChannel.csrfToken);
    subscriber.send({ t: "sub", channels: [ch] });
    await subscriber.waitFor((m) => m.t === "subbed");

    const bystander = await connect(url, outOfChannel.headers.cookie, outOfChannel.csrfToken);
    // bystander does NOT subscribe to the property channel.

    const start = Date.now();
    publishEntity({
      action: "updated",
      entityType: "note",
      entityId: "not_entity00000000000000000001",
      propertyId,
      version: 3,
      actorId: inChannel.id,
    });

    const frame = await subscriber.waitFor((m) => m.t === "entity");
    const elapsedMs = Date.now() - start;
    expect(elapsedMs).toBeLessThan(1000);
    expect(frame).toMatchObject({
      t: "entity",
      channel: ch,
      action: "updated",
      entityType: "note",
      entityId: "not_entity00000000000000000001",
      propertyId,
      version: 3,
      actorId: inChannel.id,
    });
    if (frame.t === "entity") {
      expect(typeof frame.at).toBe("string");
    }

    // The bystander (not subscribed to this property channel) must never see it.
    let bystanderSawIt = false;
    await Promise.race([
      bystander.waitFor((m) => m.t === "entity").then(() => {
        bystanderSawIt = true;
      }),
      new Promise((resolve) => setTimeout(resolve, 300)),
    ]);
    expect(bystanderSawIt).toBe(false);

    subscriber.close();
    bystander.close();
  });

  it("broadcasts portfolio-wide entities (propertyId: null) on the global channel", async () => {
    testApp = await createTestApp();
    const user = createTestUser({ handle: "entityglobal" });
    const url = await startWsServer(testApp.app);
    const client = await connect(url, user.headers.cookie, user.csrfToken);
    // `global` is auto-subscribed on hello — no explicit sub needed.

    publishEntity({
      action: "created",
      entityType: "vendor",
      entityId: "ven_global00000000000000000001",
      propertyId: null,
      version: 1,
      actorId: user.id,
    });
    const frame = await client.waitFor((m) => m.t === "entity");
    expect(frame).toMatchObject({ t: "entity", channel: GLOBAL_CHANNEL, entityType: "vendor" });
    client.close();
  });
});
