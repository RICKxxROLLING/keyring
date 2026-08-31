# Running on Unraid with Docker Compose Manager

For a plain `docker compose up -d --build` from a checkout, see the README.
This guide is specifically for the **Docker Compose Manager** plugin.

## Why the build context needs pointing somewhere

Compose Manager stores each stack on the **flash drive**, at
`/boot/config/plugins/compose.manager/projects/<name>/`. That is a small, slow
USB device, and it is not where you want a Node build with `node_modules` and a
native compile of `better-sqlite3` and `sharp` to happen.

So the source lives on the array and the stack points at it. The compose file's
build context is `${KEYRING_SRC:-.}` for exactly this reason.

---

## 1. Put the source on the array

### Option A — clone from GitHub (recommended; makes updates one command)

(You only need a local clone if you want to build from source or run a local
change — the normal update path is the registry image, above.)

Two Unraid facts shape this:

- **Unraid does not ship `git`.** You can add it with the Nerd Tools plugin, but
  you do not need to — run git from a throwaway container instead, which works
  on any Unraid version and leaves nothing installed.
- **A private repo needs a credential.** Create a **fine-grained personal access
  token** at GitHub → Settings → Developer settings → Personal access tokens →
  Fine-grained tokens. Scope it to *only this repository*, with
  **Contents: Read-only**. Nothing else. Give it a short expiry.

Open an Unraid terminal (web UI → the `>_` icon, or SSH) and clone:

```bash
mkdir -p /mnt/user/appdata/keyring
cd /mnt/user/appdata/keyring

docker run --rm -it -v /mnt/user/appdata/keyring:/out alpine/git \
  clone https://github.com/YOUR-USERNAME/keyring.git /out/src
```

It will prompt for a username and password. Username is your GitHub username;
**paste the token as the password** — not your account password.

> **Token hygiene.** Do not embed the token in the URL
> (`https://token@github.com/...`): git stores the remote URL in
> `src/.git/config` in plain text, so the token ends up sitting on your array
> indefinitely. Letting it prompt keeps the token out of the repo, out of
> `.git/config`, and out of your shell history.

If the repo is public, drop the prompt entirely — the same command just works.

### Option B — copy an archive over SMB

No token, no GitHub access needed on the server. Extract the deploy archive to
`/mnt/user/appdata/keyring/src`. Over SMB from Windows, `\\TOWER\appdata\` is
usually mapped already; adjust the share name to match yours. From a terminal
on the server:

```bash
mkdir -p /mnt/user/appdata/keyring/src
cd /mnt/user/appdata/keyring/src
tar -xzf /path/to/keyring-deploy.tar.gz
ls Dockerfile docker-compose.yml package.json    # sanity check
```

Two directories, deliberately separate:

| Path | Holds | Backed up? |
|---|---|---|
| `/mnt/user/appdata/keyring/src` | Source code. Disposable — replace it to upgrade. | No need |
| `/mnt/user/appdata/keyring/data` | The database, uploads, backups, setup token. | **Yes. This is everything.** |

Make sure the data directory exists and is owned correctly:

```bash
mkdir -p /mnt/user/appdata/keyring/data
chown -R 99:100 /mnt/user/appdata/keyring/data
```

99:100 is `nobody:users`, Unraid's default. The container entrypoint will fix
ownership itself on first boot, but doing it now avoids a slow first start.

---

## 2. Create the stack

In the Unraid UI: **Docker → Compose → Add New Stack**, name it `keyring`.

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
| `APP_ORIGIN` | Your public tunnel hostname, e.g. `https://keyring.example.com`. Drives Secure cookies, HSTS, and the WebSocket origin check — wrong value means the app won't work over the tunnel. |
| `SESSION_SECRET` | 32+ random characters. `openssl rand -base64 48` |
| `BACKUP_PASSPHRASE` | A strong passphrase. **Put it in a password manager off this box before you continue.** There is no escrow — lose it and every backup you ever take is permanently unreadable. |
| `TUNNEL_TOKEN` | Cloudflare Zero Trust → Networks → Tunnels → your tunnel → install connector → copy token. |
| `KEYRING_SRC` | `/mnt/user/appdata/keyring/src` — the build context. |
| `KEYRING_DATA_DIR` | `/mnt/user/appdata/keyring/data` — the bind mount for `/data`. |

Leave `PUID=99` / `PGID=100` unless your Unraid setup differs.

`SETUP_TOKEN` stays unset. The app generates one on first boot.

---

## 4. Build and start

**Compose Up** in the plugin UI, or from a terminal:

```bash
cd /boot/config/plugins/compose.manager/projects/keyring
docker compose up -d --build
```

The first build takes several minutes — it compiles `better-sqlite3` and
`sharp` natively for your CPU. That native build is the reason to build here
rather than shipping a prebuilt image from a dev machine.

Check it came up:

```bash
docker compose ps
docker compose logs keyring | tail -40
```

You want `keyring` healthy and the log showing migrations applied on first boot.
`cloudflared` waits for `keyring` to report healthy before it starts, so if the
tunnel container is not running yet, look at the app's health first.

---

## 5. First login

First boot writes a one-time setup token:

```bash
cat /mnt/user/appdata/keyring/data/setup-token.txt
```

Visit `https://<your-tunnel-hostname>/setup`, paste the token, and create the
owner account. You will be asked to enroll TOTP immediately and shown ten
recovery codes **once** — save them somewhere real before clicking past.

From there, invite your other two managers from `/admin`. There is no
registration page; invite is the only way an account gets created.

Load demo data if you want something to look at:

```bash
docker compose exec -u 99:100 keyring npm run seed:prod
```

Note `seed:prod`, not `seed`. The runtime image drops devDependencies, so the
`tsx`-based scripts are not present — every maintenance command has a `:prod`
variant that runs the compiled build. Same for `migrate:prod`, `backup:prod`
and `restore:prod`.

---

## Upgrading later

```bash
cd /mnt/user/appdata/keyring/src
rm -rf ./*                       # source only — never touch ../data
tar -xzf /path/to/new-archive.tar.gz
cd /boot/config/plugins/compose.manager/projects/keyring
docker compose up -d --build
```

Migrations run automatically at boot. Take a backup first:

```bash
docker compose exec -u 99:100 keyring npm run backup:prod
```

---

## Troubleshooting

**Build fails compiling `better-sqlite3` or `sharp`.** These are the only two
native modules. The image is `node:24-bookworm-slim` and both ship prebuilds
for linux/amd64 and linux/arm64, so a failure here usually means a network
problem reaching the prebuild host, not a real compile issue. Re-run the build.

**Container is unhealthy.** `docker compose logs keyring`. The health check hits
`GET /healthz` internally and allows a 20s start period for migrations. A
persistent 503 means the database could not be opened — check that
`KEYRING_DATA_DIR` exists and is owned by `PUID:PGID`.

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

---

## Ready-made stack files

`docker/unraid/` in this repo holds two files sized for copy-paste into the
Compose Manager UI, so you do not have to adapt the root `docker-compose.yml`
by hand:

| File | Paste into |
|---|---|
| `docker/unraid/docker-compose.stack.yml` | **Edit Stack** |
| `docker/unraid/stack.env` | **Edit .env** |

The stack file differs from the repo's root compose in one way that matters:
its build context is the absolute path `/mnt/user/appdata/keyring/src`, so the
stack can live on the flash drive while the build happens on the array.

`cloudflared` ships **commented out**. Bring the app up on your LAN first and
confirm it works, then uncomment it and switch `APP_ORIGIN` to the https
hostname. Two stages means a failure tells you whether it was the app or
Cloudflare, instead of leaving you guessing.

Fill in the four values marked `CHANGE ME` in `stack.env`: `APP_ORIGIN`,
`SESSION_SECRET`, `BACKUP_PASSPHRASE`, and (later) `TUNNEL_TOKEN`.

---

## Troubleshooting: "the container is healthy but nothing loads"

Almost always the **published port and `APP_ORIGIN` disagree**. `KEYRING_PORT` is
what Docker publishes; the port inside `APP_ORIGIN` is only what the app
believes its own URL is. Change one and not the other and you browse a port
nothing is listening on, while the container reports healthy — because it is
healthy, on a different port.

Ask Docker what is actually published, rather than reading the compose file:

```bash
docker inspect keyring --format '{{json .HostConfig.PortBindings}}'
```

`{"8080/tcp":[{"HostPort":"8088"}]}` means the app is on `:8088`, whatever
`APP_ORIGIN` says. Fix `.env` so both agree, then **recreate** — port bindings
are fixed at container creation, so a restart will not pick up the change:

```bash
docker compose up -d --force-recreate keyring
```

### Where Compose Manager keeps things

The plugin uses **`compose.yaml`**, not `docker-compose.yml`, under
`/boot/config/plugins/compose.manager/projects/<stack>/`, alongside the `.env`
it writes. If you are ever unsure which file is live, ask the container — it
records the file it was created from:

```bash
docker inspect keyring --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}'
```

---

## Troubleshooting: uploads fail with EACCES

```
EACCES: permission denied, open '/data/uploads/2026/08/upl_....thumb.webp'
```

Something wrote into `/data` **as root**, and the app runs as `PUID:PGID`
(99:100 by default), so it cannot write into what root created.

The usual cause is a maintenance command run without `-u`:

```bash
docker compose exec keyring npm run seed:prod        # WRONG — runs as root
docker compose exec -u 99:100 keyring npm run seed:prod   # right
```

`docker exec` does not pass through the entrypoint, so the `gosu` drop to
`PUID:PGID` never happens for it.

Fix ownership and restart:

```bash
chown -R 99:100 /mnt/user/appdata/keyring/data && docker restart keyring
```

The entrypoint now also detects this on boot: it scans for any path under
`/data` not owned by `PUID:PGID` (stopping at the first one, so it stays cheap)
and re-chowns when it finds one. A restart alone will therefore repair it —
but the `-u` flag stops it happening in the first place.

---

## Updating without the terminal

The stack **pulls a prebuilt image** from GitHub Container Registry rather than
building on your server. That is deliberate: a locally-built tag has no
registry to compare against, so Compose Manager's "check for updates" always
reported "latest" and never offered anything — it was answering a question
about a registry image that did not exist.

Now:

**Docker → Compose → check for updates → update.** That is the whole flow.
No `git pull`, no `--build`, no multi-minute native compile on the array.

Every push to `main` triggers `.github/workflows/publish.yml`, which builds for
`linux/amd64` and `linux/arm64` and pushes `ghcr.io/rickxxrolling/keyring:latest`
plus a `sha-<commit>` tag.

### One-time setup

After the first workflow run completes, **make the package public**:

`github.com/users/RICKxxROLLING/packages/container/keyring/settings` →
Change visibility → Public.

A public *repository* does not make its *packages* public — they are separate
settings. If you skip this, the pull fails with `denied` or `unauthorized` and
the server would need GHCR credentials.

### Rolling back

The workflow also tags each build with its commit, so pinning to a known-good
version is a one-line edit in the stack:

```yaml
image: ghcr.io/rickxxrolling/keyring:sha-<the commit sha>
```

Change it back to `:latest` when you want to follow main again.

### Running a local change instead

The bottom of `docker/unraid/docker-compose.stack.yml` has a commented build
context for exactly this. Use the tag `keyring:local` rather than the GHCR one,
so a later registry pull does not look like a downgrade.
