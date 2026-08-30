# Stoop — Restore Drill

**"We have backups" and "we have restored a backup" are different claims.**
This document is the second one. Every command below was actually run against
a real archive produced by the real `npm run backup` job, on 2026-08-29, and
the output pasted below is unedited except for wrapping.

> Environment note: this drill was executed with `npm run backup` /
> `npm run restore` directly (Node 24.19.0, Windows), against a scratch data
> directory outside the repo (`/tmp/stoop-drill`, `/tmp/stoop-restore-scratch*`)
> — not inside a Docker container, because Docker was not installed in this
> build sandbox. The archive format, the encryption, the `VACUUM INTO`
> snapshot, and the restore/verification logic are exactly what ships in the
> image; only the surrounding "run it inside a container on `/data`" staging
> differs, and that staging is a `cp`/`rsync` a few lines below, not application
> logic. See `T5.md` in the crew reports directory for the full list of what
> could and could not be verified in this environment, including why Docker
> itself could not be exercised.

## The archive format (§C11.2), confirmed on a real file

```
$ xxd -l 36 /tmp/stoop-drill/data/backups/stoop-20260829-234027.tar.gz.enc
00000000: 5354 4f4f 5042 0101 99b2 374b 5ff9 4107  STOOPB....7K_.A.
00000010: 9beb 57c3 500e ba49 5684 54a9 128f 702a  ..W.P..IV.T...p*
00000020: fa82 efa4                                ....
```

Byte-for-byte: `STOOPB` (magic) · `01` (format version) · `01` (KDF id =
scrypt) · 16 bytes salt · 12 bytes GCM IV · ciphertext follows. Exactly the
layout pinned in the design contract.

## Setup: a real backup to restore

A scratch `DATA_DIR` was seeded with one user, one property, one unit, one
note, and two upload files (a fake lease PDF and a fake unit photo, 60 and 44
bytes), then a real backup was produced:

```
$ npm run backup

> stoop@1.0.0 backup
> tsx server/ops/backup.ts --run

applied 0, total 3
backup ok: stoop-20260829-234027.tar.gz.enc (13388 bytes, sha256 8ed6b74ff01ff6efce6f7a2bcb14461b8a3216ca8166d9061304b2137ee5b263)
```

Source database row counts at the moment of that backup (`SELECT COUNT(*)`
per table, via `sqlite3`/`better-sqlite3` directly against the live DB):

```
app_meta                 1        notes                     1
audit_log                0        properties                1
auth_attempts            0        schema_migrations         3
backup_runs              0        units                     1
users                    1        (all other tables: 0)
```

(`backup_runs` reads 0 here because this snapshot was taken via `VACUUM INTO`
the instant the run started — before its own `running` row exists in what
gets read afterward for the *next* backup's comparison. The restored copy
below correctly shows `backup_runs: 1`, because the running row *had* already
been inserted by the time `VACUUM INTO` executed inside that same backup.)

## 1. Backups fail loudly — and write NO archive — without `BACKUP_PASSPHRASE`

```
$ unset BACKUP_PASSPHRASE
$ npm run backup

> stoop@1.0.0 backup
> tsx server/ops/backup.ts --run

applied 0, total 3
backup failed: BACKUP_PASSPHRASE is not set; refusing to write an unencrypted backup archive.
$ echo $?
1

$ ls /tmp/stoop-drill/data/backups
stoop-20260829-234027.tar.gz.enc
```

Only the archive from the earlier, passphrase-set run is present. The failed
run wrote nothing — never a plaintext fallback.

## 2. The real restore — correct passphrase

```
$ npm run restore -- --archive /tmp/stoop-drill/data/backups/stoop-20260829-234027.tar.gz.enc \
                     --out /tmp/stoop-restore-scratch

> stoop@1.0.0 restore
> tsx server/ops/cli-restore.ts --archive .../stoop-20260829-234027.tar.gz.enc --out .../stoop-restore-scratch

Restoring archive: C:/Users/riley/AppData/Local/Temp/stoop-drill/data/backups/stoop-20260829-234027.tar.gz.enc
Output directory:  C:/Users/riley/AppData/Local/Temp/stoop-restore-scratch

archive sha256:         8ed6b74ff01ff6efce6f7a2bcb14461b8a3216ca8166d9061304b2137ee5b263
extracted db:           C:\Users\riley\AppData\Local\Temp\stoop-restore-scratch\stoop.db
extracted uploads dir:  C:\Users\riley\AppData\Local\Temp\stoop-restore-scratch\uploads
PRAGMA integrity_check: ok

table row counts:
  app_meta                 1
  audit_log                1
  auth_attempts            0
  backup_runs              1
  compliance_items         0
  invites                  0
  lease_tenants            0
  leases                   0
  lockouts                 0
  mfa_challenges           0
  notes                    1
  pm_templates             0
  project_lines            0
  projects                 0
  properties               1
  property_expenses        0
  recovery_codes           0
  rent_entries             0
  schema_migrations        3
  search_fts                0
  search_fts_config        1
  search_fts_data          2
  search_fts_docsize       0
  search_fts_idx           0
  search_index             0
  sessions                 0
  setup_state              0
  spec_entries             0
  tenants                  0
  turnover_items           0
  turnovers                0
  units                    1
  uploads                  0
  users                    1
  vendors                  0
  work_order_comments      0
  work_orders              0

uploads restored:      2 files, 104 bytes
elapsed:                116ms

RESTORE OK — integrity check passed.
$ echo $?
0
```

`PRAGMA integrity_check` returned `ok`. `properties`, `units`, `notes`,
`users` all match the source exactly (1 each). `uploads restored: 2 files,
104 bytes` matches the two fixture files (60 + 44 bytes) byte-for-byte.
(The `uploads` **table** row count is 0 — no rows were inserted into the
`uploads` SQL table by this drill's seed script, which only wrote raw files
into the upload directory; the physical file count/byte count reported
separately above is what actually round-tripped through the archive.)

## 3. Wrong passphrase — fails on the GCM tag, indistinguishable from corruption

```
$ npm run restore -- --archive /tmp/stoop-drill/data/backups/stoop-20260829-234027.tar.gz.enc \
                     --out /tmp/stoop-restore-scratch-wrong

> stoop@1.0.0 restore
> tsx server/ops/cli-restore.ts --archive .../stoop-20260829-234027.tar.gz.enc --out .../stoop-restore-scratch-wrong

Restoring archive: C:/Users/riley/AppData/Local/Temp/stoop-drill/data/backups/stoop-20260829-234027.tar.gz.enc
Output directory:  C:/Users/riley/AppData/Local/Temp/stoop-restore-scratch-wrong

RESTORE FAILED (authentication): Decryption failed: wrong passphrase or corrupted archive (AES-256-GCM authentication tag mismatch). A wrong passphrase is indistinguishable from a corrupt archive by design.
$ echo $?
1
```

This is the expected, correct failure mode: AES-256-GCM's authentication tag
means a wrong key and a tampered/corrupted file fail identically — there is
no "partial decrypt" that produces plausible garbage.

## The production restore procedure (Unraid / Docker)

Once you have a real `docker compose`-managed deployment, the same commands
run inside the container against the real `/data` volume:

Two things differ inside the container, and both will bite you if you copy the
development commands verbatim:

- **Use the `:prod` scripts.** The runtime image runs `npm prune --omit=dev`, so
  `tsx` — which `npm run restore` uses — does not exist there. `restore:prod`
  runs the compiled `dist/` equivalent.
- **`rsync` is not installed.** The runtime image is `node:24-bookworm-slim`
  plus `gosu` and `tini`; nothing else. Use `cp` and `rm`.

Each step runs in its own one-off container, so `/tmp` does not persist between
them — do the restore, the review, and the copy in a **single** shell so the
scratch directory survives:

```
docker compose stop stoop

docker compose run --rm stoop sh -c '
  npm run restore:prod -- \
    --archive /data/backups/stoop-<ts>.tar.gz.enc \
    --out /tmp/restore-scratch
'
# Review the printed integrity check and row counts above. Do NOT continue if
# integrity_check is not "ok" or the row counts look wrong.

docker compose run --rm stoop sh -c '
  set -e
  npm run restore:prod -- \
    --archive /data/backups/stoop-<ts>.tar.gz.enc \
    --out /tmp/restore-scratch
  cp /tmp/restore-scratch/stoop.db /data/stoop.db
  rm -f /data/stoop.db-wal /data/stoop.db-shm
  rm -rf /data/uploads
  cp -a /tmp/restore-scratch/uploads /data/uploads
'

docker compose start stoop
```

The restore is run twice on purpose: once to read the integrity report before
you commit to anything, and once to actually overwrite `/data`. It is a pure
decrypt-and-extract into a scratch path, so running it twice is harmless.

(Or open a shell in a one-off container with the `/data` volume attached and
run the equivalent commands directly — whichever is more convenient for your
Unraid setup. The important part is: `stop` first, verify the printed report
before copying anything over the live files, and `start` last.)

## `POST /api/ops/backups/verify` — the automated half of this drill

The same decrypt-and-check logic (`server/ops/restore.ts`'s `verifyArchive`)
backs `POST /api/ops/backups/verify`: it runs the identical decrypt +
`PRAGMA integrity_check` in a throwaway temp directory and always deletes
that directory afterward, success or failure — see `server/ops/restore.test.ts`
for an automated test of exactly this path (`verifyArchive cleans up its temp
directory whether it succeeds or fails`), and `server/ops/routes.ops.test.ts`
for the HTTP-level test (`POST /api/ops/backups/verify round-trips a real
archive and cleans up its temp dir`). Use it for a quick "is this archive
still good" check without doing a full restore.
