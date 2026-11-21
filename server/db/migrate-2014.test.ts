// server/db/migrate-2014.test.ts — upgrading a database that already ran 2013.
//
// 2014 rebuilds appraisal_items to change a CHECK constraint, inside a
// transaction with foreign keys ON. Done naively, dropping the old table would
// cascade-delete every attached-file link. This runs the real migrations up to
// 2013 on a real file, saves a defect with the retired "replace" action and an
// attached file, applies 2014, and checks nothing was lost.
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { closeDb, openDb } from "./index.js";
import { runMigrations } from "./migrate.js";

const SOURCE = join(process.cwd(), "server", "db", "migrations");

describe("migration 2014 on a database that already ran 2013", () => {
  let dir = "";
  afterEach(() => {
    closeDb();
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = "";
  });

  it("turns a saved 'replace' into 'repair', keeps file links, and accepts 'completion'", () => {
    dir = mkdtempSync(join(tmpdir(), "keyring-2014-"));
    const migDir = join(dir, "migrations");
    mkdirSync(migDir);
    const all = readdirSync(SOURCE).filter((f) => f.endsWith(".sql")).sort();
    for (const f of all.filter((f) => f < "2014")) copyFileSync(join(SOURCE, f), join(migDir, f));

    const db = openDb(join(dir, "keyring.db"));
    runMigrations(db, migDir);

    const at = "2026-11-21T00:00:00.000Z";
    db.prepare(
      `INSERT INTO users (id, email, handle, display_name, role, password_hash, avatar_color, created_at, updated_at)
       VALUES ('usr_1', 'a@example.test', 'a', 'A', 'owner', 'x', '#000', ?, ?)`,
    ).run(at, at);
    db.prepare(
      `INSERT INTO properties (id, name, address_line1, city, state, postal_code, property_type, created_at, updated_at, created_by, updated_by)
       VALUES ('prp_1', 'P', '1 St', 'C', 'NC', '27948', 'single_family', ?, ?, 'usr_1', 'usr_1')`,
    ).run(at, at);
    db.prepare(
      `INSERT INTO uploads (id, parent_type, parent_id, property_id, filename, stored_path, mime, kind, size_bytes, sha256, uploaded_by, created_at)
       VALUES ('upl_1', 'property', 'prp_1', 'prp_1', 'roof.jpg', 'x.jpg', 'image/jpeg', 'image', 1, 'h', 'usr_1', ?)`,
    ).run(at);
    db.prepare(
      `INSERT INTO appraisal_items (id, property_id, label, section, kind, status, recommended_action, estimate_cents,
         sort_order, created_at, updated_at, created_by, updated_by, version)
       VALUES ('apr_1', 'prp_1', 'Roof', 'defects', 'defect', 'todo', 'replace', 900000, 0, ?, ?, 'usr_1', 'usr_1', 3)`,
    ).run(at, at);
    db.prepare(
      `INSERT INTO appraisal_item_uploads (item_id, upload_id, created_at, created_by) VALUES ('apr_1', 'upl_1', ?, 'usr_1')`,
    ).run(at);

    for (const f of all.filter((f) => f >= "2014")) copyFileSync(join(SOURCE, f), join(migDir, f));
    const result = runMigrations(db, migDir);
    expect(result.applied).toContain("2014_appraisal_import.sql");

    const item = db.prepare(`SELECT recommended_action, estimate_cents, version FROM appraisal_items WHERE id = 'apr_1'`).get();
    expect(item).toEqual({ recommended_action: "repair", estimate_cents: 900000, version: 3 });
    expect(db.prepare(`SELECT item_id, upload_id FROM appraisal_item_uploads`).all()).toEqual([
      { item_id: "apr_1", upload_id: "upl_1" },
    ]);

    // The new value is accepted, the retired one is not.
    db.prepare(`UPDATE appraisal_items SET recommended_action = 'completion' WHERE id = 'apr_1'`).run();
    expect(() => db.prepare(`UPDATE appraisal_items SET recommended_action = 'replace' WHERE id = 'apr_1'`).run()).toThrow(
      /CHECK constraint/,
    );

    // Links still cascade from the rebuilt table.
    db.prepare(`DELETE FROM appraisal_items WHERE id = 'apr_1'`).run();
    expect(db.prepare(`SELECT COUNT(*) AS n FROM appraisal_item_uploads`).get()).toEqual({ n: 0 });
    expect(db.prepare(`SELECT COUNT(*) AS n FROM uploads`).get()).toEqual({ n: 1 });
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });
});
