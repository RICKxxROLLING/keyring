// server/seed/seed.ts — `npm run seed`. Populates 5 properties (1-3 units each) with realistic
// data across every domain module so the app is explorable on first run. Idempotent: refuses
// (no-op) when the database already has properties.
import { loadEnv } from "../config/env.js";
import { initDb, tx } from "../db/index.js";
import { runMigrations } from "../db/migrate.js";
import { newId } from "../lib/ids.js";
import { nowIso, todayLocal, addDays, addMonths } from "../lib/time.js";
import { indexEntity } from "../search/index-entity.js";
import { processImage } from "../uploads/thumbnails.js";
import { storedPathFor, thumbPathFor } from "../uploads/storage.js";
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const env = loadEnv();
const db = initDb(env.DB_PATH);
runMigrations(db);

const existing = db.prepare(`SELECT COUNT(*) AS n FROM properties`).get() as { n: number };
if (existing.n > 0) {
  process.stdout.write("Database already has properties; refusing to reseed (idempotent no-op).\n");
  process.exit(0);
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
       updated_at, created_by, updated_by, version)
     VALUES (?, ?, ?, ?, '555-0100', ?, NULL, NULL, NULL, 4, ?, 'LIC-1000', ?, NULL, ?, ?, ?, ?, 1)`,
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
         insurance_policy_number, cover_upload_id, notes, sort_order, archived_at, created_at,
         updated_at, created_by, updated_by, version)
       VALUES (?, ?, ?, NULL, ?, ?, ?, 'US', ?, ?, ?, ?, NULL, ?, ?, 'First Regional Bank', ?,
         'Statewide Insurance', ?, NULL, NULL, ?, NULL, ?, ?, ?, ?, 1)`,
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
    const lines: { kind: "budget" | "expense"; label: string; amount: number }[] = [
      { kind: "budget", label: "Paint and materials", amount: Math.round(budget * 0.4) },
      { kind: "budget", label: "Labor", amount: Math.round(budget * 0.6) },
    ];
    if (idx === 0) {
      lines.push({ kind: "expense", label: "Materials purchase", amount: Math.round(budget * 0.42) });
    }
    lines.forEach((line) => {
      const id = newId("pln");
      db.prepare(
        `INSERT INTO project_lines (id, project_id, kind, label, category, amount_cents,
           incurred_on, vendor_id, note, created_at, updated_at, created_by, updated_by, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, 1)`,
      ).run(
        id,
        projectId,
        line.kind,
        line.label,
        line.kind === "expense" ? "capex" : null,
        line.amount,
        line.kind === "expense" ? addDays(today, -5) : null,
        line.kind === "expense" ? vendorFor("General") : null,
        at0,
        at0,
        uid,
        uid,
      );
    });
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

process.stdout.write(
  `Seeded ${properties.length} properties, ${properties.reduce((s, p) => s + p.units.length, 0)} units, ` +
    `${vendors.length} vendors.\n`,
);
