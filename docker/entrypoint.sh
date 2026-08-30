#!/bin/sh
# docker/entrypoint.sh — Unraid PUID/PGID convention. Runs as root (container
# default), makes sure a user/group matching PUID/PGID exist, fixes /data
# ownership ONLY when it actually differs (never walk tens of thousands of
# upload files on every boot), then drops privileges and execs node. The app
# process itself never runs as root.
set -e

PUID="${PUID:-99}"
PGID="${PGID:-100}"
DATA_DIR="${DATA_DIR:-/data}"

if ! getent group "$PGID" >/dev/null 2>&1; then
  groupadd --system --gid "$PGID" keyring
fi
if ! getent passwd "$PUID" >/dev/null 2>&1; then
  # --system: Unraid's default PUID is 99, below Debian's UID_MIN of 1000.
  # Without it useradd still succeeds but prints
  #   "warning: keyring's uid 99 outside of the UID_MIN 1000 and UID_MAX 60000 range"
  # on every single boot, which looks like a problem and is not one. A service
  # account is exactly what --system is for.
  useradd --system --uid "$PUID" --gid "$PGID" \
    --no-create-home --shell /usr/sbin/nologin keyring
fi

mkdir -p "$DATA_DIR"

# Checking only the top-level directory is not enough. `docker exec` runs as
# ROOT (it does not pass through this entrypoint's gosu drop), so a maintenance
# command like `docker exec <c> npm run seed:prod` creates files and
# subdirectories owned by root INSIDE an otherwise correctly-owned /data. The
# app then runs as PUID:PGID and gets EACCES writing there — which surfaces
# much later as "photo upload doesn't work".
#
# So: look for ANY path not owned by PUID, not just the root. `-print -quit`
# stops at the first hit, so this stays cheap even with thousands of uploads —
# it is a find that usually terminates on the first entry.
NEEDS_CHOWN=""
if [ "$(stat -c '%u:%g' "$DATA_DIR" 2>/dev/null || echo '')" != "${PUID}:${PGID}" ]; then
  NEEDS_CHOWN="root of $DATA_DIR"
elif [ -n "$(find "$DATA_DIR" \( ! -user "$PUID" -o ! -group "$PGID" \) -print -quit 2>/dev/null)" ]; then
  NEEDS_CHOWN="one or more paths under $DATA_DIR"
fi

if [ -n "$NEEDS_CHOWN" ]; then
  echo "entrypoint: fixing ownership to ${PUID}:${PGID} ($NEEDS_CHOWN)"
  chown -R "${PUID}:${PGID}" "$DATA_DIR"
fi

echo "entrypoint: starting as ${PUID}:${PGID}"
exec gosu "${PUID}:${PGID}" "$@"
