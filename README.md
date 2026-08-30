# Stoop

Self-hosted, collaborative property management for a small portfolio — built
for 2-3 people jointly managing a handful of properties from their phones.
One Docker image, one SQLite database, realtime collaboration over a single
WebSocket, and a Cloudflare Tunnel in front so nothing needs to be forwarded
on your router.

> **Before you deploy:** read `docs/OPERATIONS.md`, specifically the first
> paragraph. `BACKUP_PASSPHRASE` is the only key to every backup this app
> ever writes — there is no recovery if you lose it.

## What's here

- Portfolio dashboard with a cross-property "needs attention" feed.
- Per-property dossier: notes, maintenance (work orders + recurring PM),
  projects, tenants & leases, rent roll & expenses, vendors, a spec vault
  (with maskable secrets like gate codes), compliance & renewal dates,
  turnover checklists, files, and a full audit timeline.
- Realtime presence, soft field locks with live keystream streaming, and
  push notifications — three people editing the same portfolio without
  stepping on each other.
- Invite-only accounts, password + mandatory TOTP, opaque revocable
  sessions, full audit log.
- Installable PWA with a small offline read cache.
- Encrypted, automated nightly backups with a verified, executable restore
  path.

## Stack

TypeScript end to end, one Node process. Fastify + `better-sqlite3` (WAL
mode) on the server; React + Vite + TanStack Query + Tailwind on the client;
a raw WebSocket for realtime. See `docs/SECURITY.md` for the security model
and `docs/OPERATIONS.md` for how it's run in production. Full architectural
rationale lives in the project's design document (not shipped in this repo).

## Running it

### Production (Docker — the supported path)

```
cp .env.example .env    # fill in APP_ORIGIN, SESSION_SECRET, BACKUP_PASSPHRASE, TUNNEL_TOKEN
docker compose up -d
docker compose ps
```

This brings up two containers:

- `stoop` — the app itself. All state lives under one bind-mounted `/data`
  (`stoop.db`, `uploads/`, `backups/`, `setup-token.txt`). Config is 100% env
  vars — see `.env.example` for every variable, with defaults and comments.
  Runs as a non-root user (Unraid `PUID`/`PGID` convention). Ships a
  `HEALTHCHECK` against `GET /healthz`.
- `cloudflared` — the Cloudflare Tunnel sidecar. Makes an **outbound-only**
  connection to Cloudflare; no inbound port needs to be opened on your
  router, and your home/box IP is never exposed. The `stoop` service's own
  published port is optional (LAN access only) — see
  `docker-compose.override.example.yml` to drop it once the tunnel works.

First boot generates a one-time setup token (or reads `SETUP_TOKEN` if you
set one), logs it once, and writes it to `$DATA_DIR/setup-token.txt`
(mode `0600`). Visit `/setup` with that token to create the first (owner)
account. From there, the owner invites everyone else from `/admin` — there
is no other way to create an account.

Full first-run walkthrough, the invite flow, every env var, the backup and
restore runbook, and how to rotate `SESSION_SECRET`: **`docs/OPERATIONS.md`**.

### Local development

Requires Node 24+.

```
npm install
npm run dev        # concurrently runs the API (tsx watch) and Vite dev server
```

`npm run dev:api` alone starts just the Fastify server (port 8080);
`npm run dev:web` alone starts just Vite (port 5173, proxies `/api`, `/ws`,
`/healthz` to 8080). `npm run seed` populates a representative demo
portfolio.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | API + web, both in watch mode |
| `npm run build` | Production build: `dist/public` (web) + `dist/server` (server) |
| `npm start` | Runs the built server (`dist/server/server/index.js`) |
| `npm run migrate` | Applies any pending `server/db/migrations/*.sql` |
| `npm run seed` | Populates a demo portfolio (5 properties) |
| `npm run backup -- --run` | Runs one encrypted backup immediately |
| `npm run restore -- --archive <path> --out <dir>` | Decrypts + extracts + integrity-checks an archive (see `docs/RESTORE.md`) |
| `npm run lint` / `npm run typecheck` / `npm test` | The three-part CI gate |
| `npm run check` | All three, in order |

**Inside the Docker container, use the `:prod` variants** — `migrate:prod`,
`seed:prod`, `backup:prod`, `restore:prod`. The four scripts above run
TypeScript through `tsx`, which is a devDependency, and the runtime image runs
`npm prune --omit=dev`; the `:prod` scripts run the compiled `dist/` build
instead. For example, to load demo data into a fresh deployment:

```
docker compose exec stoop npm run seed:prod
```

## Repository layout

```
server/     Fastify API: auth, realtime, domain modules, ops/backups
shared/     Types and wire-protocol shapes imported by both server and web
web/        React SPA (dashboard, dossier, admin, PWA shell)
docker/     Container entrypoint + healthcheck script
docs/       OPERATIONS.md, RESTORE.md, SECURITY.md
```

## Documentation

- **`docs/OPERATIONS.md`** — first-run setup, the invite flow, every env
  var, the backup/restore runbook, and how to rotate `SESSION_SECRET`. Start
  here for anything about running this in production.
- **`docs/RESTORE.md`** — the restore procedure, actually executed, with
  real output: `PRAGMA integrity_check`, row counts, upload counts, and what
  a wrong passphrase looks like when it fails.
- **`docs/SECURITY.md`** — the threat model and the specific defenses in
  place for each part of it (auth, uploads, secrets, backups, logging).
