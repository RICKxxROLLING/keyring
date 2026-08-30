#!/usr/bin/env node
// server/ops/cli-restore.ts — `npm run restore -- --archive <path> --out <dir>`.
// Owner: T5. This is the executable half of the restore drill in docs/RESTORE.md:
// it must actually be run against a real archive, and its real terminal output
// pasted into that document — a written-but-unrun procedure is not evidence.
import { existsSync } from "node:fs";
import { loadEnv } from "../config/env.js";
import { restoreArchive } from "./restore.js";
import { ArchiveAuthError, ArchiveFormatError } from "./archive.js";

interface Args {
  archive?: string;
  out?: string;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--archive") out.archive = argv[++i];
    else if (argv[i] === "--out") out.out = argv[++i];
  }
  return out;
}

async function main(): Promise<void> {
  const { archive, out } = parseArgs(process.argv.slice(2));
  if (!archive || !out) {
    console.error("Usage: npm run restore -- --archive <path> --out <dir>");
    process.exitCode = 2;
    return;
  }
  if (!existsSync(archive)) {
    console.error(`Archive not found: ${archive}`);
    process.exitCode = 2;
    return;
  }

  const env = loadEnv();
  const passphrase = env.BACKUP_PASSPHRASE;
  if (!passphrase) {
    console.error(
      "BACKUP_PASSPHRASE is not set in the environment. It is required to decrypt a backup archive " +
        "and there is no recovery without it.",
    );
    process.exitCode = 2;
    return;
  }

  console.log(`Restoring archive: ${archive}`);
  console.log(`Output directory:  ${out}`);
  console.log("");

  const started = Date.now();
  try {
    const report = await restoreArchive({ archivePath: archive, outDir: out, passphrase });

    console.log(`archive sha256:         ${report.archiveSha256}`);
    console.log(`extracted db:           ${report.dbPath}`);
    console.log(`extracted uploads dir:  ${report.uploadsDir}`);
    console.log(`PRAGMA integrity_check: ${report.integrityCheck}`);
    console.log("");
    console.log("table row counts:");
    for (const [table, count] of Object.entries(report.rowCounts).sort(([a], [b]) => a.localeCompare(b))) {
      console.log(`  ${table.padEnd(24)} ${count}`);
    }
    console.log("");
    console.log(`uploads restored:      ${report.uploads.count} files, ${report.uploads.bytes} bytes`);
    console.log(`elapsed:                ${Date.now() - started}ms`);
    console.log("");

    if (report.ok) {
      console.log("RESTORE OK — integrity check passed.");
      process.exitCode = 0;
    } else {
      console.error(`RESTORE FAILED — integrity_check returned "${report.integrityCheck}".`);
      process.exitCode = 1;
    }
  } catch (err) {
    console.error("");
    if (err instanceof ArchiveAuthError) {
      console.error(`RESTORE FAILED (authentication): ${err.message}`);
    } else if (err instanceof ArchiveFormatError) {
      console.error(`RESTORE FAILED (format): ${err.message}`);
    } else {
      console.error(`RESTORE FAILED: ${(err as Error).message}`);
    }
    process.exitCode = 1;
  }
}

await main();
