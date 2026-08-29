# Stoop — Security Notes

Stoop holds tenant PII (names, phone numbers, emails, emergency contacts),
lease PDFs, gate/lockbox codes, and financial records for a small property
portfolio, and is deliberately made reachable from the public internet
through a Cloudflare Tunnel. This document describes the defenses in place
and where the sharp edges are.

## Network exposure

- **No inbound ports.** The Cloudflare Tunnel (`cloudflared`) makes an
  outbound-only connection out to Cloudflare's edge; nothing is forwarded on
  your router and your home/box IP is never exposed to the internet. The
  `stoop` container's own published port (if you keep it) is for LAN access
  only.
- **Origin protection.** `APP_ORIGIN` pins the expected public hostname;
  `helmet`'s CSP (`frame-ancestors 'none'`, `base-uri 'none'`, no
  `unsafe-eval`), HSTS (when `SECURE_COOKIES` is true), and the WebSocket
  handshake's `Origin` check all key off it.

## Authentication and accounts

- **Invite-only, no self-registration.** The only two routes that ever
  create a user are the one-time bootstrap (`/api/setup/bootstrap`) and
  invite acceptance (`/api/invites/:token/accept`). There is no
  `POST /api/users`.
- **Password + mandatory TOTP.** Every account requires TOTP (`otpauth`,
  RFC 6238, ±1 step / ±30s clock skew tolerance). Login is two-step:
  password success returns only a short-lived `mfaToken` (10 minutes, 5
  verification attempts, then burned) — never a session cookie — and the
  session is issued only after the TOTP (or a one-time recovery code) step
  succeeds.
- **Passwords hashed with argon2id** (`@node-rs/argon2`, memory cost
  ≥ 19,456 KiB, time cost ≥ 2). No plaintext or reversible password material
  is ever stored or logged.
- **Ten single-use recovery codes**, stored hashed, shown exactly once at
  enrollment. They are the escape hatch for a lost authenticator device —
  they are unrelated to `BACKUP_PASSPHRASE` and cannot recover a backup.
- **Opaque, server-side, revocable sessions.** Not JWTs — a compromised or
  no-longer-trusted session can be killed immediately (deactivating a user
  revokes theirs) instead of having to wait out an expiry.
- **Rate limiting and lockout.** Auth endpoints are limited to 10
  requests / 5 minutes per IP and 5 failures / 15 minutes per account key;
  past that, a `lockouts` row blocks the key for `AUTH_LOCKOUT_MINUTES` and
  the endpoint returns `423 LOCKED_OUT`. A global limiter caps every IP at
  `RATE_LIMIT_MAX` requests/minute. Keying is on `req.ip`, which is only
  correct when `TRUST_PROXY` is configured correctly for the deployment —
  see `docs/OPERATIONS.md`.

## Session and CSRF

- Cookies: `stoop_session` is `HttpOnly`, `Secure` when `APP_ORIGIN` is
  `https://`, `SameSite=Lax`. `stoop_csrf` is readable by JS with the same
  lifetime.
- Every non-`GET` request must carry `X-CSRF-Token` matching the
  `stoop_csrf` cookie (double-submit pattern) — a session cookie alone is
  never enough to mutate anything.

## Authorization

- Two roles: `owner` and `manager`. There is no per-property ACL — all
  managers see all properties, by design (three people jointly managing five
  properties). `owner`-only actions: invites, user management, TOTP reset
  for another user, and **every** `/api/ops/*` backup/restore endpoint.
- `/healthz` is the only public, unauthenticated route in the whole API
  surface, and it leaks nothing beyond process health.

## Uploads

- Content-type is attacker-controlled and never trusted: the first bytes of
  every upload are checked against a magic-number allowlist (JPEG, PNG,
  WebP, HEIC, PDF). SVG is explicitly rejected (script-capable).
- **Every image is re-encoded through `sharp`** (auto-rotate, strip all
  metadata, cap the long edge at 4000px) before it is ever stored — this
  strips EXIF payloads and destroys polyglot files; a re-encode failure
  itself is the rejection (`415`).
- PDFs are stored byte-for-byte and served with
  `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, and
  `Content-Security-Policy: sandbox` — they cannot render inline or execute
  script in the app's origin.
- Stored filenames are **server-generated** (`<uploadId>.<ext>`), never
  derived from the client-supplied name, so there is no path-traversal
  surface from an upload's filename.
- Files are served only through an authenticated handler
  (`GET /api/uploads/:id/raw`/`/thumb`) that streams from outside any static
  root — never as a static file — so there is no way to enumerate or fetch
  an upload without a valid session.

## Secrets in the spec vault

Gate codes, utility account numbers, and similar values can be flagged
`isSecret`. Masked values (`value: null, valueMasked: true`) are returned
from every list and read endpoint; only `POST /api/specs/:id/reveal`
returns the plaintext, and doing so writes an audit row
(`secret_revealed`). The revealed value never appears in `before`/`after`
audit payloads, application logs, the search index, or any realtime frame.

## Audit log

Every create/update/delete of every entity writes an immutable audit row
(`server/audit/audit.ts`) inside the same transaction as the mutation — if
the transaction rolls back, so does the audit entry. There is no code path
that updates or deletes an `audit_log` row: deletions of entities produce a
`delete` audit row, they never erase history. Sensitive fields
(`password_hash`, `totp_secret`, `token_hash`, `csrf_token`, etc.) are
redacted before the row is written, never merely on read.

## Backups

**`BACKUP_PASSPHRASE` is the only key to every archive Stoop writes.** See
`docs/OPERATIONS.md` for the operational rules; the cryptographic details:

- The database half of the archive is a `VACUUM INTO` snapshot — a
  consistent, point-in-time copy taken without stopping writes — never a raw
  copy of the live (and possibly WAL-in-flight) `.db` file.
- The archive is `tar(stoop.db + uploads/) → gzip → AES-256-GCM`, with a
  16-byte scrypt salt (`N=2^15, r=8, p=1`), a 12-byte GCM IV, and a 16-byte
  GCM authentication tag, in the pinned layout documented in
  `docs/RESTORE.md`. GCM's authentication tag means a wrong passphrase and a
  corrupted archive fail identically and loudly at decrypt time — there is
  no way to "partially" decrypt with the wrong key and get plausible-looking
  garbage.
- Without `BACKUP_PASSPHRASE` set, the backup job fails the run and writes
  **no** file — never an unencrypted fallback.
- `POST /api/ops/backups/verify` (owner-only) decrypts and integrity-checks
  an archive in a temp directory that is always removed afterward, whether
  the verification succeeds or fails.

## Logging

`server/lib/logger.ts` never logs passwords, TOTP secrets/codes, recovery
codes, session tokens, invite tokens, `BACKUP_PASSPHRASE`, `SESSION_SECRET`,
tenant email/phone, or upload contents (`server/app.ts`'s Fastify logger
config redacts the relevant request fields at the framework level too).

## Known limitations / things to watch

- **There is no MFA recovery beyond the ten codes and an owner-triggered
  TOTP reset.** If a lone owner loses both their authenticator and every
  recovery code, the only way back in is direct database access on the box.
- **Rate limiting is IP-based**, which is only as good as `TRUST_PROXY`
  being configured correctly — see `docs/OPERATIONS.md`'s troubleshooting
  table.
- **No WAF / DDoS protection beyond what Cloudflare's edge provides for
  free** on the tunnel path. This is judged proportionate to a 3-user
  internal tool, not a public-facing product.
