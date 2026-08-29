import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "../testing/harness.js";
import { getDb } from "../db/index.js";
import { writeAudit } from "./audit.js";
import {
  authHeaders,
  bootstrapOwner,
  issueAndAcceptInvite,
  parseEnvelope,
  setCookieHeader,
  totpCodeFor,
} from "../auth/test-support.js";
import type { AuditEntry, Page } from "../../shared/types.js";

function listTsFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTsFilesRecursive(full));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

describe("audit log", () => {
  let ctx: TestApp;

  afterEach(async () => {
    if (ctx) await ctx.close();
  });

  it("writeAudit redacts sensitive keys and returns an id", async () => {
    ctx = await createTestApp();
    const id = writeAudit({
      actorUserId: null,
      actorLabel: "system",
      action: "create",
      entityType: "user",
      entityId: "usr_test",
      propertyId: null,
      summary: "test row",
      before: { password: "hunter2", passwordHash: "abc", totpSecret: "xyz", ok: "fine" },
      after: { tokenHash: "def", csrfToken: "ghi", recoveryCode: "jkl", setupToken: "mno", ok: "fine" },
    });
    expect(id).toMatch(/^aud_/);
    const db = getDb();
    const row = db.prepare(`SELECT before_json, after_json FROM audit_log WHERE id = ?`).get(id) as {
      before_json: string;
      after_json: string;
    };
    const before = JSON.parse(row.before_json) as Record<string, unknown>;
    const after = JSON.parse(row.after_json) as Record<string, unknown>;
    expect(before.password).toBe("[redacted]");
    expect(before.passwordHash).toBe("[redacted]");
    expect(before.totpSecret).toBe("[redacted]");
    expect(before.ok).toBe("fine");
    expect(after.tokenHash).toBe("[redacted]");
    expect(after.csrfToken).toBe("[redacted]");
    expect(after.recoveryCode).toBe("[redacted]");
    expect(after.setupToken).toBe("[redacted]");
    expect(after.ok).toBe("fine");
  });

  it("auditFromRequest fills actor/ip/requestId from the authenticated request", async () => {
    // Routes cannot be added to an already-`ready()` Fastify instance (frozen
    // createTestApp() boots and readies the app), so exercise auditFromRequest through a
    // real authenticated route instead of registering a throwaway one: PATCH
    // /api/users/me runs `auditFromRequest` on every successful self-update.
    ctx = await createTestApp();
    const owner = await bootstrapOwner(ctx.app, ctx.dir);
    const res = await ctx.app.inject({
      method: "PATCH",
      url: "/api/users/me",
      headers: authHeaders(owner),
      payload: { displayName: "Renamed Via Audit Test", expectedVersion: 1 },
    });
    expect(res.statusCode).toBe(200);
    const db = getDb();
    const row = db
      .prepare(`SELECT actor_user_id, actor_label, ip, request_id FROM audit_log WHERE action = 'update' AND entity_id = ?`)
      .get(owner.userId) as { actor_user_id: string; actor_label: string; ip: string | null; request_id: string | null };
    expect(row.actor_user_id).toBe(owner.userId);
    expect(row.request_id).toBeTruthy();
    expect(row.actor_label).toBe("Owner Test");
  });

  it("no code path anywhere updates or deletes an audit_log row", () => {
    const files = listTsFilesRecursive(join(process.cwd(), "server"));
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      if (/UPDATE\s+audit_log/i.test(text) || /DELETE\s+FROM\s+audit_log/i.test(text)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("GET /api/audit filters by entityType, action, actorId, and date range, and paginates", async () => {
    ctx = await createTestApp();
    const owner = await bootstrapOwner(ctx.app, ctx.dir);

    writeAudit({
      actorUserId: owner.userId,
      actorLabel: "Owner Test",
      action: "create",
      entityType: "property",
      entityId: "prp_probe0000000000000000001",
      propertyId: "prp_probe0000000000000000001",
      summary: "created a property",
    });
    writeAudit({
      actorUserId: owner.userId,
      actorLabel: "Owner Test",
      action: "update",
      entityType: "property",
      entityId: "prp_probe0000000000000000001",
      propertyId: "prp_probe0000000000000000001",
      summary: "updated a property",
    });
    writeAudit({
      actorUserId: null,
      actorLabel: "system",
      action: "backup_started",
      entityType: "backup",
      entityId: "bkp_probe000000000000000001",
      propertyId: null,
      summary: "started a backup",
    });

    const byEntity = await ctx.app.inject({
      method: "GET",
      url: "/api/audit?entityType=property&entityId=prp_probe0000000000000000001",
      headers: authHeaders(owner),
    });
    expect(byEntity.statusCode).toBe(200);
    const byEntityBody = parseEnvelope<Page<AuditEntry>>(byEntity);
    expect(byEntityBody.data?.items.length).toBe(2);
    expect(byEntityBody.data?.items.every((e) => e.entityType === "property")).toBe(true);

    const byAction = await ctx.app.inject({
      method: "GET",
      url: "/api/audit?action=backup_started",
      headers: authHeaders(owner),
    });
    const byActionBody = parseEnvelope<Page<AuditEntry>>(byAction);
    expect(byActionBody.data?.items.length).toBe(1);
    expect(byActionBody.data?.items[0]?.actor).toBeNull();
    expect(byActionBody.data?.items[0]?.actorLabel).toBe("system");

    const byActor = await ctx.app.inject({
      method: "GET",
      url: `/api/audit?actorId=${owner.userId}&action=create`,
      headers: authHeaders(owner),
    });
    const byActorBody = parseEnvelope<Page<AuditEntry>>(byActor);
    expect(byActorBody.data?.items.length).toBeGreaterThanOrEqual(1);
    for (const item of byActorBody.data?.items ?? []) {
      expect(item.actor?.id).toBe(owner.userId);
      // Actor is resolved to a full UserRef, not just the id.
      expect(item.actor?.displayName).toBe("Owner Test");
    }

    const farFuture = await ctx.app.inject({
      method: "GET",
      url: "/api/audit?from=2999-01-01T00:00:00.000Z",
      headers: authHeaders(owner),
    });
    const farFutureBody = parseEnvelope<Page<AuditEntry>>(farFuture);
    expect(farFutureBody.data?.items.length).toBe(0);

    const paged = await ctx.app.inject({
      method: "GET",
      url: "/api/audit?limit=1",
      headers: authHeaders(owner),
    });
    const pagedBody = parseEnvelope<Page<AuditEntry>>(paged);
    expect(pagedBody.data?.items.length).toBe(1);
    expect(pagedBody.data?.nextCursor).toBeTruthy();

    const page2 = await ctx.app.inject({
      method: "GET",
      url: `/api/audit?limit=1&cursor=${encodeURIComponent(pagedBody.data!.nextCursor!)}`,
      headers: authHeaders(owner),
    });
    const page2Body = parseEnvelope<Page<AuditEntry>>(page2);
    expect(page2Body.data?.items.length).toBe(1);
    expect(page2Body.data?.items[0]?.id).not.toBe(pagedBody.data?.items[0]?.id);
  });

  it("GET /api/audit requires a session", async () => {
    ctx = await createTestApp();
    const res = await ctx.app.inject({ method: "GET", url: "/api/audit" });
    expect(res.statusCode).toBe(401);
  });

  it("every auth-related event in §C6.6's list is actually audited end to end", async () => {
    ctx = await createTestApp();
    const owner = await bootstrapOwner(ctx.app, ctx.dir); // login, totp_enrolled
    const manager = await issueAndAcceptInvite(ctx.app, owner); // invite_issued, invite_accepted, totp_enrolled, login

    // login_failed
    await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: owner.email, password: "wrong password entirely" },
    });

    // logout
    await ctx.app.inject({ method: "POST", url: "/api/auth/logout", headers: authHeaders(owner) });

    // Re-authenticate the owner to keep testing (logout revoked the session above).
    const reOwner = await (async () => {
      const loginRes = await ctx.app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: owner.email, password: owner.password },
      });
      const { mfaToken } = parseEnvelope<{ mfaToken: string }>(loginRes).data!;
      const code = totpCodeFor(owner.totpSecret, owner.email);
      const totpRes = await ctx.app.inject({
        method: "POST",
        url: "/api/auth/login/totp",
        payload: { mfaToken, code },
      });
      const body = parseEnvelope<{ csrfToken: string }>(totpRes);
      return { ...owner, sessionCookie: setCookieHeader(totpRes), csrfToken: body.data!.csrfToken };
    })();

    // recovery_used — while the manager is still active.
    const loginRes2 = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: manager.email, password: manager.password },
    });
    const { mfaToken } = parseEnvelope<{ mfaToken: string }>(loginRes2).data!;
    const recRes = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login/recovery",
      payload: { mfaToken, recoveryCode: manager.recoveryCodes[0] },
    });
    expect(recRes.statusCode).toBe(200);

    // role_changed + user_deactivated: promote manager to owner, then deactivate them.
    const db = getDb();
    db.prepare(`UPDATE users SET role = 'owner' WHERE id = ?`).run(manager.userId);
    await ctx.app.inject({
      method: "PATCH",
      url: `/api/users/${manager.userId}`,
      headers: authHeaders(reOwner),
      payload: { role: "manager", expectedVersion: 1 },
    });
    await ctx.app.inject({
      method: "PATCH",
      url: `/api/users/${manager.userId}`,
      headers: authHeaders(reOwner),
      payload: { isActive: false, expectedVersion: 2 },
    });

    // invite_revoked
    const inviteRes = await ctx.app.inject({
      method: "POST",
      url: "/api/invites",
      headers: authHeaders(reOwner),
      payload: { email: "revoke-target@example.test", role: "manager" },
    });
    const invite = parseEnvelope<{ id: string }>(inviteRes).data!;
    await ctx.app.inject({
      method: "DELETE",
      url: `/api/invites/${invite.id}`,
      headers: authHeaders(reOwner),
    });

    // password_changed
    await ctx.app.inject({
      method: "POST",
      url: "/api/auth/password",
      headers: authHeaders(reOwner),
      payload: { currentPassword: reOwner.password, newPassword: "a brand new passphrase 2000" },
    });

    const actions = (db.prepare(`SELECT DISTINCT action FROM audit_log`).all() as { action: string }[]).map(
      (r) => r.action,
    );
    const required = [
      "login",
      "login_failed",
      "logout",
      "invite_issued",
      "invite_revoked",
      "invite_accepted",
      "totp_enrolled",
      "recovery_used",
      "password_changed",
      "role_changed",
      "user_deactivated",
    ];
    for (const action of required) {
      expect(actions, `expected audit_log to contain a '${action}' row`).toContain(action);
    }
  });
});
