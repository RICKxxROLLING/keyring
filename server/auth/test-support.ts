import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Secret, TOTP } from "otpauth";
import type { FastifyInstance } from "fastify";
import type { EnrollmentChallenge, SessionInfo } from "../../shared/types.js";

/** Not a `*.test.ts` file: shared helpers for tests across server/auth and server/audit. */

export function totpCodeFor(secretBase32: string, email = "user"): string {
  return new TOTP({
    issuer: "Keyring",
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secretBase32),
  }).generate();
}

export function readGeneratedSetupToken(dataDir: string): string {
  return readFileSync(join(dataDir, "setup-token.txt"), "utf8").trim();
}

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; retryAfter?: number; [k: string]: unknown };
}

export function parseEnvelope<T>(res: { body: string }): Envelope<T> {
  return JSON.parse(res.body) as Envelope<T>;
}

export function setCookieHeader(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers["set-cookie"];
  const list = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  return list.map((c) => c.split(";")[0]).join("; ");
}

export interface EnrolledAccount {
  userId: string;
  email: string;
  handle: string;
  password: string;
  totpSecret: string;
  sessionCookie: string;
  csrfToken: string;
  recoveryCodes: string[];
}

/**
 * Deliberately does NOT set `content-type`: `app.inject()` auto-detects and sets
 * `application/json` when a `payload` object is present, and Fastify's JSON body parser
 * rejects an *empty* body when content-type is forced to json but no payload is sent
 * (e.g. `POST /api/auth/logout`, `POST /api/users/:id/totp/reset`) — that rejection
 * happens during body-parsing, before any preHandler (auth/CSRF/role) even runs, so a
 * hardcoded content-type here would mask real 401/403/409 assertions behind a spurious
 * 400.
 */
export function authHeaders(a: EnrolledAccount): Record<string, string> {
  return { cookie: a.sessionCookie, "x-csrf-token": a.csrfToken };
}

/** Full bootstrap dance: reads the generated setup token, bootstraps, verifies TOTP. */
export async function bootstrapOwner(
  app: FastifyInstance,
  dataDir: string,
  overrides: Partial<{ email: string; handle: string; displayName: string; password: string }> = {},
): Promise<EnrolledAccount> {
  const setupToken = readGeneratedSetupToken(dataDir);
  const email = overrides.email ?? "owner@example.test";
  const handle = overrides.handle ?? "owner";
  const displayName = overrides.displayName ?? "Owner Test";
  const password = overrides.password ?? "correct horse battery staple 42";

  const bootstrapRes = await app.inject({
    method: "POST",
    url: "/api/setup/bootstrap",
    payload: { setupToken, email, handle, displayName, password },
  });
  const bootstrapBody = parseEnvelope<{
    userId: string;
    mfaToken: string;
    enrollment: EnrollmentChallenge;
  }>(bootstrapRes);
  if (!bootstrapBody.ok || !bootstrapBody.data) {
    throw new Error(`bootstrap failed: ${bootstrapRes.body}`);
  }
  const { userId, mfaToken, enrollment } = bootstrapBody.data;
  const code = totpCodeFor(enrollment.secret, email);

  const verifyRes = await app.inject({
    method: "POST",
    url: "/api/setup/bootstrap/verify",
    payload: { mfaToken, code },
  });
  const verifyBody = parseEnvelope<{ session: SessionInfo; recovery: { codes: string[] } }>(verifyRes);
  if (!verifyBody.ok || !verifyBody.data) {
    throw new Error(`bootstrap verify failed: ${verifyRes.body}`);
  }

  return {
    userId,
    email,
    handle,
    password,
    totpSecret: enrollment.secret,
    sessionCookie: setCookieHeader(verifyRes),
    csrfToken: verifyBody.data.session.csrfToken,
    recoveryCodes: verifyBody.data.recovery.codes,
  };
}

/** Issues an invite (owner must already be authenticated) and accepts it as a manager. */
export async function issueAndAcceptInvite(
  app: FastifyInstance,
  owner: EnrolledAccount,
  overrides: Partial<{ email: string; handle: string; displayName: string; password: string }> = {},
): Promise<EnrolledAccount> {
  const email = overrides.email ?? "manager@example.test";
  const handle = overrides.handle ?? "manager";
  const displayName = overrides.displayName ?? "Manager Test";
  const password = overrides.password ?? "another very strong passphrase 1";

  const inviteRes = await app.inject({
    method: "POST",
    url: "/api/invites",
    headers: authHeaders(owner),
    payload: { email, role: "manager" },
  });
  const inviteBody = parseEnvelope<{ inviteUrl: string }>(inviteRes);
  if (!inviteBody.ok || !inviteBody.data) throw new Error(`invite failed: ${inviteRes.body}`);
  const token = inviteBody.data.inviteUrl.split("/invite/")[1]!;

  const acceptRes = await app.inject({
    method: "POST",
    url: `/api/invites/${token}/accept`,
    payload: { handle, displayName, password },
  });
  const acceptBody = parseEnvelope<{ userId: string; mfaToken: string; enrollment: EnrollmentChallenge }>(
    acceptRes,
  );
  if (!acceptBody.ok || !acceptBody.data) throw new Error(`accept failed: ${acceptRes.body}`);
  const { userId, mfaToken, enrollment } = acceptBody.data;
  const code = totpCodeFor(enrollment.secret, email);

  const verifyRes = await app.inject({
    method: "POST",
    url: "/api/invites/accept/verify",
    payload: { mfaToken, code },
  });
  const verifyBody = parseEnvelope<{ session: SessionInfo; recovery: { codes: string[] } }>(verifyRes);
  if (!verifyBody.ok || !verifyBody.data) throw new Error(`accept verify failed: ${verifyRes.body}`);

  return {
    userId,
    email,
    handle,
    password,
    totpSecret: enrollment.secret,
    sessionCookie: setCookieHeader(verifyRes),
    csrfToken: verifyBody.data.session.csrfToken,
    recoveryCodes: verifyBody.data.recovery.codes,
  };
}
