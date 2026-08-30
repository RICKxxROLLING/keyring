# Stoop — Operations Guide

**`BACKUP_PASSPHRASE` is the only key to every backup archive Stoop ever writes.
There is no escrow, no recovery, and no support ticket that gets it back.**
The moment you set it in `.env`, copy it into a password manager that lives
**off this box** (not a note in `/data`, not a file next to `docker-compose.yml`).
If you lose the passphrase, every archive you have is permanently unreadable —
not "hard to read," unreadable. If a backup ever runs without
`BACKUP_PASSPHRASE` set, the job fails loudly and writes **no** archive; it
never falls back to writing an unencrypted one.

---

## Contents

- [First-run setup](#first-run-setup)
- [Invite flow](#invite-flow)
- [Deployment topology](#deployment-topology)
- [Environment variables](#environment-variables)
- [Data layout](#data-layout)
- [Backups](#backups)
- [Restore](#restore)
- [Rotating `SESSION_SECRET`](#rotating-session_secret)
- [Health checks and monitoring](#health-checks-and-monitoring)
- [Running behind the Cloudflare Tunnel](#running-behind-the-cloudflare-tunnel)
- [Troubleshooting](#troubleshooting)

---

## First-run setup

1. Copy `.env.example` to `.env` and fill in at least `APP_ORIGIN`,
   `SESSION_SECRET`, and `BACKUP_PASSPHRASE`.
2. `docker compose up -d`.
3. On first boot, if you did **not** set `SETUP_TOKEN` yourself, Stoop
   generates one, logs it once, and writes it to `$DATA_DIR/setup-token.txt`
   (mode `0600`). Read it with:
   ```
   docker compose exec stoop cat /data/setup-token.txt
   ```
4. Visit `https://<your-tunnel-hostname>/setup` and enter the token. This
   creates the first account, which is always role `owner`.
5. You will be shown a QR code for TOTP enrollment and then **ten single-use
   recovery codes** — write these down somewhere durable before continuing.
   They are shown exactly once and are your escape hatch if you lose your
   authenticator device. (They do **not** help you recover a lost
   `BACKUP_PASSPHRASE` — that is a completely separate secret.)
6. The setup token is single-use. A second attempt to bootstrap returns
   `SETUP_ALREADY_DONE`.

## Invite flow

Stoop has no self-registration and no admin-created-password flow — the
**only** two ways a user account is ever created are the one-time bootstrap
above and accepting an invite:

1. Owner signs in, goes to `/admin`, issues an invite for an email + role
   (`owner` or `manager`). The invite link is shown once (`inviteUrl`) — copy
   it and send it to the person yourself; Stoop does not send email.
2. The invite is valid for `INVITE_TTL_HOURS` (default 72h) and single-use.
3. The invitee opens the link, sets a password, enrolls TOTP, and is shown
   their own ten recovery codes.
4. An owner can revoke an unaccepted invite from `/admin` at any time.

## Deployment topology

```
Internet ──HTTPS──> Cloudflare edge ──(outbound-only tunnel)── cloudflared ──HTTP── stoop
                                                                 (same compose
                                                                  network, no
                                                                  published port
                                                                  required)
```

`cloudflared` makes an **outbound** connection to Cloudflare; nothing needs to
be forwarded on your router, and your home/box IP is never exposed. The
`stoop` service's `ports:` mapping in `docker-compose.yml` is optional — it
only matters if you also want LAN access without going through the tunnel.
Once the tunnel is confirmed working, you can remove the `ports:` block
entirely (see `docker-compose.override.example.yml`) so nothing is reachable
except through Cloudflare.

Setting up the tunnel itself (outside Stoop's scope): create a tunnel in the
Cloudflare Zero Trust dashboard, point a public hostname at
`http://stoop:8080` (the compose service name and container port — this is
resolved on the compose-internal network, not the host), and put the
connector token in `.env` as `TUNNEL_TOKEN`.

## Environment variables

Every variable Stoop reads is listed in `.env.example` with a default and a
comment. The ones that matter most for this deployment:

| Variable | Why it matters here |
|---|---|
| `APP_ORIGIN` | Must be the real `https://` tunnel hostname. Drives `Secure` cookies, HSTS, and the WebSocket `Origin` check — get this wrong and either cookies won't stick or the app will refuse the origin. |
| `TRUST_PROXY` | **`loopback,uniquelocal` by default** — believe `X-Forwarded-For` only when the immediate peer is on loopback or an RFC1918/ULA range, i.e. the `cloudflared` sidecar on the Docker network. Do **not** set this to `true`: that trusts the whole chain, making `req.ip` the leftmost `X-Forwarded-For` value — a header the *client* writes. Both rate limiters key on `req.ip`, so `true` lets anyone defeat them by rotating one header, and makes every `audit_log.ip` forgeable. Do **not** set a hop count either: this Fastify version deliberately fails closed on a numeric value ("hop-count-only trust cannot validate the immediate peer"), so a number trusts *nothing* and collapses every request onto the sidecar's own address — the app treats a bare number as a misconfiguration and falls back to the default. Accepts IPs, CIDR ranges, and the presets `loopback`, `linklocal`, `uniquelocal`, comma-separated. `GET /api/ops/info` and the request logs show the resolved client IP, so a misconfiguration is visible immediately — check that a request from your own machine doesn't show up as `cloudflared`'s or Cloudflare's own address. |
| `SESSION_SECRET` | ≥32 random characters, required in production. Treat it as a secret. |
| `BACKUP_PASSPHRASE` | The one thing this whole document keeps repeating. |
| `PUID` / `PGID` | Set to match the Unraid user that should own `/data` on disk (defaults `99`/`100` — Unraid's `nobody`/`users`). |
| `APP_TIMEZONE` | Business dates (lease dates, due dates) and job schedule times (`BACKUP_AT`, PM generation, rent roll) are all evaluated in this timezone. |

## Data layout

Everything persistent lives under the single bind-mounted `/data`:

```
/data/stoop.db          SQLite database, WAL mode
/data/stoop.db-wal      write-ahead log (grows and checkpoints automatically)
/data/stoop.db-shm      shared memory index for the WAL
/data/uploads/          lease PDFs, photos — never served as static files
/data/backups/          encrypted nightly archives (see below)
/data/setup-token.txt   one-time bootstrap token (0600), deleted logically once consumed
```

Back up (or snapshot) `/data` at the filesystem level if you like, but the
supported, verified restore path is the encrypted archive described below —
that's the one this document proves actually works.

## Backups

- A backup runs automatically every day at `BACKUP_AT` (local `APP_TIMEZONE`,
  default `03:15`), and on demand from `/admin` (owner only) or
  `POST /api/ops/backups`.
- The database is snapshotted with SQLite's `VACUUM INTO`, **not** a file
  copy — this produces a consistent, WAL-checkpointed copy without stopping
  writes and without any risk of copying a torn WAL.
- The snapshot plus `/data/uploads` are streamed through `tar` → `gzip` →
  `AES-256-GCM` (key derived from `BACKUP_PASSPHRASE` via scrypt) straight to
  `stoop-<YYYYMMDD>-<HHmmss>.tar.gz.enc` in `/data/backups`. The exact byte
  layout is pinned in `docs/RESTORE.md` and in the design contract, so restore
  never has to guess the format.
- Every run — success or failure — is recorded as a row visible at
  `/admin` → Backups, and via `GET /api/ops/info` / `GET /api/ops/backups`.
- Retention: archives older than `BACKUP_RETENTION_DAYS` (default 14) are
  deleted automatically, **except** the newest 3 are always kept regardless
  of age.
- **Without `BACKUP_PASSPHRASE` set, the job fails loudly** (a `failed` run,
  with an error message telling you exactly why) and writes no file at all.
  It will never silently write a plaintext archive.
- `POST /api/ops/backups/verify` (owner only, also reachable from `/admin`)
  decrypts an archive into a throwaway temp directory, runs
  `PRAGMA integrity_check` on the extracted database, and deletes the temp
  directory afterward — a quick, automated way to prove an archive is still
  good without doing a full restore.

Point `BACKUP_DIR` (via the bind mount) at storage that is physically
separate from the volume holding `/data/stoop.db` if you want backups to
survive the loss of that volume — e.g. a different Unraid array share, or a
mounted network location.

## Restore

See **`docs/RESTORE.md`** for the exact, executable procedure and its output.
The short version:

```
docker compose stop stoop
docker compose run --rm stoop sh -c '
  set -e
  npm run restore:prod -- --archive /data/backups/stoop-<ts>.tar.gz.enc \
                          --out /tmp/restore-scratch
  # review the printed integrity check and row counts before the copy below
  cp /tmp/restore-scratch/stoop.db /data/stoop.db
  rm -f /data/stoop.db-wal /data/stoop.db-shm
  rm -rf /data/uploads && cp -a /tmp/restore-scratch/uploads /data/uploads
'
docker compose start stoop
```

Note `restore:prod`, not `restore`: the runtime image prunes devDependencies,
so `tsx` is absent and the `:prod` scripts run the compiled `dist/` build
instead. `rsync` is not installed in the image either — hence `cp -a`.
`docs/RESTORE.md` gives the safer two-pass version, where you read the
integrity report before anything overwrites `/data`.

"We have backups" and "we have restored a backup" are different claims —
`docs/RESTORE.md` exists specifically to make the second one true, with real
output, not just a written procedure.

## Rotating `SESSION_SECRET`

Rotating `SESSION_SECRET` invalidates every existing session cookie — every
signed-in user (all three of you) will be signed out and have to log in
again. TOTP enrollment and recovery codes are unaffected (they are not
derived from `SESSION_SECRET`).

1. Generate a new value: `openssl rand -base64 48`.
2. Update `SESSION_SECRET` in `.env`.
3. `docker compose up -d` (recreates the `stoop` container with the new env).
4. Everyone logs back in.

Rotate it if you suspect a session cookie leaked, after removing a manager
who might have captured one, or on whatever periodic cadence you're
comfortable with — there's no forced expiry beyond `SESSION_TTL_HOURS`.

## Health checks and monitoring

- `GET /healthz` is public, requires no session, and is the one endpoint that
  does **not** use the `{ok, data}` envelope — it returns a bare
  `HealthPayload` JSON object so Docker's `HEALTHCHECK` (and any external
  uptime monitor) can read it directly. `200` when the database answers
  `SELECT 1` and migrations have been applied; `503` otherwise.
- `docker compose ps` shows the container's health status once
  `HEALTHCHECK` has had time to run (`start_period: 20s`).
- `GET /api/ops/info` (owner only) reports the SQLite journal mode (should
  always read `wal`), database and WAL file sizes, upload count/bytes, and
  the most recent backup run — a fast way to eyeball that everything is
  healthy without SSHing in.

## Running behind the Cloudflare Tunnel

- `TRUST_PROXY=loopback,uniquelocal` (the default) tells Fastify to believe
  `X-Forwarded-For` **only when the immediate peer is on a private or loopback
  address** — which the `cloudflared` sidecar is, on the Docker bridge network.
  So `req.ip` (used for rate limiting, lockouts, and audit-log IPs) resolves to
  the real client address instead of `cloudflared`'s own, and a client out on
  the internet cannot get a forged header believed, because it cannot connect
  from a private address.

  > **Do not set this to `true`.** `true` means "trust every address in the
  > chain", and `proxy-addr` then resolves `req.ip` to the **leftmost**
  > `X-Forwarded-For` entry — which is written by the client, not by
  > cloudflared. On a public hostname that hands any caller control of
  > `req.ip`: both rate limiters are defeated by rotating one header, and
  > every IP recorded in the audit log becomes forgeable.
  >
  > **Do not set a hop count either.** This Fastify version deliberately fails
  > closed on a numeric `trustProxy` — its own comment reads "hop-count-only
  > trust cannot validate the immediate peer" — so a number trusts *nothing*,
  > and every request is attributed to the sidecar's address. That is the
  > opposite failure: rate limiting and lockout become global, and one bad
  > actor can lock out all three users. The app treats a bare number as a
  > misconfiguration and falls back to the default.
  >
  > If you put another proxy in front of cloudflared, add its address or range
  > to the list (`loopback,uniquelocal,203.0.113.4`) rather than counting hops.
- `APP_ORIGIN` must be the `https://` hostname you configured in the tunnel.
  This makes `SECURE_COOKIES` true automatically, which makes the session
  cookie `Secure` (browsers will not send it over plain HTTP) and turns on
  HSTS.
- The WebSocket (`/ws`) rides the same origin, same port, same cookie as the
  rest of the app — no extra tunnel configuration is needed for realtime to
  work once HTTP works.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Every request looks like it comes from the same IP in the audit log | `TRUST_PROXY` misconfigured, or the tunnel isn't actually the only path in. Check `GET /api/ops/info` and compare against a request from a known IP. |
| Cookies don't persist / user is logged out every request | `APP_ORIGIN` isn't `https://`, so `SECURE_COOKIES` is false and the browser (correctly) won't send a `Secure` cookie over your `https://` tunnel origin mismatch. Fix `APP_ORIGIN`. |
| `docker compose ps` shows `stoop` unhealthy | Check `docker compose logs stoop` — most often a migration failure (immutable-migration checksum mismatch — never hand-edit an applied `.sql` file) or the volume not being writable by `PUID:PGID`. |
| Backups show `status: failed` with a `BACKUP_PASSPHRASE` error | Exactly as designed — set `BACKUP_PASSPHRASE` in `.env` and recreate the container. |
| TOTP codes are rejected even though they look right | Host clock drift. Stoop allows ±1 step (±30s) of skew; make sure the Unraid host has NTP working. |
