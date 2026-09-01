// scripts/version.mjs — derive the app version from git history.
//
// Format: V2026.09.01.02 — the date the commit was published, then a
// two-digit ordinal counting that day's commits, so the second push on a day
// is .02.
//
// Derived rather than stored, because a version file in the repo is a thing to
// forget to bump, and it would conflict on every branch. Git already knows both
// halves of this.
//
// The ordinal counts commits reachable from HEAD sharing HEAD's date, which
// makes it HEAD's own position in that day — and makes it stable: rebuilding an
// old commit produces the version that commit had, not today's.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** Committer date, not author date: this is about when it was published. */
const DATE_FORMAT = "--date=format:%Y.%m.%d";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

export function appVersion() {
  try {
    const date = git(["log", "-1", DATE_FORMAT, "--pretty=%cd"]);
    if (!/^\d{4}\.\d{2}\.\d{2}$/.test(date)) throw new Error(`unexpected date: ${date}`);

    const sameDay = git(["log", DATE_FORMAT, "--pretty=%cd"])
      .split("\n")
      .filter((d) => d === date).length;

    return `V${date}.${String(sameDay).padStart(2, "0")}`;
  } catch {
    // No git — a source tarball, or a Docker build without the history. The
    // caller passes APP_VERSION explicitly in that case; this is the last
    // resort, and it says so rather than inventing a plausible number.
    return "V0.0.0.00";
  }
}

// CLI entry: `node scripts/version.mjs` prints the version for CI to capture.
// Compared as resolved file URLs rather than by basename, which would also
// match any other version.mjs that happened to be the entry point.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.stdout.write(appVersion() + "\n");
}
