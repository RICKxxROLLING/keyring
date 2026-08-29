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
  groupadd --gid "$PGID" stoop
fi
if ! getent passwd "$PUID" >/dev/null 2>&1; then
  useradd --uid "$PUID" --gid "$PGID" --no-create-home --shell /usr/sbin/nologin stoop
fi

mkdir -p "$DATA_DIR"

CURRENT_OWNER="$(stat -c '%u:%g' "$DATA_DIR" 2>/dev/null || echo '')"
if [ "$CURRENT_OWNER" != "${PUID}:${PGID}" ]; then
  echo "entrypoint: fixing ownership of $DATA_DIR to ${PUID}:${PGID} (first boot or PUID/PGID changed)"
  chown -R "${PUID}:${PGID}" "$DATA_DIR"
fi

echo "entrypoint: starting as ${PUID}:${PGID}"
exec gosu "${PUID}:${PGID}" "$@"
