// server/auth/test-signin.ts — password-less sign-in, for the test server only.
//
// The test server exists so changes can be tried on real hardware before they
// reach production — by automated sessions as much as by people. Neither should
// need a real person's account there, and typing a password into it is exactly
// the habit that ends with someone typing their real one into the wrong copy.
//
// So on the test server (and only there) the sign-in page offers three seeded
// accounts — an owner and two managers, matching production's three people —
// and one click signs in as any of them. It creates an ordinary session, so
// everything after it (CSRF, the WebSocket, owner-only routes, the audit log)
// runs exactly as it does in production.
//
// What keeps this off production, each independently sufficient:
//
//   1. It must be switched on explicitly: KEYRING_TEST_SIGNIN=1.
//   2. loadEnv() refuses to START if that is set without KEYRING_INSTANCE, or
//      with an https:// APP_ORIGIN — and production's origin is the https
//      tunnel hostname, so copying the variable across fails the boot loudly
//      rather than opening the door quietly.
//   3. The routes are not registered at all unless it is on: production
//      answers 404, not 403.
//   4. Even when on, a sign-in is accepted only from a loopback or private
//      address — the LAN — never from the internet.
//   5. Only the seeded @keyring.test accounts can be signed into. Any other
//      account on the box keeps needing its password and 2FA.
import { BlockList, isIP } from "node:net";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { getDb, tx } from "../db/index.js";
import { getEnv } from "../config/env.js";
import { ApiError, ok } from "../lib/errors.js";
import { newId } from "../lib/ids.js";
import { nowIso } from "../lib/time.js";
import { parseBody } from "../lib/validate.js";
import { writeAudit } from "../audit/audit.js";
import { consumeSetupToken, needsSetup } from "./bootstrap.js";
import { createSession, setSessionCookies } from "./session.js";
import { toUser, type UserRow } from "./serialize.js";
import type { Role } from "../../shared/types.js";

export const TEST_ACCOUNT_DOMAIN = "@keyring.test";

/**
 * Not an argon2 hash, so verifyPassword() can never match it: these accounts
 * have no password at all, and the ordinary login form rejects them like any
 * wrong password.
 */
const NO_PASSWORD = "!test-account-no-password";

const ACCOUNTS: { handle: string; displayName: string; role: Role; color: string }[] = [
  { handle: "test-owner", displayName: "Test Owner", role: "owner", color: "#2563eb" },
  { handle: "test-manager-a", displayName: "Test Manager A", role: "manager", color: "#0f766e" },
  { handle: "test-manager-b", displayName: "Test Manager B", role: "manager", color: "#b45309" },
];

export interface TestAccount {
  id: string;
  displayName: string;
  role: Role;
}

/**
 * Create the three test accounts if they are missing, and mark setup done, so
 * the test server never asks for the one-time setup token.
 *
 * The owner is created only when there is no owner yet: if somebody did set
 * the test server up by hand, their account stays the owner.
 */
export function ensureTestAccounts(): void {
  const db = getDb();
  tx(() => {
    const hasOwner = db.prepare(`SELECT 1 FROM users WHERE role = 'owner' LIMIT 1`).get() !== undefined;
    const exists = db.prepare(`SELECT 1 FROM users WHERE lower(email) = lower(?)`);
    const insert = db.prepare(
      `INSERT INTO users (id, email, handle, display_name, role, password_hash, avatar_color,
         is_active, created_at, updated_at, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 1)`,
    );
    for (const a of ACCOUNTS) {
      if (a.role === "owner" && hasOwner) continue;
      const email = `${a.handle}${TEST_ACCOUNT_DOMAIN}`;
      if (exists.get(email)) continue;
      const at = nowIso();
      insert.run(newId("usr"), email, a.handle, a.displayName, a.role, NO_PASSWORD, a.color, at, at);
    }
    if (needsSetup()) consumeSetupToken();
  });
}

export function listTestAccounts(): TestAccount[] {
  return (
    getDb()
      .prepare(
        `SELECT id, display_name, role FROM users
          WHERE lower(email) LIKE ? AND is_active = 1
          ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, display_name`,
      )
      .all(`%${TEST_ACCOUNT_DOMAIN}`) as { id: string; display_name: string; role: Role }[]
  ).map((r) => ({ id: r.id, displayName: r.display_name, role: r.role }));
}

const LAN = new BlockList();
LAN.addSubnet("127.0.0.0", 8, "ipv4");
LAN.addSubnet("10.0.0.0", 8, "ipv4");
LAN.addSubnet("172.16.0.0", 12, "ipv4");
LAN.addSubnet("192.168.0.0", 16, "ipv4");
LAN.addAddress("::1", "ipv6");
LAN.addSubnet("fc00::", 7, "ipv6");
LAN.addSubnet("fe80::", 10, "ipv6");

/** Loopback or a private range. IPv4-mapped IPv6 (::ffff:10.0.0.5) counts as its IPv4. */
export function isLanAddress(ip: string | undefined): boolean {
  if (!ip) return false;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  const addr = mapped ? mapped[1]! : ip;
  const family = isIP(addr);
  if (family === 4) return LAN.check(addr, "ipv4");
  if (family === 6) return LAN.check(addr, "ipv6");
  return false;
}

const SignInSchema = z.object({ userId: z.string().min(1).max(64) }).strict();

function assertFromLan(req: FastifyRequest): void {
  if (!isLanAddress(req.ip)) {
    throw new ApiError("FORBIDDEN", "Test sign-in only works from the local network.");
  }
}

export async function registerTestSignInRoutes(app: FastifyInstance): Promise<void> {
  ensureTestAccounts();

  app.get("/api/test/accounts", async (req) => {
    assertFromLan(req);
    return ok(listTestAccounts());
  });

  app.post("/api/test/sign-in", async (req, reply) => {
    assertFromLan(req);
    const { userId } = parseBody(req, SignInSchema);
    const account = listTestAccounts().find((a) => a.id === userId);
    if (!account) throw new ApiError("NOT_FOUND", "No such test account.");

    const at = nowIso();
    getDb().prepare(`UPDATE users SET last_login_at = ? WHERE id = ?`).run(at, account.id);
    const session = createSession(account.id, req);
    setSessionCookies(reply, session);
    writeAudit({
      actorUserId: account.id,
      actorLabel: account.displayName,
      action: "login",
      entityType: "user",
      entityId: account.id,
      propertyId: null,
      summary: "Signed in to the test server as a test account (no password).",
      ip: req.ip ?? null,
      requestId: String(req.id),
    });
    const row = getDb().prepare(`SELECT * FROM users WHERE id = ?`).get(account.id) as UserRow;
    return ok({
      user: toUser(row),
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
      serverTime: nowIso(),
      timezone: getEnv().APP_TIMEZONE,
    });
  });
}
