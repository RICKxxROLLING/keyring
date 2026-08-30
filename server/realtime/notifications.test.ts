import { describe, it, expect, afterEach } from "vitest";
import { createTestApp, createTestUser, unwrap, type TestApp } from "../testing/harness.js";
import { openSocket, startWsServer, wrapClient, type WsTestClient } from "./test-helpers.js";
import { notifyMentions, notifyUsers } from "../seams.js";
import { RT_PROTOCOL_VERSION } from "../../shared/realtime.js";
import type { Notification, Page } from "../../shared/types.js";

const ORIGIN = "http://localhost:8080";

async function connectUser(url: string, cookie: string, csrf: string): Promise<WsTestClient> {
  const ws = await openSocket(url, { cookie, origin: ORIGIN });
  const client = wrapClient(ws);
  client.send({ t: "hello", v: RT_PROTOCOL_VERSION, csrf });
  await client.waitFor((m) => m.t === "ready");
  return client;
}

describe("notifications", () => {
  let testApp: TestApp;

  afterEach(async () => {
    if (testApp) await testApp.close();
  });

  it("notifyMentions parses @handles, resolves active users, skips the actor, pushes a frame", async () => {
    testApp = await createTestApp();
    const actor = createTestUser({ handle: "mentionactor" });
    const target = createTestUser({ handle: "mentiontarget" });
    const url = await startWsServer(testApp.app);
    const client = await connectUser(url, target.headers.cookie, target.csrfToken);

    notifyMentions({
      actorUserId: actor.id,
      actorLabel: actor.displayName,
      bodyText: `hey @${target.handle} and @${actor.handle} and @nobodylikesme, take a look`,
      propertyId: "prp_note0000000000000000000001",
      entityType: "note",
      entityId: "not_note0000000000000000000001",
      contextTitle: "Leaking sink",
      url: "/p/x/notes",
    });

    const frame = await client.waitFor((m) => m.t === "notification");
    expect(frame).toMatchObject({ t: "notification", notification: { type: "mention", userId: target.id } });
    if (frame.t === "notification") {
      expect(frame.unread).toBeGreaterThanOrEqual(1);
    }
    client.close();
  });

  it("does not re-notify the same handle for the same entity on a subsequent edit", async () => {
    testApp = await createTestApp();
    const actor = createTestUser({ handle: "dedupactor" });
    const target = createTestUser({ handle: "deduptarget" });
    const url = await startWsServer(testApp.app);
    const client = await connectUser(url, target.headers.cookie, target.csrfToken);

    const input = {
      actorUserId: actor.id,
      actorLabel: actor.displayName,
      bodyText: `hi @${target.handle}`,
      propertyId: "prp_dedup000000000000000000001",
      entityType: "note" as const,
      entityId: "not_dedup000000000000000000001",
      contextTitle: "Note",
      url: "/p/x/notes",
    };
    notifyMentions(input);
    await client.waitFor((m) => m.t === "notification");

    // Second call (simulating an edit that still mentions the same handle) must not push again.
    notifyMentions(input);
    let gotSecond = false;
    await Promise.race([
      client.waitFor((m) => m.t === "notification").then(() => {
        gotSecond = true;
      }),
      new Promise((resolve) => setTimeout(resolve, 300)),
    ]);
    expect(gotSecond).toBe(false);

    const res = await testApp.app.inject({
      method: "GET",
      url: "/api/notifications",
      headers: target.headers,
    });
    const page = unwrap<Page<Notification>>({ statusCode: res.statusCode, body: res.body });
    const mentionsForEntity = page.items.filter(
      (n) => n.entityId === input.entityId && n.type === "mention",
    );
    expect(mentionsForEntity).toHaveLength(1);
    client.close();
  });

  it("notifyUsers covers assignment and status notifications", async () => {
    testApp = await createTestApp();
    const actor = createTestUser({ handle: "assignactor" });
    const assignee = createTestUser({ handle: "assignee1" });
    const url = await startWsServer(testApp.app);
    const client = await connectUser(url, assignee.headers.cookie, assignee.csrfToken);

    notifyUsers({
      userIds: [assignee.id, actor.id], // actor should be skipped
      type: "assignment",
      title: "You were assigned WO-14",
      body: "Leaking sink",
      actorUserId: actor.id,
      propertyId: "prp_assign00000000000000000001",
      entityType: "work_order",
      entityId: "wo_assign00000000000000000001",
      url: "/p/x/maintenance?wo=wo_assign00000000000000000001",
    });
    const frame = await client.waitFor((m) => m.t === "notification");
    expect(frame).toMatchObject({ t: "notification", notification: { type: "assignment", userId: assignee.id } });
    client.close();
  });

  it("inbox API: list, unread count, mark-read, mark-all-read, delete", async () => {
    testApp = await createTestApp();
    const user = createTestUser({ handle: "inboxuser" });

    notifyUsers({
      userIds: [user.id],
      type: "system",
      title: "Welcome",
      body: "Hello",
      actorUserId: null,
      propertyId: null,
      entityType: null,
      entityId: null,
      url: null,
    });
    notifyUsers({
      userIds: [user.id],
      type: "system",
      title: "Second",
      body: "World",
      actorUserId: null,
      propertyId: null,
      entityType: null,
      entityId: null,
      url: null,
    });

    const listRes = await testApp.app.inject({
      method: "GET",
      url: "/api/notifications",
      headers: user.headers,
    });
    const page = unwrap<Page<Notification>>({ statusCode: listRes.statusCode, body: listRes.body });
    expect(page.items).toHaveLength(2);

    const unreadRes = await testApp.app.inject({
      method: "GET",
      url: "/api/notifications/unread-count",
      headers: user.headers,
    });
    expect(unwrap<{ unread: number }>({ statusCode: unreadRes.statusCode, body: unreadRes.body }).unread).toBe(2);

    const firstId = page.items[0]!.id;
    const readRes = await testApp.app.inject({
      method: "POST",
      url: `/api/notifications/${firstId}/read`,
      headers: user.headers,
      payload: {},
    });
    expect(readRes.statusCode).toBe(200);
    const readNotification = unwrap<Notification>({ statusCode: readRes.statusCode, body: readRes.body });
    expect(readNotification.readAt).not.toBeNull();

    const markAllRes = await testApp.app.inject({
      method: "POST",
      url: "/api/notifications/read-all",
      headers: user.headers,
      payload: {},
    });
    const marked = unwrap<{ marked: number }>({ statusCode: markAllRes.statusCode, body: markAllRes.body });
    expect(marked.marked).toBe(1); // the other unread one

    const afterAllRead = await testApp.app.inject({
      method: "GET",
      url: "/api/notifications/unread-count",
      headers: user.headers,
    });
    expect(unwrap<{ unread: number }>({ statusCode: afterAllRead.statusCode, body: afterAllRead.body }).unread).toBe(0);

    const secondId = page.items[1]!.id;
    const delRes = await testApp.app.inject({
      method: "DELETE",
      url: `/api/notifications/${secondId}`,
      headers: user.headers,
      payload: {},
    });
    expect(delRes.statusCode).toBe(200);
    const delBody = unwrap<{ id: string; deleted: true }>({ statusCode: delRes.statusCode, body: delRes.body });
    expect(delBody).toEqual({ id: secondId, deleted: true });
  });

  it("another user's notification id returns NOT_FOUND", async () => {
    testApp = await createTestApp();
    const owner = createTestUser({ handle: "notifowner" });
    const intruder = createTestUser({ handle: "notifintruder" });

    notifyUsers({
      userIds: [owner.id],
      type: "system",
      title: "Private",
      body: "Just for owner",
      actorUserId: null,
      propertyId: null,
      entityType: null,
      entityId: null,
      url: null,
    });
    const listRes = await testApp.app.inject({
      method: "GET",
      url: "/api/notifications",
      headers: owner.headers,
    });
    const page = unwrap<Page<Notification>>({ statusCode: listRes.statusCode, body: listRes.body });
    const id = page.items[0]!.id;

    const readRes = await testApp.app.inject({
      method: "POST",
      url: `/api/notifications/${id}/read`,
      headers: intruder.headers,
      payload: {},
    });
    expect(readRes.statusCode).toBe(404);
    const readBody = JSON.parse(readRes.body) as { ok: boolean; error: { code: string } };
    expect(readBody.error.code).toBe("NOT_FOUND");

    const delRes = await testApp.app.inject({
      method: "DELETE",
      url: `/api/notifications/${id}`,
      headers: intruder.headers,
      payload: {},
    });
    expect(delRes.statusCode).toBe(404);
  });
});
