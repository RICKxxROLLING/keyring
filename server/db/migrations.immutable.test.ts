// Guard: applied migrations are IMMUTABLE.
//
// This exists because of a real incident. A project-wide rename swept
// `'stoop'` -> `'keyring'` across every tracked file, and one of the matches
// was a metadata INSERT inside 0001_auth_core.sql — a migration that had
// already been applied on a live deployment.
//
// runMigrations() hashes each file and refuses to boot when an applied one has
// changed. That check did its job perfectly: it threw, the process exited,
// Docker restarted it, and the server sat in a boot loop until the file was
// reverted. Correct behaviour, discovered in the worst possible place.
//
// The lesson is not "be careful with sed". It is that nothing failed until the
// container booted on someone else's machine. This test moves that failure to
// `npm test`, where it costs seconds instead of an outage.
//
// If you are here because this test failed:
//
//   - Did you EDIT an existing migration? Revert it. Migrations are append
//     only. Add a new file in your workstream's reserved range instead
//     (T1 0001-0999, T2 1000-1999, T3 2000-2999, T4 3000-3999, T5 4000-4999).
//   - Did you legitimately ADD a migration? Add its filename and hash below.
//
// Never update a hash here to make a failure go away without first
// establishing that no deployment has applied the old version of that file.

import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "server", "db", "migrations");

/** filename -> sha256 of its UTF-8 contents, as applied to live databases. */
const FROZEN: ReadonlyArray<readonly [string, string]> = [
  ["0001_auth_core.sql", "f876d654246c21b9b5b6b48779d432582503a459d80fe920a118560d0e07ddbc"],
  ["1001_realtime.sql", "ae6d8810764f6e8a0b12e20c5c9b481cdb117f748de5b3fce4261aba97580034"],
  ["2001_domain.sql", "a81f69e95cd9a8e16549f3612f0d941dae2851927793505fcc0960cbfbc83b05"],
  ["2002_property_hero_color.sql", "7a91cc181b0501956be569e4f746e468813641c37aba562571c47cf2fb865092"],
  ["2003_rent_reference_expense_recurring.sql", "61f790632e5954daffee758215d20eb52a8b0353cfaa859fb20fa8665fe5b1f1"],
  ["2004_demo_data_flag.sql", "5e86afc3d27509af679b21e0c70fc31ed45330c0913cc7a5c1ebe2b47346277a"],
  ["2005_property_stage.sql", "78a9f086a3475478e93ed0b73ebb431719c4f773017ee43639ac80d954607c42"],
  ["2006_deal_inputs.sql", "617dd653e362d07d54eb64e79bb2b0128892e281bb266a8e5a0976411c7e065f"],
  ["4001_ops.sql", "2fe7894758d6ea9285c12bf4c96acfd7a3642da2a0b6b5ac7ef04278717342cc"],
];

function sha256OfMigration(file: string): string {
  return createHash("sha256").update(readFileSync(join(MIGRATIONS_DIR, file), "utf8")).digest("hex");
}

describe("migrations are immutable once applied", () => {
  it.each(FROZEN)("%s is byte-for-byte unchanged", (file, expected) => {
    expect(sha256OfMigration(file)).toBe(expected);
  });

  it("has no migration file missing from the frozen list", () => {
    // A new migration is fine — it just has to be recorded here, which is the
    // moment to ask whether it belongs in your reserved range.
    const onDisk = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    const known = FROZEN.map(([f]) => f).sort();
    expect(onDisk).toEqual(known);
  });
});
