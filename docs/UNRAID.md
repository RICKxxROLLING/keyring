# Running on Unraid with Docker Compose Manager

For a plain `docker compose up -d --build` from a checkout, see the README.
This guide is specifically for the **Docker Compose Manager** plugin.

## Why the build context needs pointing somewhere

Compose Manager stores each stack on the **flash drive**, at
`/boot/config/plugins/compose.manager/projects/<name>/`. That is a small, slow
USB device, and it is not where you want a Node build with `node_modules` and a
native compile of `better-sqlite3` and `sharp` to happen.

So the source lives on the array and the stack points at it. The compose file's
build context is `${STOOP_SRC:-.}` for exactly this reason.

---

## 1. Put the source on the array

Copy the deploy archive to your server and extract it. Over SMB from Windows,
`\\TOWER\appdata\` is usually mapped already; adjust the share name to match
yours. From a terminal on the server:

```bash
mkdir -p /mnt/user/appdata/stoop/src
cd /mnt/user/appdata/stoop/src
tar -xzf /path/to/keyring-deploy.tar.gz
ls Dockerfile docker-compose.yml package.json    # sanity check
```

Two directories, deliberately separate:

| Path | Holds | Backed up? |
|---|---|---|
| `/mnt/user/appdata/stoop/src` | Source code. Disposable — replace it to upgrade. | No need |
| `/mnt/user/appdata/stoop/data` | The database, uploads, backups, setup token. | **Yes. This is everything.** |

Make sure the data directory exists and is owned correctly:

```bash
mkdir -p /mnt/user/appdata/stoop/data
chown -R 99:100 /mnt/user/appdata/stoop/data
```

99:100 is `nobody:users`, Unraid's default. The container entrypoint will fix
ownership itself on first boot, but doing it now avoids a slow first start.

---

## 2. Create the stack

In the Unraid UI: **Docker → Compose → Add New Stack**, name it `stoop`.

Click **Edit Stack** and paste the contents of `docker-compose.yml` from the
source you just extracted. Do not retype it — copy the file verbatim so the
health check and `depends_on` conditions come across intact.

---

## 3. Fill in the environment

Click **Edit .env** on the stack (Compose Manager writes it into the project
directory next to the compose file, which is exactly where Compose looks).

Paste the contents of `.env.example` from the source, then set these. The first
four are required; the last two are what make Compose Manager work.

| Variable | Value |
|---|---|
| `APP_ORIGIN` | Your public tunnel hostname, e.g. `https://stoop.example.com`. Drives Secure cookies, HSTS, and the WebSocket origin check — wrong value means the app won't work over the tunnel. |
| `SESSION_SECRET` | 32+ random characters. `openssl rand -base64 48` |
| `BACKUP_PASSPHRASE` | A strong passphrase. **Put it in a password manager off this box before you continue.** There is no escrow — lose it and every backup you ever take is permanently unreadable. |
| `TUNNEL_TOKEN` | Cloudflare Zero Trust → Networks → Tunnels → your tunnel → install connector → copy token. |
| `STOOP_SRC` | `/mnt/user/appdata/stoop/src` — the build context. |
| `STOOP_DATA_DIR` | `/mnt/user/appdata/stoop/data` — the bind mount for `/data`. |

Leave `PUID=99` / `PGID=100` unless your Unraid setup differs.

`SETUP_TOKEN` stays unset. The app generates one on first boot.

---

## 4. Build and start

**Compose Up** in the plugin UI, or from a terminal:

```bash
cd /boot/config/plugins/compose.manager/projects/stoop
docker compose up -d --build
```

The first build takes several minutes — it compiles `better-sqlite3` and
`sharp` natively for your CPU. That native build is the reason to build here
rather than shipping a prebuilt image from a dev machine.

Check it came up:

```bash
docker compose ps
docker compose logs stoop | tail -40
```

You want `stoop` healthy and the log showing migrations applied on first boot.
`cloudflared` waits for `stoop` to report healthy before it starts, so if the
tunnel container is not running yet, look at the app's health first.

---

## 5. First login

First boot writes a one-time setup token:

```bash
cat /mnt/user/appdata/stoop/data/setup-token.txt
```

Visit `https://<your-tunnel-hostname>/setup`, paste the token, and create the
owner account. You will be asked to enroll TOTP immediately and shown ten
recovery codes **once** — save them somewhere real before clicking past.

From there, invite your other two managers from `/admin`. There is no
registration page; invite is the only way an account gets created.

Load demo data if you want something to look at:

```bash
docker compose exec stoop npm run seed:prod
```

Note `seed:prod`, not `seed`. The runtime image drops devDependencies, so the
`tsx`-based scripts are not present — every maintenance command has a `:prod`
variant that runs the compiled build. Same for `migrate:prod`, `backup:prod`
and `restore:prod`.

---

## Upgrading later

```bash
cd /mnt/user/appdata/stoop/src
rm -rf ./*                       # source only — never touch ../data
tar -xzf /path/to/new-archive.tar.gz
cd /boot/config/plugins/compose.manager/projects/stoop
docker compose up -d --build
```

Migrations run automatically at boot. Take a backup first:

```bash
docker compose exec stoop npm run backup:prod
```

---

## Troubleshooting

**Build fails compiling `better-sqlite3` or `sharp`.** These are the only two
native modules. The image is `node:24-bookworm-slim` and both ship prebuilds
for linux/amd64 and linux/arm64, so a failure here usually means a network
problem reaching the prebuild host, not a real compile issue. Re-run the build.

**Container is unhealthy.** `docker compose logs stoop`. The health check hits
`GET /healthz` internally and allows a 20s start period for migrations. A
persistent 503 means the database could not be opened — check that
`STOOP_DATA_DIR` exists and is owned by `PUID:PGID`.

**Tunnel connects but the app misbehaves — login loops, WebSocket won't
connect.** Almost always `APP_ORIGIN` not exactly matching the public URL,
scheme included. It gates Secure cookies and the WebSocket origin check.

**Everyone gets rate-limited or locked out at once.** `TRUST_PROXY` is wrong,
so every request looks like it comes from the tunnel's own address. It should
be `true` behind cloudflared. `GET /api/ops/info` (owner only) shows the
resolved client IP, which makes this obvious in seconds.

**Ownership problems on `/data`.** The entrypoint chowns it only when the
current owner differs from `PUID:PGID`, so it will not walk thousands of upload
files on every boot. If you change `PUID`/`PGID` later, expect one slow start.
