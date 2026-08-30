# syntax=docker/dockerfile:1
#
# Single multi-stage image for Keyring. Stage 1 builds the web bundle and the
# compiled server; stage 2 is the runtime image that ships to Unraid.
#
# IMPORTANT: tsc does not copy `.sql` files. The migration runner
# (server/db/migrate.ts, frozen) looks for `server/db/migrations` beside its
# own compiled location first, then falls back to `<cwd>/server/db/migrations`.
# Both locations are populated below — a build that skips this boots into an
# empty database.

########################################
# Stage 1: build (web + server)
########################################
FROM node:24-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

# Drop devDependencies from node_modules before it's copied into the runtime image.
RUN npm prune --omit=dev

########################################
# Stage 2: runtime
########################################
FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    DATA_DIR=/data

# gosu: drop root -> PUID/PGID in the entrypoint without setuid-shell games.
# tini: correct PID 1 signal handling (SIGTERM from `docker compose stop`).
RUN apt-get update \
    && apt-get install -y --no-install-recommends gosu tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json

# See the header comment: migrations must land in BOTH places.
COPY server/db/migrations ./dist/server/server/db/migrations
COPY server/db/migrations ./server/db/migrations

COPY docker/entrypoint.sh /entrypoint.sh
COPY docker/healthcheck.mjs /healthcheck.mjs
RUN chmod +x /entrypoint.sh

# Created here so a fresh bind mount that starts out root-owned still has a
# directory to chown on first boot; the entrypoint fixes ownership at runtime
# to whatever PUID/PGID the operator actually set (Unraid default 99:100).
RUN mkdir -p /data

EXPOSE 8080
VOLUME ["/data"]

# Docker health check — same endpoint the Fastify server itself never wraps in
# the {ok,data} envelope (§C6.6). 20s start-period gives migrations time to run.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "/healthcheck.mjs"]

# The container starts as root so the entrypoint can chown /data if needed,
# then execs the app as PUID:PGID via gosu. The node process itself never runs
# as root.
ENTRYPOINT ["tini", "--", "/entrypoint.sh"]
CMD ["node", "dist/server/server/index.js"]
