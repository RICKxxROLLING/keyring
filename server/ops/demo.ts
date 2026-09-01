// server/ops/demo.ts — load and unload the demo portfolio from inside the app.
//
// From the tracking list: "I would like to be able to toggle demo data on and
// off without wiping the database of users."
//
// Before this, removing the demo meant deleting the database file, which took
// the accounts, TOTP enrolments and pending invites with it. So evaluating the
// app and then starting for real cost you everyone's setup a second time.
//
// The two rules this module exists to keep:
//
//   1. Removing the demo NEVER touches users, sessions, invites or anything
//      else in the auth tables. Not even the owner the seed adopted.
//   2. Removing the demo NEVER touches a row that was not seeded. Only
//      `is_demo = 1` is in scope, and nothing sets that flag except the seed.
//      Anything typed into a demo build in earnest is real data and stays.
import { getDb, tx } from "../db/index.js";
import { absPathFromRel, deleteFileIfExists } from "../uploads/storage.js";
import { seedDemoData } from "../seed/seed.js";

export interface DemoStatus {
  /** Whether any demo rows are present. */
  present: boolean;
  properties: number;
  vendors: number;
  /** Real (non-demo) properties. Shown so it is clear what will survive. */
  realProperties: number;
}

export function getDemoStatus(): DemoStatus {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM properties WHERE is_demo = 1) AS demo_properties,
         (SELECT COUNT(*) FROM properties WHERE is_demo = 0) AS real_properties,
         (SELECT COUNT(*) FROM vendors    WHERE is_demo = 1) AS demo_vendors`,
    )
    .get() as { demo_properties: number; real_properties: number; demo_vendors: number };

  return {
    present: row.demo_properties > 0 || row.demo_vendors > 0,
    properties: row.demo_properties,
    vendors: row.demo_vendors,
    realProperties: row.real_properties,
  };
}

export interface DemoRemoval {
  properties: number;
  vendors: number;
  uploads: number;
}

/**
 * Remove every demo row, and only demo rows.
 *
 * Deleting the properties does most of the work: units, notes, work orders, PM
 * templates, projects, tenants, leases, rent entries, expenses, spec entries,
 * compliance items, turnovers and uploads all cascade from properties(id) (see
 * 2001_domain.sql), and `foreign_keys = ON` is set on every connection.
 *
 * What does not cascade, and so is handled here:
 *   - the files on disk behind demo uploads (SQLite cannot unlink them)
 *   - search_index rows, which reference entities loosely by id
 *   - notifications scoped to demo properties, which would be dead links
 *   - vendors, which are portfolio-wide rather than property-scoped
 *
 * The audit log is deliberately left alone. It is append-only — there is a test
 * asserting no code path anywhere updates or deletes a row in it — and that
 * holds for deleted entities generally, not just this one. Entries about demo
 * properties stay as an accurate record that those properties existed and were
 * removed, alongside the entry this operation writes about itself.
 *
 * The upload paths are collected BEFORE the delete, because after it there is
 * no row left to tell us which files to remove.
 */
export function removeDemoData(): DemoRemoval {
  const db = getDb();

  const uploadPaths = db
    .prepare(
      `SELECT u.stored_path, u.thumb_path
         FROM uploads u
         JOIN properties p ON p.id = u.property_id
        WHERE p.is_demo = 1`,
    )
    .all() as { stored_path: string; thumb_path: string | null }[];

  const result = tx(() => {
    const propertyIds = (
      db.prepare(`SELECT id FROM properties WHERE is_demo = 1`).all() as { id: string }[]
    ).map((r) => r.id);

    if (propertyIds.length > 0) {
      const marks = propertyIds.map(() => "?").join(",");
      // Loose references first, then the properties themselves, so nothing is
      // orphaned even for the moment inside the transaction.
      db.prepare(`DELETE FROM search_index WHERE property_id IN (${marks})`).run(...propertyIds);
      db.prepare(`DELETE FROM notifications WHERE property_id IN (${marks})`).run(...propertyIds);
      db.prepare(`DELETE FROM properties WHERE id IN (${marks})`).run(...propertyIds);
    }

    // Demo vendors, but only the ones nothing still points at.
    //
    // Every vendor_id foreign key is ON DELETE SET NULL, so deleting a demo
    // vendor that a REAL work order had been assigned to would quietly blank
    // that assignment — the kind of silent loss this whole feature exists to
    // avoid. If you kept Torres Plumbing and used them on a real job, they
    // stay, and they stop being demo data.
    const vendors = db
      .prepare(
        `DELETE FROM vendors
          WHERE is_demo = 1
            AND NOT EXISTS (SELECT 1 FROM pm_templates      t WHERE t.vendor_id = vendors.id)
            AND NOT EXISTS (SELECT 1 FROM work_orders       w WHERE w.vendor_id = vendors.id)
            AND NOT EXISTS (SELECT 1 FROM project_lines     l WHERE l.vendor_id = vendors.id)
            AND NOT EXISTS (SELECT 1 FROM property_expenses e WHERE e.vendor_id = vendors.id)
            AND NOT EXISTS (SELECT 1 FROM spec_entries      s WHERE s.vendor_id = vendors.id)
            AND NOT EXISTS (SELECT 1 FROM compliance_items  c WHERE c.vendor_id = vendors.id)`,
      )
      .run().changes;

    // A demo vendor that survived because real work references it is no longer
    // demo data; leaving the flag set would offer to delete it again next time.
    db.prepare(`UPDATE vendors SET is_demo = 0 WHERE is_demo = 1`).run();

    return { properties: propertyIds.length, vendors };
  });

  // Files last: the transaction has committed, so a failure here leaves orphan
  // bytes on disk rather than rows pointing at files that are gone.
  let files = 0;
  for (const u of uploadPaths) {
    deleteFileIfExists(absPathFromRel(u.stored_path));
    if (u.thumb_path) deleteFileIfExists(absPathFromRel(u.thumb_path));
    files += 1;
  }

  return { ...result, uploads: files };
}

/**
 * Put the demo portfolio back.
 *
 * The seed refuses when ANY property exists, demo or real — it is written to
 * populate an empty portfolio, not to merge into a populated one. That is the
 * right conservative behaviour here too: adding five fictional properties
 * alongside someone's real ones is not what "load demo data" should mean.
 */
export async function loadDemoData(): Promise<{ loaded: boolean; message: string }> {
  const result = await seedDemoData();
  return { loaded: result.seeded, message: result.message };
}

