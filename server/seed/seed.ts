// server/seed/seed.ts — the demo portfolio: 5 properties (1-3 units each) with
// realistic data across every domain module, so the app is explorable before you
// have entered anything real.
//
// Callable two ways: `npm run seed` at the CLI, and from the running server via
// the demo-data routes, so demo data can be put in and taken back out without
// touching the database file or the people in it.
//
// Idempotent: a no-op when the database already has properties.
import { HERO_COLORS } from "../../shared/hero-colors.js";
import { loadEnv } from "../config/env.js";
import { getDb, initDb, tx } from "../db/index.js";
import { runMigrations } from "../db/migrate.js";
import { newId } from "../lib/ids.js";
import { nowIso, todayLocal, addDays, addMonths } from "../lib/time.js";
import { indexEntity } from "../search/index-entity.js";
import { processImage } from "../uploads/thumbnails.js";
import { storedPathFor, thumbPathFor } from "../uploads/storage.js";
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

import { pathToFileURL } from "node:url";

export interface SeedResult {
  seeded: boolean;
  properties: number;
  units: number;
  vendors: number;
  message: string;
}

/**
 * Populate the demo portfolio.
 *
 * When `standalone` the database is opened and migrated here (the CLI path).
 * From inside the server the connection is already open and migrated, and
 * re-opening it would invalidate every other handle in the process.
 */
export async function seedDemoData(opts: { standalone?: boolean } = {}): Promise<SeedResult> {
  const env = loadEnv();
  const db = opts.standalone ? initDb(env.DB_PATH) : getDb();
  if (opts.standalone) runMigrations(db);

  // Only demo data blocks a reseed, not real properties.
  //
  // This used to refuse whenever ANY property existed, which meant you could
  // never look at the demo again once you had entered something of your own.
  // Adding it alongside is safe because every seeded row is flagged is_demo and
  // the removal path only ever touches those — see server/ops/demo.ts — and the
  // UI marks demo properties everywhere they appear, so the two cannot be
  // confused on screen either.
  const existing = db.prepare(`SELECT COUNT(*) AS n FROM properties WHERE is_demo = 1`).get() as {
    n: number;
  };
  if (existing.n > 0) {
    return {
      seeded: false,
      properties: 0,
      units: 0,
      vendors: 0,
      message: "The demo portfolio is already loaded.",
    };
  }

  const today = todayLocal(env.APP_TIMEZONE);

  // ---------------------------------------------------------------- seed owner user
  let ownerId = (db.prepare(`SELECT id FROM users WHERE role = 'owner' ORDER BY created_at LIMIT 1`).get() as
    | { id: string }
    | undefined)?.id;
  if (!ownerId) {
    ownerId = newId("usr");
    const at = nowIso();
    db.prepare(
      `INSERT INTO users (id, email, handle, display_name, role, password_hash, avatar_color,
         is_active, created_at, updated_at, version)
       VALUES (?, 'owner@keyring.local', 'owner', 'Portfolio Owner', 'owner', 'x', '#2563eb', 1, ?, ?, 1)`,
    ).run(ownerId, at, at);
  }
  const uid = ownerId;

  // ---------------------------------------------------------------------- vendors
  interface VendorSeed {
    id: string;
    name: string;
    trade: string;
  }
  const vendorDefs: { name: string; company: string; trade: string; preferred: boolean }[] = [
    { name: "Mike Torres", company: "Torres Plumbing", trade: "Plumbing", preferred: true },
    { name: "Dana Lee", company: "Lee Electric Co", trade: "Electrical", preferred: true },
    { name: "Sam Rivera", company: "Rivera HVAC", trade: "HVAC", preferred: false },
    { name: "Pat Nguyen", company: "Nguyen Landscaping", trade: "Landscaping", preferred: false },
    { name: "Jordan Blake", company: "Blake General Contracting", trade: "General", preferred: true },
  ];
  const vendors: VendorSeed[] = [];
  for (const v of vendorDefs) {
    const id = newId("ven");
    const at = nowIso();
    db.prepare(
      `INSERT INTO vendors (id, name, company, trade, phone, email, website, address, notes,
         rating, preferred, license_number, insurance_expires_on, archived_at, created_at,
         updated_at, created_by, updated_by, version, is_demo)
       VALUES (?, ?, ?, ?, '555-0100', ?, NULL, NULL, NULL, 4, ?, 'LIC-1000', ?, NULL, ?, ?, ?, ?, 1, 1)`,
    ).run(
      id,
      v.name,
      v.company,
      v.trade,
      `${v.name.split(" ")[0]!.toLowerCase()}@example.com`,
      v.preferred ? 1 : 0,
      addMonths(today, 8),
      at,
      at,
      uid,
      uid,
    );
    vendors.push({ id, name: v.name, trade: v.trade });
  }
  function vendorFor(trade: string): string {
    return vendors.find((v) => v.trade === trade)?.id ?? vendors[0]!.id;
  }

  // ------------------------------------------------------------------- properties
  interface PropDef {
    name: string;
    addressLine1: string;
    city: string;
    state: string;
    postalCode: string;
    propertyType: string;
    units: { label: string; beds: number; baths: number; rent: number }[];
  }
  const propDefs: PropDef[] = [
    {
      name: "Maple Street Duplex",
      addressLine1: "123 Maple St",
      city: "Springfield",
      state: "OH",
      postalCode: "45501",
      propertyType: "duplex",
      units: [
        { label: "Unit A", beds: 2, baths: 1, rent: 125000 },
        { label: "Unit B", beds: 2, baths: 1, rent: 130000 },
      ],
    },
    {
      name: "Oak Avenue House",
      addressLine1: "456 Oak Ave",
      city: "Springfield",
      state: "OH",
      postalCode: "45502",
      propertyType: "single_family",
      units: [{ label: "Main House", beds: 3, baths: 2, rent: 185000 }],
    },
    {
      name: "Birch Triplex",
      addressLine1: "789 Birch Ln",
      city: "Dayton",
      state: "OH",
      postalCode: "45402",
      propertyType: "triplex",
      units: [
        { label: "Unit 1", beds: 1, baths: 1, rent: 95000 },
        { label: "Unit 2", beds: 1, baths: 1, rent: 97500 },
        { label: "Unit 3", beds: 2, baths: 1, rent: 115000 },
      ],
    },
    {
      name: "Cedar Lane Townhome",
      addressLine1: "22 Cedar Ln",
      city: "Dayton",
      state: "OH",
      postalCode: "45403",
      propertyType: "townhouse",
      units: [{ label: "Townhome", beds: 3, baths: 2.5, rent: 165000 }],
    },
    {
      name: "Pine Road Condos",
      addressLine1: "310 Pine Rd",
      city: "Kettering",
      state: "OH",
      postalCode: "45420",
      propertyType: "condo",
      units: [
        { label: "Unit 101", beds: 1, baths: 1, rent: 105000 },
        { label: "Unit 102", beds: 2, baths: 2, rent: 135000 },
      ],
    },
  ];

  interface UnitSeed {
    id: string;
    label: string;
    rent: number;
  }
  interface PropSeed {
    id: string;
    name: string;
    units: UnitSeed[];
  }

  const properties: PropSeed[] = [];
  const at0 = nowIso();

  tx(() => {
    propDefs.forEach((p, propIdx) => {
      const propertyId = newId("prp");
      db.prepare(
        `INSERT INTO properties (id, name, address_line1, address_line2, city, state, postal_code,
           country, property_type, year_built, sqft, lot_sqft, parcel_number, purchase_date,
           purchase_price_cents, mortgage_lender, mortgage_payment_cents, insurance_carrier,
           insurance_policy_number, cover_upload_id, notes, sort_order, archived_at, hero_color, created_at,
           updated_at, created_by, updated_by, version, is_demo)
         VALUES (?, ?, ?, NULL, ?, ?, ?, 'US', ?, ?, ?, ?, NULL, ?, ?, 'First Regional Bank', ?,
           'Statewide Insurance', ?, NULL, NULL, ?, NULL, ?, ?, ?, ?, ?, 1, 1)`,
      ).run(
        propertyId,
        p.name,
        p.addressLine1,
        p.city,
        p.state,
        p.postalCode,
        p.propertyType,
        1965 + propIdx * 8,
        1200 + propIdx * 300,
        5000 + propIdx * 500,
        addMonths(today, -36 - propIdx * 6),
        35_000_000 + propIdx * 5_000_000,
        180_000 + propIdx * 15_000,
        `POL-${1000 + propIdx}`,
        propIdx,
        // Hero colour: walk the palette in order so the seeded ring shows all six
        // and looks like the design's keyring rather than one repeated colour.
        HERO_COLORS[propIdx % HERO_COLORS.length]!.value,
        at0,
        at0,
        uid,
        uid,
      );
      indexEntity({
        entityType: "property",
        entityId: propertyId,
        propertyId,
        title: p.name,
        body: `${p.addressLine1} ${p.city} ${p.state} ${p.postalCode}`,
        url: `/p/${propertyId}`,
        updatedAt: at0,
      });

      const units: UnitSeed[] = [];
      p.units.forEach((u, unitIdx) => {
        const unitId = newId("unt");
        // Last unit of the last property stays vacant to exercise the unit_vacant signal.
        const isVacantDemo = propIdx === propDefs.length - 1 && unitIdx === p.units.length - 1;
        db.prepare(
          `INSERT INTO units (id, property_id, label, bedrooms, bathrooms, sqft, floor,
             market_rent_cents, status, notes, sort_order, created_at, updated_at, created_by,
             updated_by, version)
           VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?, ?, ?, ?, 1)`,
        ).run(
          unitId,
          propertyId,
          u.label,
          u.beds,
          u.baths,
          700 + u.beds * 300,
          u.rent,
          isVacantDemo ? "vacant" : "occupied",
          unitIdx,
          at0,
          at0,
          uid,
          uid,
        );
        units.push({ id: unitId, label: u.label, rent: u.rent });
      });
      properties.push({ id: propertyId, name: p.name, units });
    });
  });

  // -------------------------------------------------------------- tenants + leases
  let expiringLeaseAssigned = false;
  const turnoverCandidateUnit = properties[2]!.units[0]!; // Birch Triplex, Unit 1
  tx(() => {
    properties.forEach((p, pIdx) => {
      p.units.forEach((u, uIdx) => {
        const isVacantDemo = pIdx === properties.length - 1 && uIdx === p.units.length - 1;
        const isTurnoverUnit = u.id === turnoverCandidateUnit.id;
        if (isVacantDemo) return; // no tenant/lease on the demo-vacant unit

        const firstNames = ["Alex", "Jamie", "Taylor", "Morgan", "Casey", "Riley", "Jordan", "Avery", "Quinn"];
        const lastNames = ["Nguyen", "Smith", "Garcia", "Chen", "Patel", "Brown", "Kim", "Johnson", "Davis"];
        const idx = pIdx * 3 + uIdx;
        const firstName = firstNames[idx % firstNames.length]!;
        const lastName = lastNames[idx % lastNames.length]!;

        const tenantId = newId("ten");
        const movedInAt = addMonths(today, -10 - idx);
        db.prepare(
          `INSERT INTO tenants (id, property_id, unit_id, first_name, last_name, email, phone,
             emergency_contact_name, emergency_contact_phone, notes, is_primary, moved_in_at,
             moved_out_at, created_at, updated_at, created_by, updated_by, version)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 1, ?, NULL, ?, ?, ?, ?, 1)`,
        ).run(
          tenantId,
          p.id,
          u.id,
          firstName,
          lastName,
          `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com`,
          `555-01${String(10 + idx).padStart(2, "0")}`,
          movedInAt,
          at0,
          at0,
          uid,
          uid,
        );
        indexEntity({
          entityType: "tenant",
          entityId: tenantId,
          propertyId: p.id,
          title: `${firstName} ${lastName}`,
          body: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com`,
          url: `/p/${p.id}/tenants?tenant=${tenantId}`,
          updatedAt: at0,
        });

        const leaseId = newId("lse");
        // The very first leased unit expires inside 60 days to exercise lease_expiring.
        const isExpiringDemo = !expiringLeaseAssigned && !isTurnoverUnit;
        if (isExpiringDemo) expiringLeaseAssigned = true;
        const leaseStatus = isTurnoverUnit ? "ended" : "active";
        const endDate = isExpiringDemo ? addDays(today, 35) : isTurnoverUnit ? addDays(today, -10) : null;
        db.prepare(
          `INSERT INTO leases (id, property_id, unit_id, start_date, end_date, rent_cents,
             deposit_cents, due_day, status, renewal_notice_days, document_upload_id, notes,
             created_at, updated_at, created_by, updated_by, version)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 60, NULL, NULL, ?, ?, ?, ?, 1)`,
        ).run(
          leaseId,
          p.id,
          u.id,
          movedInAt,
          endDate,
          u.rent,
          u.rent,
          leaseStatus,
          at0,
          at0,
          uid,
          uid,
        );
        db.prepare(`INSERT INTO lease_tenants (lease_id, tenant_id) VALUES (?, ?)`).run(leaseId, tenantId);
        indexEntity({
          entityType: "lease",
          entityId: leaseId,
          propertyId: p.id,
          title: `Lease: ${u.label}`,
          body: `${movedInAt} to ${endDate ?? "month-to-month"}`,
          url: `/p/${p.id}/tenants?lease=${leaseId}`,
          updatedAt: at0,
        });

        // Rent entries for the trailing 3 months, all paid except the current month partially paid.
        for (let back = 2; back >= 0; back--) {
          const period = addMonths(today, -back).slice(0, 7);
          const rentId = newId("rnt");
          const isCurrent = back === 0;
          const received = isCurrent ? Math.round(u.rent * 0.5) : u.rent;
          const status = isCurrent ? "partial" : "paid";
          db.prepare(
            `INSERT INTO rent_entries (id, property_id, unit_id, lease_id, period, amount_due_cents,
               amount_received_cents, received_on, method, status, note, created_at, updated_at,
               created_by, updated_by, version)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ach', ?, NULL, ?, ?, ?, ?, 1)`,
          ).run(
            rentId,
            p.id,
            u.id,
            leaseId,
            period,
            u.rent,
            received,
            isCurrent ? null : `${period}-03`,
            status,
            at0,
            at0,
            uid,
            uid,
          );
        }
      });
    });
  });

  // --------------------------------------------------------------------- notes
  tx(() => {
    properties.forEach((p, idx) => {
      const notes = [
        { title: "Move-in checklist", body: "Standard move-in checklist completed for all current tenants.", pinned: true },
        { title: null, body: "Landscaping company switched to Nguyen Landscaping starting this season.", pinned: false },
      ];
      notes.forEach((n) => {
        const id = newId("not");
        db.prepare(
          `INSERT INTO notes (id, property_id, unit_id, title, body, pinned, created_at, updated_at,
             created_by, updated_by, version)
           VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 1)`,
        ).run(id, p.id, n.title, n.body, n.pinned ? 1 : 0, at0, at0, uid, uid);
        indexEntity({
          entityType: "note",
          entityId: id,
          propertyId: p.id,
          title: n.title ?? "Note",
          body: n.body,
          url: `/p/${p.id}/notes?note=${id}`,
          updatedAt: at0,
        });
      });
      void idx;
    });
  });

  // --------------------------------------------------------- work orders + PM
  const WO_STATUSES = ["new", "triaged", "scheduled", "in_progress", "done", "cancelled"] as const;
  tx(() => {
    properties.forEach((p, pIdx) => {
      let woNumber = 1;
      WO_STATUSES.forEach((status, sIdx) => {
        const id = newId("wo");
        const unit = p.units[sIdx % p.units.length]!;
        const priority = sIdx === 1 ? "urgent" : sIdx % 2 === 0 ? "normal" : "high";
        const dueDate = status === "done" || status === "cancelled" ? addDays(today, -14 + sIdx) : addDays(today, sIdx % 2 === 0 ? -3 : 10);
        const completedAt = status === "done" ? nowIso() : null;
        const titles = [
          "Leaking kitchen faucet",
          "No heat in unit",
          "Replace smoke detector batteries",
          "Repaint hallway",
          "Fix broken window latch",
          "Remove old storage shed",
        ];
        const title = titles[sIdx % titles.length]!;
        db.prepare(
          `INSERT INTO work_orders (id, property_id, unit_id, number, title, description, status,
             priority, assignee_id, vendor_id, due_date, scheduled_for, completed_at,
             estimate_cents, cost_cents, source, pm_template_id, created_at, updated_at,
             created_by, updated_by, version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 'manual', NULL, ?, ?, ?, ?, 1)`,
        ).run(
          id,
          p.id,
          unit.id,
          woNumber++,
          title,
          `${title} reported by tenant. Needs attention.`,
          status,
          priority,
          uid,
          vendorFor(sIdx % 2 === 0 ? "Plumbing" : "Electrical"),
          dueDate,
          completedAt,
          15000 + sIdx * 2000,
          status === "done" ? 14000 + sIdx * 1800 : null,
          at0,
          at0,
          uid,
          uid,
        );
        indexEntity({
          entityType: "work_order",
          entityId: id,
          propertyId: p.id,
          title: `WO-${woNumber - 1} ${title}`,
          body: `${title} reported by tenant. Needs attention.`,
          url: `/p/${p.id}/maintenance?wo=${id}`,
          updatedAt: at0,
        });
      });

      // PM templates: filters quarterly, gutters semiannually, HVAC annually.
      const pmDefs: { title: string; frequency: string; intervalDays: number | null; leadDays: number }[] = [
        { title: "Replace HVAC filters", frequency: "quarterly", intervalDays: null, leadDays: 10 },
        { title: "Clean gutters", frequency: "semiannual", intervalDays: null, leadDays: 14 },
        { title: "Annual HVAC service", frequency: "annual", intervalDays: null, leadDays: 21 },
      ];
      pmDefs.forEach((pm, pmIdx) => {
        const id = newId("pmt");
        const anchor = addMonths(today, -1);
        db.prepare(
          `INSERT INTO pm_templates (id, property_id, unit_id, title, description, priority,
             assignee_id, vendor_id, frequency, interval_days, anchor_date, lead_days,
             next_due_date, last_generated_date, active, created_at, updated_at, created_by,
             updated_by, version)
           VALUES (?, ?, NULL, ?, ?, 'normal', ?, ?, ?, ?, ?, ?, ?, NULL, 1, ?, ?, ?, ?, 1)`,
        ).run(
          id,
          p.id,
          pm.title,
          `Recurring: ${pm.title.toLowerCase()}.`,
          uid,
          vendorFor("HVAC"),
          pm.frequency,
          pm.intervalDays,
          anchor,
          pm.leadDays,
          addDays(today, pmIdx === 0 ? 5 : 30 + pmIdx * 20),
          at0,
          at0,
          uid,
          uid,
        );
      });
      void pIdx;
    });
  });

  // ----------------------------------------------------------------- projects
  tx(() => {
    properties.slice(0, 3).forEach((p, idx) => {
      const projectId = newId("prj");
      const budget = 800000 + idx * 100000;
      db.prepare(
        `INSERT INTO projects (id, property_id, title, description, status, priority, owner_id,
           target_start, target_end, actual_start, actual_end, budget_cents, created_at,
           updated_at, created_by, updated_by, version)
         VALUES (?, ?, ?, ?, ?, 'normal', ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 1)`,
      ).run(
        projectId,
        p.id,
        "Exterior paint refresh",
        "Full exterior repaint and trim repair.",
        idx === 0 ? "in_progress" : "planning",
        uid,
        addMonths(today, -1),
        addMonths(today, 2),
        idx === 0 ? addMonths(today, -1) : null,
        budget,
        at0,
        at0,
        uid,
        uid,
      );
      indexEntity({
        entityType: "project",
        entityId: projectId,
        propertyId: p.id,
        title: "Exterior paint refresh",
        body: "Full exterior repaint and trim repair.",
        url: `/p/${p.id}/projects?project=${projectId}`,
        updatedAt: at0,
      });
      // Budget lines: the plan, which is nobody's money yet.
      const lines = [
        { label: "Paint and materials", amount: Math.round(budget * 0.4) },
        { label: "Labor", amount: Math.round(budget * 0.6) },
      ];
      lines.forEach((line) => {
        const id = newId("pln");
        db.prepare(
          `INSERT INTO project_lines (id, project_id, kind, label, category, amount_cents,
             incurred_on, vendor_id, note, created_at, updated_at, created_by, updated_by, version)
           VALUES (?, ?, 'budget', ?, NULL, ?, NULL, NULL, NULL, ?, ?, ?, ?, 1)`,
        ).run(id, projectId, line.label, line.amount, at0, at0, uid, uid);
      });

      // What was actually spent is a LEDGER row tagged to the project, not a
      // second cost store on the project itself. One payment, one row, seen by
      // both the renovation tab and the money page — see projects/repo.ts.
      if (idx === 0) {
        const spendId = newId("exp");
        db.prepare(
          `INSERT INTO property_expenses (id, property_id, unit_id, category, description,
             amount_cents, incurred_on, vendor_id, work_order_id, project_id, note, created_at,
             updated_at, created_by, updated_by, version)
           VALUES (?, ?, NULL, 'capex', ?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?, ?, 1)`,
        ).run(
          spendId,
          p.id,
          "Materials purchase",
          Math.round(budget * 0.42),
          addDays(today, -5),
          vendorFor("General"),
          projectId,
          at0,
          at0,
          uid,
          uid,
        );
        indexEntity({
          entityType: "property_expense",
          entityId: spendId,
          propertyId: p.id,
          title: "Materials purchase",
          body: `capex ${addDays(today, -5)}`,
          url: `/p/${p.id}/money?expense=${spendId}`,
          updatedAt: at0,
        });
      }
    });
  });

  // ----------------------------------------------------------------- expenses
  tx(() => {
    const categories = ["repair", "utility", "insurance", "landscaping", "management"] as const;
    properties.forEach((p, idx) => {
      categories.forEach((cat, cIdx) => {
        const id = newId("exp");
        db.prepare(
          `INSERT INTO property_expenses (id, property_id, unit_id, category, description,
             amount_cents, incurred_on, vendor_id, work_order_id, project_id, note, created_at,
             updated_at, created_by, updated_by, version)
           VALUES (?, ?, NULL, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, 1)`,
        ).run(
          id,
          p.id,
          cat,
          `${cat[0]!.toUpperCase()}${cat.slice(1)} expense`,
          8000 + idx * 500 + cIdx * 1200,
          addDays(today, -10 - cIdx * 6),
          cat === "landscaping" ? vendorFor("Landscaping") : null,
          at0,
          at0,
          uid,
          uid,
        );
        indexEntity({
          entityType: "property_expense",
          entityId: id,
          propertyId: p.id,
          title: `${cat} expense`,
          body: cat,
          url: `/p/${p.id}/money?expense=${id}`,
          updatedAt: at0,
        });
      });
    });
  });

  // -------------------------------------------------------------------- specs
  tx(() => {
    properties.forEach((p, idx) => {
      const specs: {
        category: string;
        label: string;
        value: string | null;
        isSecret: boolean;
      }[] = [
        { category: "filter", label: "HVAC filter size", value: "16x25x1", isSecret: false },
        { category: "shutoff", label: "Main water shutoff", value: "Basement, north wall", isSecret: false },
        { category: "code", label: "Front gate code", value: `${1000 + idx}#`, isSecret: true },
      ];
      specs.forEach((s) => {
        const id = newId("spc");
        db.prepare(
          `INSERT INTO spec_entries (id, property_id, unit_id, category, label, make, model,
             serial, value, location, is_secret, installed_on, warranty_expires_on, vendor_id,
             notes, created_at, updated_at, created_by, updated_by, version)
           VALUES (?, ?, NULL, ?, ?, NULL, NULL, NULL, ?, NULL, ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?, 1)`,
        ).run(id, p.id, s.category, s.label, s.value, s.isSecret ? 1 : 0, at0, at0, uid, uid);
        if (!s.isSecret) {
          indexEntity({
            entityType: "spec_entry",
            entityId: id,
            propertyId: p.id,
            title: s.label,
            body: `${s.category} ${s.value ?? ""}`,
            url: `/p/${p.id}/specs?spec=${id}`,
            updatedAt: at0,
          });
        }
      });
    });
  });

  // --------------------------------------------------------------- compliance
  tx(() => {
    properties.forEach((p, idx) => {
      // First property gets an overdue item; second gets a due-soon item; rest get routine items.
      const dueDate = idx === 0 ? addDays(today, -15) : idx === 1 ? addDays(today, 10) : addMonths(today, 6);
      const id = newId("cmp");
      db.prepare(
        `INSERT INTO compliance_items (id, property_id, unit_id, kind, title, authority,
           reference, due_date, lead_days, recurrence, state, completed_on, cost_cents,
           vendor_id, notes, created_at, updated_at, created_by, updated_by, version)
         VALUES (?, ?, NULL, 'insurance', ?, 'Statewide Insurance', NULL, ?, 30, 'annual', 'open',
           NULL, NULL, NULL, NULL, ?, ?, ?, ?, 1)`,
      ).run(id, p.id, "Property insurance renewal", dueDate, at0, at0, uid, uid);
      indexEntity({
        entityType: "compliance_item",
        entityId: id,
        propertyId: p.id,
        title: "Property insurance renewal",
        body: "insurance Statewide Insurance",
        url: `/p/${p.id}/compliance?item=${id}`,
        updatedAt: at0,
      });

      const id2 = newId("cmp");
      db.prepare(
        `INSERT INTO compliance_items (id, property_id, unit_id, kind, title, authority,
           reference, due_date, lead_days, recurrence, state, completed_on, cost_cents,
           vendor_id, notes, created_at, updated_at, created_by, updated_by, version)
         VALUES (?, ?, NULL, 'inspection', ?, 'City of ' || ?, NULL, ?, 45, 'annual', 'open', NULL,
           NULL, NULL, NULL, ?, ?, ?, ?, 1)`,
      ).run(id2, p.id, "Annual fire inspection", p.name.split(" ")[0], addMonths(today, 4), at0, at0, uid, uid);
      indexEntity({
        entityType: "compliance_item",
        entityId: id2,
        propertyId: p.id,
        title: "Annual fire inspection",
        body: "inspection",
        url: `/p/${p.id}/compliance?item=${id2}`,
        updatedAt: at0,
      });
    });
  });

  // ----------------------------------------------------------------- turnover
  tx(() => {
    const p = properties[2]!; // Birch Triplex
    const unit = turnoverCandidateUnit;
    const turnoverId = newId("trn");
    db.prepare(
      `INSERT INTO turnovers (id, property_id, unit_id, phase, move_out_date, target_ready_date,
         move_in_date, outgoing_lease_id, incoming_lease_id, deposit_held_cents,
         deposit_withheld_cents, deposit_returned_cents, deposit_returned_on, deposit_notes,
         condition_notes, closed_at, created_at, updated_at, created_by, updated_by, version)
       VALUES (?, ?, ?, 'make_ready', ?, ?, NULL, NULL, NULL, ?, 0, 0, NULL, NULL,
         'Minor wall scuffs, carpet needs cleaning.', NULL, ?, ?, ?, ?, 1)`,
    ).run(turnoverId, p.id, unit.id, addDays(today, -10), addDays(today, 5), unit.rent, at0, at0, uid, uid);
    indexEntity({
      entityType: "turnover",
      entityId: turnoverId,
      propertyId: p.id,
      title: `Turnover: ${unit.label}`,
      body: "Minor wall scuffs, carpet needs cleaning.",
      url: `/p/${p.id}/turnover?turnover=${turnoverId}`,
      updatedAt: at0,
    });

    const items: { phase: string; label: string; done: boolean }[] = [
      { phase: "move_out", label: "Schedule move-out walkthrough", done: true },
      { phase: "move_out", label: "Collect keys, fobs, and remotes", done: true },
      { phase: "move_out", label: "Document unit condition with photos", done: true },
      { phase: "move_out", label: "Calculate security deposit deductions", done: false },
      { phase: "make_ready", label: "Deep clean unit", done: false },
      { phase: "make_ready", label: "Patch and paint walls as needed", done: false },
      { phase: "make_ready", label: "Service HVAC filter", done: false },
      { phase: "make_ready", label: "Test smoke and CO detectors", done: false },
      { phase: "move_in", label: "Schedule move-in walkthrough", done: false },
      { phase: "move_in", label: "Confirm utilities transferred to tenant", done: false },
      { phase: "move_in", label: "Provide welcome packet and keys", done: false },
      { phase: "move_in", label: "Collect signed lease and deposit", done: false },
    ];
    items.forEach((it, idx) => {
      const id = newId("tri");
      db.prepare(
        `INSERT INTO turnover_items (id, turnover_id, phase, label, done, done_at, done_by,
           cost_cents, note, work_order_id, sort_order, created_at, updated_at, created_by,
           updated_by, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, 1)`,
      ).run(id, turnoverId, it.phase, it.label, it.done ? 1 : 0, it.done ? at0 : null, it.done ? uid : null, idx, at0, at0, uid, uid);
    });
  });

  // ------------------------------------------------------------------ uploads
  async function seedUploads(): Promise<void> {
    const sharpMod = await import("sharp");
    const sharp = sharpMod.default;
    const property = properties[0]!;

    // ---- image upload (property cover) ----
    const rawPng = await sharp({
      create: { width: 640, height: 400, channels: 3, background: { r: 120, g: 150, b: 190 } },
    })
      .png()
      .toBuffer();
    const processed = await processImage(rawPng);
    const imgId = newId("upl");
    const { relPath: imgRel, absPath: imgAbs } = storedPathFor(imgId, "jpg");
    writeFileSync(imgAbs, processed.output);
    const { relPath: thumbRel, absPath: thumbAbs } = thumbPathFor(imgId);
    writeFileSync(thumbAbs, processed.thumb);
    const imgSha = createHash("sha256").update(processed.output).digest("hex");
    const imgAt = nowIso();
    db.prepare(
      `INSERT INTO uploads (id, parent_type, parent_id, property_id, filename, stored_path,
         thumb_path, mime, kind, size_bytes, sha256, width, height, caption, uploaded_by,
         created_at, deleted_at)
       VALUES (?, 'property', ?, ?, 'cover.jpg', ?, ?, 'image/jpeg', 'image', ?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).run(
      imgId,
      property.id,
      property.id,
      imgRel,
      thumbRel,
      processed.output.length,
      imgSha,
      processed.width,
      processed.height,
      "Front exterior",
      uid,
      imgAt,
    );
    db.prepare(`UPDATE properties SET cover_upload_id = ? WHERE id = ?`).run(imgId, property.id);

    // ---- PDF upload (lease document on the first active lease we can find) ----
    const lease = db
      .prepare(`SELECT id, property_id FROM leases WHERE property_id = ? AND status = 'active' LIMIT 1`)
      .get(property.id) as { id: string; property_id: string } | undefined;
    const pdfBytes = Buffer.from(
      "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
        "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n" +
        "xref\n0 4\n0000000000 65535 f \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n0\n%%EOF\n",
      "utf8",
    );
    if (lease) {
      const pdfId = newId("upl");
      const { relPath: pdfRel, absPath: pdfAbs } = storedPathFor(pdfId, "pdf");
      writeFileSync(pdfAbs, pdfBytes);
      const pdfSha = createHash("sha256").update(pdfBytes).digest("hex");
      const pdfAt = nowIso();
      db.prepare(
        `INSERT INTO uploads (id, parent_type, parent_id, property_id, filename, stored_path,
           thumb_path, mime, kind, size_bytes, sha256, width, height, caption, uploaded_by,
           created_at, deleted_at)
         VALUES (?, 'lease', ?, ?, 'lease-agreement.pdf', ?, NULL, 'application/pdf', 'pdf', ?, ?,
           NULL, NULL, NULL, ?, ?, NULL)`,
      ).run(pdfId, lease.id, lease.property_id, pdfRel, pdfBytes.length, pdfSha, uid, pdfAt);
      db.prepare(`UPDATE leases SET document_upload_id = ? WHERE id = ?`).run(pdfId, lease.id);
    }
  }

  await seedUploads();

  seedProspect();

  const unitCount = properties.reduce((sum, p) => sum + p.units.length, 0);
  const propertyCount = properties.length + 1; // + the prospect
  return {
    seeded: true,
    properties: propertyCount,
    units: unitCount,
    vendors: vendors.length,
    message: `Seeded ${propertyCount} properties (one a prospect), ${unitCount} units, ${vendors.length} vendors.`,
  };

  // ----------------------------------------------------------------- prospect
  //
  // One house being considered, not owned. Every prospect screen (the
  // renovation tab, diligence, the discussion, plan A against plan B, the
  // utility estimate) renders against a property in this stage, and five owned
  // houses never exercise any of it. Kept OUT of `properties` above so the
  // tenant, lease, work-order and turnover passes do not give it a tenant.
  //
  // In Nags Head on purpose: 27959 is a ZIP the utility estimator knows, so the
  // numbers tab shows local rates and the borrowed-water-rate disclaimer.
  function seedProspect(): void {
    tx(() => {
      const propertyId = newId("prp");
      const at = nowIso();
      db.prepare(
        `INSERT INTO properties (id, name, address_line1, address_line2, city, state, postal_code,
           country, property_type, year_built, sqft, lot_sqft, parcel_number, purchase_date,
           purchase_price_cents, mortgage_lender, mortgage_payment_cents, insurance_carrier,
           insurance_policy_number, cover_upload_id, notes, sort_order, archived_at, hero_color,
           stage, created_at, updated_at, created_by, updated_by, version, is_demo)
         VALUES (?, 'Wrightsville Cottage', '812 W Soundside Rd', NULL, 'Nags Head', 'NC', '27959',
           'US', 'single_family', 1994, 1620, 7500, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
           NULL, ?, NULL, ?, 'prospect', ?, ?, ?, ?, 1, 1)`,
      ).run(
        propertyId,
        propDefs.length,
        HERO_COLORS[propDefs.length % HERO_COLORS.length]!.value,
        at,
        at,
        uid,
        uid,
      );
      indexEntity({
        entityType: "property",
        entityId: propertyId,
        propertyId,
        title: "Wrightsville Cottage",
        body: "812 W Soundside Rd Nags Head NC 27959",
        url: `/p/${propertyId}`,
        updatedAt: at,
      });

      // Renovation: one priced project with spend against it, one still an idea.
      const kitchenId = newId("prj");
      const deckId = newId("prj");
      const project = db.prepare(
        `INSERT INTO projects (id, property_id, title, description, status, priority, owner_id,
           target_start, target_end, actual_start, actual_end, budget_cents, created_at,
           updated_at, created_by, updated_by, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?, 1)`,
      );
      project.run(
        kitchenId, propertyId, "Kitchen and both baths",
        "Cabinets, counters, and a full re-fit of the hall bath. The primary just needs a vanity.",
        "quoted", "high", uid, 4_200_000, at, at, uid, uid,
      );
      project.run(
        deckId, propertyId, "Deck, stairs and rails",
        "Rear deck boards are soft in three places. Rails are not to code.",
        "idea", "normal", null, null, at, at, uid, uid,
      );
      const budgetLine = db.prepare(
        `INSERT INTO project_lines (id, project_id, kind, label, category, amount_cents,
           incurred_on, vendor_id, note, created_at, updated_at, created_by, updated_by, version)
         VALUES (?, ?, 'budget', ?, NULL, ?, NULL, NULL, NULL, ?, ?, ?, ?, 1)`,
      );
      budgetLine.run(newId("pln"), kitchenId, "Cabinets and counters", 2_400_000, at, at, uid, uid);
      budgetLine.run(newId("pln"), kitchenId, "Hall bath re-fit", 1_500_000, at, at, uid, uid);
      budgetLine.run(newId("pln"), kitchenId, "Primary bath vanity", 300_000, at, at, uid, uid);
      for (const p of [
        { id: kitchenId, title: "Kitchen and both baths" },
        { id: deckId, title: "Deck, stairs and rails" },
      ]) {
        indexEntity({
          entityType: "project",
          entityId: p.id,
          propertyId,
          title: p.title,
          body: "",
          url: `/p/${propertyId}/projects?project=${p.id}`,
          updatedAt: at,
        });
      }

      // Money already spent deciding, in the ledger like any other cost.
      const expense = db.prepare(
        `INSERT INTO property_expenses (id, property_id, unit_id, category, description,
           amount_cents, incurred_on, vendor_id, work_order_id, project_id, note, created_at,
           updated_at, created_by, updated_by, version)
         VALUES (?, ?, NULL, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, 1)`,
      );
      expense.run(
        newId("exp"), propertyId, "legal", "Structural inspection — deck and pilings", 65_000,
        addDays(today, -5), deckId, "Engineer's letter to follow.", at, at, uid, uid,
      );
      expense.run(newId("exp"), propertyId, "other", "Survey", 55_000, addDays(today, -4), null, null, at, at, uid, uid);

      // The discussion. One author, since the seed only knows the owner.
      const comment = db.prepare(
        `INSERT INTO property_comments (id, property_id, body, sentiment, created_at, updated_at,
           created_by, updated_by, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      );
      const thread: [string, "like" | "dislike" | null, number][] = [
        ["Walked it this morning. Sound views from the upper deck are the whole pitch — you can see the water from the kitchen too.", "like", -8],
        ["Ground floor is enclosed and it is not obvious anyone permitted it. That is either a bonus room or a problem, and I do not know which yet.", "dislike", -8],
        ["Added it to the checklist. Town will have the permit history if there is any.", null, -7],
        ["Kitchen is original. Budgeting 42k for kitchen and both baths, which is the number the whole deal turns on.", "dislike", -6],
        ["Quiet end of the road, and the lot next door is town-owned so nothing goes up beside it.", "like", -3],
      ];
      thread.forEach(([body, sentiment, day], i) => {
        // Spread across the days, in order, so the thread reads oldest first.
        const when = new Date(Date.now() + day * 86_400_000 + i * 60_000).toISOString();
        comment.run(newId("pcm"), propertyId, body, sentiment, when, when, uid, uid);
      });

      // Diligence, part-way through: some verified, some waiting, one blocked.
      const diligence = db.prepare(
        `INSERT INTO diligence_items (id, property_id, label, category, status, detail, finding,
           source_url, due_date, assignee_id, upload_id, sort_order, created_at, updated_at,
           created_by, updated_by, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?, ?, ?, ?, 1)`,
      );
      const items: {
        label: string;
        category: string;
        status: string;
        detail?: string;
        finding?: string;
        dueIn?: number;
        mine?: boolean;
      }[] = [
        {
          label: "Septic permit — and the bedroom count on it", category: "permits", status: "received",
          detail: "Ask the county environmental health office for the improvement permit and the operation permit.",
          finding: "Permit is for 3 bedrooms. Listing says 4. Waiting on the town to say which one governs occupancy.",
          dueIn: 4, mine: true,
        },
        {
          label: "Past building permits and certificates of occupancy", category: "permits", status: "requested",
          detail: "Pull the permit history from the town. The enclosed ground floor is the one to check.", dueIn: 2,
        },
        {
          label: "Short-term rental rules for this address", category: "permits", status: "todo",
          detail: "Registration, occupancy limits, parking minimums. Occupancy is often tied back to the septic permit.",
        },
        {
          label: "Elevation certificate", category: "land", status: "verified",
          detail: "Ask the seller first; the town or the surveyor may have one.",
          finding: "Finished floor 12.4ft against a BFE of 9ft. Good — the flood quote came back reasonable because of it.",
        },
        { label: "FEMA flood zone and base flood elevation", category: "land", status: "verified", finding: "Zone AE, BFE 9ft. Map dated 2020." },
        {
          label: "Survey — boundaries, setbacks, encroachments", category: "land", status: "received",
          finding: "Neighbour's shed is about 2ft over the line at the rear. Needs a decision before closing.",
        },
        {
          label: "Structural and termite inspection", category: "structure", status: "verified",
          finding: "Pilings sound. Deck framing is not — three soft boards and rails below height. See the deck project.",
        },
        {
          label: "Insurance quotes — wind and hail, and flood", category: "financial", status: "requested",
          detail: "Real quotes, not estimates. Wind and hail is a separate policy here.", dueIn: 6, mine: true,
        },
        {
          label: "Rental history, if it has been rented", category: "financial", status: "blocked",
          finding: "Seller says it has never been rented. Nothing to produce, so this is a modelling exercise now.",
        },
        { label: "HOA or POA documents and dues", category: "legal", status: "not_applicable", finding: "No association." },
      ];
      items.forEach((d, i) => {
        diligence.run(
          newId("dil"), propertyId, d.label, d.category, d.status, d.detail ?? null, d.finding ?? null,
          d.dueIn === undefined ? null : addDays(today, d.dueIn), d.mine ? uid : null, i, at, at, uid, uid,
        );
      });

      // The numbers: plan A as listed, plan B with the fourth bedroom the
      // septic permit may or may not allow — which is the question this house
      // actually poses.
      db.prepare(
        `INSERT INTO property_deal_inputs (property_id, price_cents, closing_costs_cents, rehab_cents,
           monthly_rent_cents, sqft, bedrooms, bathrooms, utilities_auto, utility_payer,
           rent_growth_pct, scenario, created_at, updated_at, created_by, updated_by, version)
         VALUES (?, 58500000, 1200000, 4200000, 340000, 1620, 3, 2, 1, 'tenant_utilities',
           3, 'financed', ?, ?, ?, ?, 1)`,
      ).run(propertyId, at, at, uid, uid);
      db.prepare(
        `INSERT INTO property_deal_variants (property_id, label, overrides, created_at, updated_at,
           created_by, updated_by, version)
         VALUES (?, 'Add a bedroom', ?, ?, ?, ?, ?, 1)`,
      ).run(
        propertyId,
        JSON.stringify({ bedrooms: 4, rehabCents: 8_000_000, monthlyRentCents: 395_000 }),
        at,
        at,
        uid,
        uid,
      );
    });
  }

}

// CLI entry: `npm run seed`. Guarded so importing this module from the server
// does not seed as a side effect.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const result = await seedDemoData({ standalone: true });
  process.stdout.write(result.message + String.fromCharCode(10));
}
