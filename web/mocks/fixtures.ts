// web/mocks/fixtures.ts — in-memory seed data + mutable store for MSW handlers (owner T4).
// Shapes are typed against shared/types.ts so drift is a compile error, not a runtime surprise.
import type {
  AttentionItem,
  AuditEntry,
  ComplianceItemView,
  Id,
  Invite,
  LeaseView,
  Notification,
  NoteView,
  PmTemplate,
  ProjectView,
  PropertyExpense,
  PropertyView,
  RentEntry,
  SpecEntryView,
  Tenant,
  TurnoverView,
  Unit,
  Upload,
  User,
  Vendor,
  WorkOrderCommentView,
  WorkOrderView,
} from "../../shared/types";

let seq = 1;
export function genId(prefix: string): Id {
  seq += 1;
  return `${prefix}_${String(seq).padStart(8, "0")}`;
}

const NOW = new Date();
function iso(daysFromNow: number, hour = 12): string {
  const d = new Date(NOW);
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}
function date(daysFromNow: number): string {
  return iso(daysFromNow).slice(0, 10);
}

export const CURRENT_USER_ID = "usr_00000001";

export const users: User[] = [
  {
    id: "usr_00000001",
    email: "riley@stoop.example",
    handle: "riley",
    displayName: "Riley Hart",
    role: "owner",
    avatarColor: "#2563eb",
    isActive: true,
    totpEnrolled: true,
    lastLoginAt: iso(0),
    createdAt: iso(-400),
    updatedAt: iso(-1),
    version: 3,
  },
  {
    id: "usr_00000002",
    email: "dana@stoop.example",
    handle: "dana",
    displayName: "Dana Marsh",
    role: "manager",
    avatarColor: "#16a34a",
    isActive: true,
    totpEnrolled: true,
    lastLoginAt: iso(-1),
    createdAt: iso(-380),
    updatedAt: iso(-2),
    version: 2,
  },
  {
    id: "usr_00000003",
    email: "sam@stoop.example",
    handle: "sam",
    displayName: "Sam Ortega",
    role: "manager",
    avatarColor: "#d97706",
    isActive: true,
    totpEnrolled: true,
    lastLoginAt: iso(-3),
    createdAt: iso(-350),
    updatedAt: iso(-3),
    version: 1,
  },
];

export function userRef(id: Id) {
  const u = users.find((x) => x.id === id);
  if (!u) return null;
  return { id: u.id, handle: u.handle, displayName: u.displayName, avatarColor: u.avatarColor };
}

function propertyBase(
  id: Id,
  name: string,
  addressLine1: string,
  city: string,
  state: string,
): Omit<PropertyView, "units" | "quickFacts" | "status" | "coverUrl"> {
  return {
    id,
    name,
    addressLine1,
    addressLine2: null,
    city,
    state,
    postalCode: "10001",
    country: "US",
    propertyType: "single_family",
    yearBuilt: 1978,
    sqft: 1800,
    lotSqft: 5000,
    parcelNumber: null,
    purchaseDate: date(-2000),
    purchasePriceCents: 32_000_000,
    mortgageLender: "Hudson Community Bank",
    mortgagePaymentCents: 145_000,
    insuranceCarrier: "Statewide Insurance",
    insurancePolicyNumber: "POL-99213",
    coverUploadId: null,
    notes: null,
    sortOrder: 0,
    archivedAt: null,
    createdAt: iso(-900),
    updatedAt: iso(-5),
    createdBy: CURRENT_USER_ID,
    updatedBy: CURRENT_USER_ID,
    version: 4,
  };
}

export const properties: PropertyView[] = [
  {
    ...propertyBase("prp_00000001", "Maple Street Duplex", "118 Maple St", "Kingston", "NY"),
    propertyType: "duplex",
    units: [],
    quickFacts: {
      unitCount: 2,
      occupiedUnits: 2,
      vacantUnits: 0,
      monthlyRentCents: 380000,
      openWorkOrders: 3,
      urgentWorkOrders: 1,
      overdueWorkOrders: 1,
      activeProjects: 1,
      nextLeaseExpiry: { unitId: "unt_00000002", unitLabel: "Unit B", endDate: date(18), daysOut: 18 },
      nextComplianceDue: { id: "cmp_00000001", title: "Fire extinguisher inspection", dueDate: date(-4), daysOut: -4 },
      ytdExpenseCents: 412000,
      ytdRentReceivedCents: 2660000,
      lastActivityAt: iso(-1),
    },
    status: "urgent",
    coverUrl: null,
  },
  {
    ...propertyBase("prp_00000002", "Birchwood Triplex", "45 Birchwood Ave", "New Paltz", "NY"),
    propertyType: "triplex",
    units: [],
    quickFacts: {
      unitCount: 3,
      occupiedUnits: 2,
      vacantUnits: 1,
      monthlyRentCents: 495000,
      openWorkOrders: 2,
      urgentWorkOrders: 0,
      overdueWorkOrders: 0,
      activeProjects: 0,
      nextLeaseExpiry: null,
      nextComplianceDue: { id: "cmp_00000002", title: "Boiler service", dueDate: date(9), daysOut: 9 },
      ytdExpenseCents: 288000,
      ytdRentReceivedCents: 3120000,
      lastActivityAt: iso(-2),
    },
    status: "attention",
    coverUrl: null,
  },
  {
    ...propertyBase("prp_00000003", "Cedar Court Single", "9 Cedar Ct", "Woodstock", "NY"),
    propertyType: "single_family",
    units: [],
    quickFacts: {
      unitCount: 1,
      occupiedUnits: 1,
      vacantUnits: 0,
      monthlyRentCents: 260000,
      openWorkOrders: 0,
      urgentWorkOrders: 0,
      overdueWorkOrders: 0,
      activeProjects: 0,
      nextLeaseExpiry: { unitId: "unt_00000006", unitLabel: "Main", endDate: date(220), daysOut: 220 },
      nextComplianceDue: null,
      ytdExpenseCents: 54000,
      ytdRentReceivedCents: 2080000,
      lastActivityAt: iso(-7),
    },
    status: "stable",
    coverUrl: null,
  },
  {
    ...propertyBase("prp_00000004", "Elm Fourplex", "220 Elm St", "Saugerties", "NY"),
    propertyType: "fourplex",
    units: [],
    quickFacts: {
      unitCount: 3,
      occupiedUnits: 2,
      vacantUnits: 1,
      monthlyRentCents: 510000,
      openWorkOrders: 1,
      urgentWorkOrders: 0,
      overdueWorkOrders: 0,
      activeProjects: 1,
      nextLeaseExpiry: null,
      nextComplianceDue: { id: "cmp_00000003", title: "Elevator permit renewal", dueDate: date(40), daysOut: 40 },
      ytdExpenseCents: 610000,
      ytdRentReceivedCents: 4080000,
      lastActivityAt: iso(-1),
    },
    status: "attention",
    coverUrl: null,
  },
  {
    ...propertyBase("prp_00000005", "Riverside Condo", "3 Riverside Dr #204", "Kingston", "NY"),
    propertyType: "condo",
    units: [],
    quickFacts: {
      unitCount: 1,
      occupiedUnits: 1,
      vacantUnits: 0,
      monthlyRentCents: 220000,
      openWorkOrders: 0,
      urgentWorkOrders: 0,
      overdueWorkOrders: 0,
      activeProjects: 0,
      nextLeaseExpiry: null,
      nextComplianceDue: null,
      ytdExpenseCents: 31000,
      ytdRentReceivedCents: 1760000,
      lastActivityAt: iso(-14),
    },
    status: "stable",
    coverUrl: null,
  },
];

export const units: Unit[] = [
  { id: "unt_00000001", propertyId: "prp_00000001", label: "Unit A", bedrooms: 2, bathrooms: 1, sqft: 900, floor: "1", marketRentCents: 190000, status: "occupied", notes: null, sortOrder: 0, createdAt: iso(-900), updatedAt: iso(-5), createdBy: CURRENT_USER_ID, updatedBy: CURRENT_USER_ID, version: 2 },
  { id: "unt_00000002", propertyId: "prp_00000001", label: "Unit B", bedrooms: 2, bathrooms: 1, sqft: 900, floor: "2", marketRentCents: 190000, status: "occupied", notes: null, sortOrder: 1, createdAt: iso(-900), updatedAt: iso(-5), createdBy: CURRENT_USER_ID, updatedBy: CURRENT_USER_ID, version: 2 },
  { id: "unt_00000003", propertyId: "prp_00000002", label: "Unit 1", bedrooms: 1, bathrooms: 1, sqft: 650, floor: "1", marketRentCents: 155000, status: "occupied", notes: null, sortOrder: 0, createdAt: iso(-800), updatedAt: iso(-5), createdBy: CURRENT_USER_ID, updatedBy: CURRENT_USER_ID, version: 1 },
  { id: "unt_00000004", propertyId: "prp_00000002", label: "Unit 2", bedrooms: 1, bathrooms: 1, sqft: 650, floor: "2", marketRentCents: 155000, status: "occupied", notes: null, sortOrder: 1, createdAt: iso(-800), updatedAt: iso(-5), createdBy: CURRENT_USER_ID, updatedBy: CURRENT_USER_ID, version: 1 },
  { id: "unt_00000005", propertyId: "prp_00000002", label: "Unit 3", bedrooms: 2, bathrooms: 1, sqft: 800, floor: "3", marketRentCents: 185000, status: "vacant", notes: "Mid-turnover, target ready in 2 weeks.", sortOrder: 2, createdAt: iso(-800), updatedAt: iso(-2), createdBy: CURRENT_USER_ID, updatedBy: CURRENT_USER_ID, version: 3 },
  { id: "unt_00000006", propertyId: "prp_00000003", label: "Main", bedrooms: 3, bathrooms: 2, sqft: 1800, floor: null, marketRentCents: 260000, status: "occupied", notes: null, sortOrder: 0, createdAt: iso(-700), updatedAt: iso(-7), createdBy: CURRENT_USER_ID, updatedBy: CURRENT_USER_ID, version: 1 },
  { id: "unt_00000007", propertyId: "prp_00000004", label: "Unit 1", bedrooms: 2, bathrooms: 1, sqft: 750, floor: "1", marketRentCents: 170000, status: "occupied", notes: null, sortOrder: 0, createdAt: iso(-600), updatedAt: iso(-1), createdBy: CURRENT_USER_ID, updatedBy: CURRENT_USER_ID, version: 1 },
  { id: "unt_00000008", propertyId: "prp_00000004", label: "Unit 2", bedrooms: 2, bathrooms: 1, sqft: 750, floor: "1", marketRentCents: 170000, status: "occupied", notes: null, sortOrder: 1, createdAt: iso(-600), updatedAt: iso(-1), createdBy: CURRENT_USER_ID, updatedBy: CURRENT_USER_ID, version: 1 },
  { id: "unt_00000009", propertyId: "prp_00000004", label: "Unit 3", bedrooms: 1, bathrooms: 1, sqft: 600, floor: "2", marketRentCents: 170000, status: "vacant", notes: null, sortOrder: 2, createdAt: iso(-600), updatedAt: iso(-3), createdBy: CURRENT_USER_ID, updatedBy: CURRENT_USER_ID, version: 1 },
  { id: "unt_00000010", propertyId: "prp_00000005", label: "204", bedrooms: 1, bathrooms: 1, sqft: 700, floor: "2", marketRentCents: 220000, status: "occupied", notes: null, sortOrder: 0, createdAt: iso(-500), updatedAt: iso(-14), createdBy: CURRENT_USER_ID, updatedBy: CURRENT_USER_ID, version: 1 },
];
for (const p of properties) p.units = units.filter((u) => u.propertyId === p.id);

export const vendors: Vendor[] = [
  { id: "ven_00000001", name: "Hudson Plumbing", company: "Hudson Plumbing LLC", trade: "Plumbing", phone: "845-555-0111", email: "dispatch@hudsonplumbing.example", website: null, address: null, notes: "Fast on emergencies.", rating: 5, preferred: true, licenseNumber: "PL-4471", insuranceExpiresOn: date(300), archivedAt: null, createdAt: iso(-500), updatedAt: iso(-30), createdBy: CURRENT_USER_ID, updatedBy: CURRENT_USER_ID, version: 1 },
  { id: "ven_00000002", name: "Catskill Electric", company: null, trade: "Electrical", phone: "845-555-0122", email: null, website: null, address: null, notes: null, rating: 4, preferred: false, licenseNumber: "EL-2290", insuranceExpiresOn: date(120), archivedAt: null, createdAt: iso(-450), updatedAt: iso(-60), createdBy: CURRENT_USER_ID, updatedBy: CURRENT_USER_ID, version: 1 },
  { id: "ven_00000003", name: "Valley HVAC", company: "Valley HVAC Inc", trade: "HVAC", phone: "845-555-0133", email: "info@valleyhvac.example", website: "https://valleyhvac.example", address: null, notes: null, rating: 3, preferred: false, licenseNumber: null, insuranceExpiresOn: null, archivedAt: null, createdAt: iso(-300), updatedAt: iso(-90), createdBy: CURRENT_USER_ID, updatedBy: CURRENT_USER_ID, version: 1 },
];

function vendorRef(id: Id | null): Vendor | null {
  return vendors.find((v) => v.id === id) ?? null;
}

export const notes: NoteView[] = [
  { id: "not_00000001", propertyId: "prp_00000001", unitId: null, title: "Gate code", body: "Front gate code is 4471#. Share only with vendors on the day of the visit.", pinned: true, createdAt: iso(-40), updatedAt: iso(-2), createdBy: CURRENT_USER_ID, updatedBy: "usr_00000002", version: 3, author: userRef(CURRENT_USER_ID), lastEditor: userRef("usr_00000002"), attachments: [] },
  { id: "not_00000002", propertyId: "prp_00000001", unitId: "unt_00000002", title: null, body: "Tenant in Unit B mentioned a slow drain in the kitchen sink, not urgent yet.", pinned: false, createdAt: iso(-5), updatedAt: iso(-5), createdBy: "usr_00000002", updatedBy: "usr_00000002", version: 1, author: userRef("usr_00000002"), lastEditor: userRef("usr_00000002"), attachments: [] },
  { id: "not_00000003", propertyId: "prp_00000002", unitId: null, title: "Trash pickup", body: "Trash pickup moved to Thursdays as of March. @dana please update the tenant flyer.", pinned: true, createdAt: iso(-20), updatedAt: iso(-20), createdBy: "usr_00000003", updatedBy: "usr_00000003", version: 1, author: userRef("usr_00000003"), lastEditor: userRef("usr_00000003"), attachments: [] },
  { id: "not_00000004", propertyId: "prp_00000004", unitId: null, title: null, body: "Elm St has a shared driveway easement with 218 Elm — see spec vault for the survey.", pinned: false, createdAt: iso(-60), updatedAt: iso(-60), createdBy: CURRENT_USER_ID, updatedBy: CURRENT_USER_ID, version: 1, author: userRef(CURRENT_USER_ID), lastEditor: userRef(CURRENT_USER_ID), attachments: [] },
];

function workOrder(input: {
  id: Id;
  propertyId: Id;
  unitId: Id | null;
  number: number;
  title: string;
  description: string | null;
  status: WorkOrderView["status"];
  priority: WorkOrderView["priority"];
  assigneeId: Id | null;
  vendorId: Id | null;
  dueDate: string | null;
  isOverdue: boolean;
  source?: WorkOrderView["source"];
}): WorkOrderView {
  const property = properties.find((p) => p.id === input.propertyId);
  const unit = units.find((u) => u.id === input.unitId);
  return {
    id: input.id,
    propertyId: input.propertyId,
    unitId: input.unitId,
    number: input.number,
    title: input.title,
    description: input.description,
    status: input.status,
    priority: input.priority,
    assigneeId: input.assigneeId,
    vendorId: input.vendorId,
    dueDate: input.dueDate,
    scheduledFor: null,
    completedAt: input.status === "done" ? iso(-1) : null,
    estimateCents: 25000,
    costCents: input.status === "done" ? 24000 : null,
    source: input.source ?? "manual",
    pmTemplateId: null,
    createdAt: iso(-30),
    updatedAt: iso(-1),
    createdBy: CURRENT_USER_ID,
    updatedBy: CURRENT_USER_ID,
    version: 2,
    unitLabel: unit?.label ?? null,
    propertyName: property?.name ?? "",
    assignee: input.assigneeId ? userRef(input.assigneeId) : null,
    vendor: vendorRef(input.vendorId),
    commentCount: 0,
    attachments: [],
    isOverdue: input.isOverdue,
  };
}

export const workOrders: WorkOrderView[] = [
  workOrder({ id: "wo_00000001", propertyId: "prp_00000001", unitId: "unt_00000002", number: 1, title: "Replace kitchen faucet cartridge", description: "Dripping constantly, tenant reported it a week ago.", status: "new", priority: "high", assigneeId: null, vendorId: "ven_00000001", dueDate: date(-4), isOverdue: true }),
  workOrder({ id: "wo_00000002", propertyId: "prp_00000001", unitId: null, number: 2, title: "Roof gutter cleaning", description: null, status: "triaged", priority: "normal", assigneeId: "usr_00000002", vendorId: null, dueDate: date(10), isOverdue: false }),
  workOrder({ id: "wo_00000003", propertyId: "prp_00000001", unitId: "unt_00000001", number: 3, title: "Smoke detector battery replacement", description: null, status: "scheduled", priority: "urgent", assigneeId: "usr_00000003", vendorId: null, dueDate: date(2), isOverdue: false }),
  workOrder({ id: "wo_00000004", propertyId: "prp_00000002", unitId: "unt_00000005", number: 1, title: "Repaint unit before move-in", description: "Part of the current turnover.", status: "in_progress", priority: "normal", assigneeId: "usr_00000002", vendorId: null, dueDate: date(6), isOverdue: false }),
  workOrder({ id: "wo_00000005", propertyId: "prp_00000002", unitId: null, number: 2, title: "Replace hallway light fixture", description: null, status: "done", priority: "low", assigneeId: CURRENT_USER_ID, vendorId: "ven_00000002", dueDate: date(-10), isOverdue: false }),
  workOrder({ id: "wo_00000006", propertyId: "prp_00000004", unitId: "unt_00000008", number: 1, title: "HVAC annual service", description: null, status: "scheduled", priority: "normal", assigneeId: null, vendorId: "ven_00000003", dueDate: date(15), isOverdue: false, source: "pm" }),
  workOrder({ id: "wo_00000007", propertyId: "prp_00000003", unitId: "unt_00000006", number: 1, title: "Gutter guard install", description: null, status: "cancelled", priority: "low", assigneeId: null, vendorId: null, dueDate: null, isOverdue: false }),
];

export const workOrderComments: WorkOrderCommentView[] = [
  { id: "woc_00000001", workOrderId: "wo_00000001", body: "Called Hudson Plumbing, they can come Thursday.", createdAt: iso(-2), updatedAt: iso(-2), createdBy: "usr_00000002", updatedBy: "usr_00000002", version: 1, author: userRef("usr_00000002"), attachments: [] },
];

export const pmTemplates: PmTemplate[] = [
  { id: "pmt_00000001", propertyId: "prp_00000004", unitId: "unt_00000008", title: "HVAC annual service", description: "Full system check before summer.", priority: "normal", assigneeId: null, vendorId: "ven_00000003", frequency: "annual", intervalDays: null, anchorDate: date(-350), leadDays: 14, nextDueDate: date(15), lastGeneratedDate: date(-350), active: true, createdAt: iso(-400), updatedAt: iso(-350), createdBy: CURRENT_USER_ID, updatedBy: CURRENT_USER_ID, version: 1 },
  { id: "pmt_00000002", propertyId: "prp_00000001", unitId: null, title: "Furnace filter change", description: null, priority: "low", assigneeId: null, vendorId: null, frequency: "quarterly", intervalDays: null, anchorDate: date(-80), leadDays: 5, nextDueDate: date(5), lastGeneratedDate: date(-80), active: true, createdAt: iso(-300), updatedAt: iso(-80), createdBy: CURRENT_USER_ID, updatedBy: CURRENT_USER_ID, version: 1 },
];

export const projects: ProjectView[] = [
  {
    id: "prj_00000001", propertyId: "prp_00000001", title: "Exterior paint refresh", description: "Full exterior repaint, both units.", status: "in_progress", priority: "normal", ownerId: CURRENT_USER_ID, targetStart: date(-30), targetEnd: date(20), actualStart: date(-25), actualEnd: null, budgetCents: 600000,
    createdAt: iso(-60), updatedAt: iso(-1), createdBy: CURRENT_USER_ID, updatedBy: CURRENT_USER_ID, version: 4,
    owner: userRef(CURRENT_USER_ID),
    lines: [
      { id: "pln_00000001", projectId: "prj_00000001", kind: "budget", label: "Paint + materials", category: null, amountCents: 350000, incurredOn: null, vendorId: null, note: null, createdAt: iso(-60), updatedAt: iso(-60), createdBy: CURRENT_USER_ID, updatedBy: CURRENT_USER_ID, version: 1 },
      { id: "pln_00000002", projectId: "prj_00000001", kind: "budget", label: "Labor", category: null, amountCents: 250000, incurredOn: null, vendorId: null, note: null, createdAt: iso(-60), updatedAt: iso(-60), createdBy: CURRENT_USER_ID, updatedBy: CURRENT_USER_ID, version: 1 },
      { id: "pln_00000003", projectId: "prj_00000001", kind: "expense", label: "Scaffolding rental", category: "repair", amountCents: 210000, incurredOn: date(-20), vendorId: null, note: null, createdAt: iso(-20), updatedAt: iso(-20), createdBy: CURRENT_USER_ID, updatedBy: CURRENT_USER_ID, version: 1 },
      { id: "pln_00000004", projectId: "prj_00000001", kind: "expense", label: "Paint (2 coats, both units)", category: "repair", amountCents: 480000, incurredOn: date(-3), vendorId: null, note: "Went over — extra prep coat needed.", createdAt: iso(-3), updatedAt: iso(-3), createdBy: "usr_00000002", updatedBy: "usr_00000002", version: 1 },
    ],
    budgetTotalCents: 600000,
    actualTotalCents: 690000,
    varianceCents: -90000,
    attachments: [],
  },
  {
    id: "prj_00000002", propertyId: "prp_00000004", title: "Add off-street parking", description: "Convert side yard into two parking spots.", status: "planning", priority: "low", ownerId: "usr_00000003", targetStart: date(60), targetEnd: date(120), actualStart: null, actualEnd: null, budgetCents: 900000,
    createdAt: iso(-10), updatedAt: iso(-10), createdBy: "usr_00000003", updatedBy: "usr_00000003", version: 1,
    owner: userRef("usr_00000003"),
    lines: [],
    budgetTotalCents: 900000,
    actualTotalCents: 0,
    varianceCents: 900000,
    attachments: [],
  },
];

export const tenants: Tenant[] = [
  { id: "ten_00000001", propertyId: "prp_00000001", unitId: "unt_00000001", firstName: "Marcus", lastName: "Lee", email: "marcus.lee@example.com", phone: "845-555-0201", emergencyContactName: "Ivy Lee", emergencyContactPhone: "845-555-0202", notes: null, isPrimary: true, movedInAt: date(-500), movedOutAt: null, createdAt: iso(-500), updatedAt: iso(-500), createdBy: CURRENT_USER_ID, updatedBy: CURRENT_USER_ID, version: 1 },
  { id: "ten_00000002", propertyId: "prp_00000001", unitId: "unt_00000002", firstName: "Priya", lastName: "Nair", email: "priya.nair@example.com", phone: "845-555-0203", emergencyContactName: null, emergencyContactPhone: null, notes: null, isPrimary: true, movedInAt: date(-300), movedOutAt: null, createdAt: iso(-300), updatedAt: iso(-300), createdBy: CURRENT_USER_ID, updatedBy: CURRENT_USER_ID, version: 1 },
  { id: "ten_00000003", propertyId: "prp_00000002", unitId: "unt_00000003", firstName: "Tom", lastName: "Byrne", email: "tom.byrne@example.com", phone: "845-555-0204", emergencyContactName: null, emergencyContactPhone: null, notes: null, isPrimary: true, movedInAt: date(-600), movedOutAt: null, createdAt: iso(-600), updatedAt: iso(-600), createdBy: CURRENT_USER_ID, updatedBy: CURRENT_USER_ID, version: 1 },
  { id: "ten_00000004", propertyId: "prp_00000003", unitId: "unt_00000006", firstName: "Alicia", lastName: "Gomez", email: "alicia.gomez@example.com", phone: "845-555-0205", emergencyContactName: null, emergencyContactPhone: null, notes: null, isPrimary: true, movedInAt: date(-200), movedOutAt: null, createdAt: iso(-200), updatedAt: iso(-200), createdBy: CURRENT_USER_ID, updatedBy: CURRENT_USER_ID, version: 1 },
];

export const leases: LeaseView[] = [
  { id: "lse_00000001", propertyId: "prp_00000001", unitId: "unt_00000001", startDate: date(-500), endDate: date(230), rentCents: 190000, depositCents: 190000, dueDay: 1, status: "active", renewalNoticeDays: 60, documentUploadId: null, notes: null, createdAt: iso(-500), updatedAt: iso(-500), createdBy: CURRENT_USER_ID, updatedBy: CURRENT_USER_ID, version: 1, unitLabel: "Unit A", tenants: [tenants[0]!], daysUntilExpiry: 230, attachments: [] },
  { id: "lse_00000002", propertyId: "prp_00000001", unitId: "unt_00000002", startDate: date(-300), endDate: date(18), rentCents: 190000, depositCents: 190000, dueDay: 1, status: "active", renewalNoticeDays: 60, documentUploadId: null, notes: "Tenant has not confirmed renewal yet.", createdAt: iso(-300), updatedAt: iso(-300), createdBy: CURRENT_USER_ID, updatedBy: CURRENT_USER_ID, version: 1, unitLabel: "Unit B", tenants: [tenants[1]!], daysUntilExpiry: 18, attachments: [] },
  { id: "lse_00000003", propertyId: "prp_00000002", unitId: "unt_00000003", startDate: date(-600), endDate: null, rentCents: 155000, depositCents: 155000, dueDay: 1, status: "active", renewalNoticeDays: 60, documentUploadId: null, notes: "Month-to-month.", createdAt: iso(-600), updatedAt: iso(-600), createdBy: CURRENT_USER_ID, updatedBy: CURRENT_USER_ID, version: 1, unitLabel: "Unit 1", tenants: [tenants[2]!], daysUntilExpiry: null, attachments: [] },
  { id: "lse_00000004", propertyId: "prp_00000003", unitId: "unt_00000006", startDate: date(-200), endDate: date(220), rentCents: 260000, depositCents: 260000, dueDay: 1, status: "active", renewalNoticeDays: 60, documentUploadId: null, notes: null, createdAt: iso(-200), updatedAt: iso(-200), createdBy: CURRENT_USER_ID, updatedBy: CURRENT_USER_ID, version: 1, unitLabel: "Main", tenants: [tenants[3]!], daysUntilExpiry: 220, attachments: [] },
];

function rentEntry(id: Id, propertyId: Id, unitId: Id, leaseId: Id, period: string, dueCents: number, receivedCents: number, status: RentEntry["status"]): RentEntry {
  return { id, propertyId, unitId, leaseId, period, amountDueCents: dueCents, amountReceivedCents: receivedCents, receivedOn: receivedCents > 0 ? date(-2) : null, method: receivedCents > 0 ? "ach" : null, status, note: null, createdAt: iso(-30), updatedAt: iso(-2), createdBy: CURRENT_USER_ID, updatedBy: CURRENT_USER_ID, version: 1 };
}

export const rentEntries: RentEntry[] = [
  rentEntry("rnt_00000001", "prp_00000001", "unt_00000001", "lse_00000001", currentPeriod(), 190000, 190000, "paid"),
  rentEntry("rnt_00000002", "prp_00000001", "unt_00000002", "lse_00000002", currentPeriod(), 190000, 0, "unpaid"),
  rentEntry("rnt_00000003", "prp_00000002", "unt_00000003", "lse_00000003", currentPeriod(), 155000, 155000, "paid"),
  rentEntry("rnt_00000004", "prp_00000003", "unt_00000006", "lse_00000004", currentPeriod(), 260000, 260000, "paid"),
];

function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7);
}

export const expenses: PropertyExpense[] = [
  { id: "exp_00000001", propertyId: "prp_00000001", unitId: null, category: "repair", description: "Faucet parts", amountCents: 4200, incurredOn: date(-3), vendorId: "ven_00000001", workOrderId: "wo_00000001", projectId: null, note: null, createdAt: iso(-3), updatedAt: iso(-3), createdBy: "usr_00000002", updatedBy: "usr_00000002", version: 1 },
  { id: "exp_00000002", propertyId: "prp_00000001", unitId: null, category: "capex", description: "Exterior paint (materials + labor)", amountCents: 690000, incurredOn: date(-3), vendorId: null, workOrderId: null, projectId: "prj_00000001", note: null, createdAt: iso(-3), updatedAt: iso(-3), createdBy: CURRENT_USER_ID, updatedBy: CURRENT_USER_ID, version: 1 },
  { id: "exp_00000003", propertyId: "prp_00000004", unitId: null, category: "utility", description: "Common area electric", amountCents: 18000, incurredOn: date(-15), vendorId: null, workOrderId: null, projectId: null, note: null, createdAt: iso(-15), updatedAt: iso(-15), createdBy: CURRENT_USER_ID, updatedBy: CURRENT_USER_ID, version: 1 },
];

export const specs: SpecEntryView[] = [
  { id: "spc_00000001", propertyId: "prp_00000001", unitId: "unt_00000001", category: "appliance", label: "Kitchen fridge", make: "Whirlpool", model: "WRT518SZFM", serial: "WP-8827412", value: null, valueMasked: false, location: "Kitchen", isSecret: false, installedOn: date(-800), warrantyExpiresOn: date(-30), vendorId: null, notes: null, createdAt: iso(-800), updatedAt: iso(-800), createdBy: CURRENT_USER_ID, updatedBy: CURRENT_USER_ID, version: 1, attachments: [] },
  { id: "spc_00000002", propertyId: "prp_00000001", unitId: null, category: "filter", label: "Furnace filter size", make: null, model: null, serial: null, value: "16x25x1", valueMasked: false, location: "Basement utility closet", isSecret: false, installedOn: null, warrantyExpiresOn: null, vendorId: null, notes: null, createdAt: iso(-200), updatedAt: iso(-200), createdBy: CURRENT_USER_ID, updatedBy: CURRENT_USER_ID, version: 1, attachments: [] },
  { id: "spc_00000003", propertyId: "prp_00000001", unitId: null, category: "shutoff", label: "Main gate code", make: null, model: null, serial: null, value: null, valueMasked: true, location: "Front gate", isSecret: true, installedOn: null, warrantyExpiresOn: null, vendorId: null, notes: "Reveal only for vendors on-site.", createdAt: iso(-200), updatedAt: iso(-200), createdBy: CURRENT_USER_ID, updatedBy: CURRENT_USER_ID, version: 1, attachments: [] },
];
const SECRET_VALUES: Record<Id, string> = { spc_00000003: "4471#" };

export const compliance: ComplianceItemView[] = [
  { id: "cmp_00000001", propertyId: "prp_00000001", unitId: null, kind: "inspection", title: "Fire extinguisher inspection", authority: "Kingston Fire Dept", reference: null, dueDate: date(-4), leadDays: 14, recurrence: "annual", state: "open", completedOn: null, costCents: null, vendorId: null, notes: null, createdAt: iso(-380), updatedAt: iso(-380), createdBy: CURRENT_USER_ID, updatedBy: CURRENT_USER_ID, version: 1, status: "overdue", daysOut: -4, attachments: [] },
  { id: "cmp_00000002", propertyId: "prp_00000002", unitId: null, kind: "inspection", title: "Boiler service", authority: null, reference: null, dueDate: date(9), leadDays: 14, recurrence: "annual", state: "open", completedOn: null, costCents: null, vendorId: "ven_00000003", notes: null, createdAt: iso(-350), updatedAt: iso(-350), createdBy: CURRENT_USER_ID, updatedBy: CURRENT_USER_ID, version: 1, status: "due_soon", daysOut: 9, attachments: [] },
  { id: "cmp_00000003", propertyId: "prp_00000004", unitId: null, kind: "permit", title: "Elevator permit renewal", authority: "NY DOB", reference: "EL-1123", dueDate: date(40), leadDays: 30, recurrence: "annual", state: "open", completedOn: null, costCents: null, vendorId: null, notes: null, createdAt: iso(-320), updatedAt: iso(-320), createdBy: CURRENT_USER_ID, updatedBy: CURRENT_USER_ID, version: 1, status: "ok", daysOut: 40, attachments: [] },
  { id: "cmp_00000004", propertyId: "prp_00000001", unitId: null, kind: "insurance", title: "Landlord policy renewal", authority: null, reference: "POL-99213", dueDate: date(-120), leadDays: 30, recurrence: "annual", state: "done", completedOn: date(-118), costCents: 210000, vendorId: null, notes: null, createdAt: iso(-480), updatedAt: iso(-118), createdBy: CURRENT_USER_ID, updatedBy: CURRENT_USER_ID, version: 2, status: "done", daysOut: -120, attachments: [] },
];

export const turnovers: TurnoverView[] = [
  {
    id: "trn_00000001", propertyId: "prp_00000002", unitId: "unt_00000005", phase: "make_ready", moveOutDate: date(-10), targetReadyDate: date(6), moveInDate: null, outgoingLeaseId: null, incomingLeaseId: null,
    depositHeldCents: 155000, depositWithheldCents: 0, depositReturnedCents: 0, depositReturnedOn: null, depositNotes: null, conditionNotes: "Minor wall scuffs, needs paint. Carpet is fine.",
    closedAt: null, createdAt: iso(-10), updatedAt: iso(-1), createdBy: CURRENT_USER_ID, updatedBy: "usr_00000002", version: 3,
    unitLabel: "Unit 3",
    items: [
      { id: "tri_00000001", turnoverId: "trn_00000001", phase: "move_out", label: "Final walkthrough", done: true, doneAt: iso(-10), doneBy: CURRENT_USER_ID, costCents: null, note: null, workOrderId: null, sortOrder: 0, createdAt: iso(-10), updatedAt: iso(-10), createdBy: CURRENT_USER_ID, updatedBy: CURRENT_USER_ID, version: 1 },
      { id: "tri_00000002", turnoverId: "trn_00000001", phase: "move_out", label: "Return deposit accounting sent", done: true, doneAt: iso(-9), doneBy: CURRENT_USER_ID, costCents: null, note: null, workOrderId: null, sortOrder: 1, createdAt: iso(-10), updatedAt: iso(-9), createdBy: CURRENT_USER_ID, updatedBy: CURRENT_USER_ID, version: 1 },
      { id: "tri_00000003", turnoverId: "trn_00000001", phase: "make_ready", label: "Repaint", done: false, doneAt: null, doneBy: null, costCents: null, note: null, workOrderId: "wo_00000004", sortOrder: 2, createdAt: iso(-10), updatedAt: iso(-10), createdBy: CURRENT_USER_ID, updatedBy: CURRENT_USER_ID, version: 1 },
      { id: "tri_00000004", turnoverId: "trn_00000001", phase: "make_ready", label: "Deep clean", done: false, doneAt: null, doneBy: null, costCents: null, note: null, workOrderId: null, sortOrder: 3, createdAt: iso(-10), updatedAt: iso(-10), createdBy: CURRENT_USER_ID, updatedBy: CURRENT_USER_ID, version: 1 },
      { id: "tri_00000005", turnoverId: "trn_00000001", phase: "make_ready", label: "Replace HVAC filter", done: false, doneAt: null, doneBy: null, costCents: null, note: null, workOrderId: null, sortOrder: 4, createdAt: iso(-10), updatedAt: iso(-10), createdBy: CURRENT_USER_ID, updatedBy: CURRENT_USER_ID, version: 1 },
      { id: "tri_00000006", turnoverId: "trn_00000001", phase: "move_in", label: "New tenant orientation", done: false, doneAt: null, doneBy: null, costCents: null, note: null, workOrderId: null, sortOrder: 5, createdAt: iso(-10), updatedAt: iso(-10), createdBy: CURRENT_USER_ID, updatedBy: CURRENT_USER_ID, version: 1 },
    ],
    progress: { done: 2, total: 6 },
    attachments: [],
  },
];

export const uploads: Upload[] = [];

export const notifications: Notification[] = [
  { id: "ntf_00000001", userId: CURRENT_USER_ID, type: "mention", title: "Dana mentioned you", body: "@riley please update the tenant flyer", propertyId: "prp_00000002", entityType: "note", entityId: "not_00000003", url: "/p/prp_00000002/notes", actor: userRef("usr_00000003"), createdAt: iso(-1), readAt: null },
  { id: "ntf_00000002", userId: CURRENT_USER_ID, type: "compliance_due", title: "Fire extinguisher inspection overdue", body: "Maple Street Duplex — 4 days overdue", propertyId: "prp_00000001", entityType: "compliance_item", entityId: "cmp_00000001", url: "/p/prp_00000001/compliance", actor: null, createdAt: iso(-4), readAt: null },
  { id: "ntf_00000003", userId: CURRENT_USER_ID, type: "assignment", title: "Assigned: Smoke detector battery replacement", body: "Maple Street Duplex, Unit A", propertyId: "prp_00000001", entityType: "work_order", entityId: "wo_00000003", url: "/p/prp_00000001/maintenance?wo=wo_00000003", actor: userRef(CURRENT_USER_ID), createdAt: iso(-6), readAt: iso(-5) },
];

export const invites: Invite[] = [];

export const auditEntries: AuditEntry[] = [
  { id: "aud_00000001", at: iso(-1), actor: userRef("usr_00000002"), actorLabel: "Dana Marsh", action: "update", entityType: "note", entityId: "not_00000001", propertyId: "prp_00000001", summary: 'edited note "Gate code"', before: { body: "old text" }, after: { body: "new text" }, ip: "203.0.113.4" },
  { id: "aud_00000002", at: iso(-2), actor: userRef(CURRENT_USER_ID), actorLabel: "Riley Hart", action: "update", entityType: "work_order", entityId: "wo_00000001", propertyId: "prp_00000001", summary: "changed status new -> triaged on \"Replace kitchen faucet cartridge\"", before: { status: "new" }, after: { status: "triaged" }, ip: "203.0.113.7" },
  { id: "aud_00000003", at: iso(-3), actor: userRef("usr_00000003"), actorLabel: "Sam Ortega", action: "create", entityType: "project", entityId: "prj_00000002", propertyId: "prp_00000004", summary: 'created project "Add off-street parking"', before: null, after: null, ip: "203.0.113.9" },
];

export const attentionItems: AttentionItem[] = [
  { id: "work_order_overdue:wo_00000001", kind: "work_order_overdue", severity: "urgent", propertyId: "prp_00000001", propertyName: "Maple Street Duplex", unitId: "unt_00000002", unitLabel: "Unit B", entityType: "work_order", entityId: "wo_00000001", title: "Replace kitchen faucet cartridge", detail: "4 days overdue", date: date(-4), daysOut: -4, url: "/p/prp_00000001/maintenance?wo=wo_00000001" },
  { id: "work_order_urgent:wo_00000003", kind: "work_order_urgent", severity: "warning", propertyId: "prp_00000001", propertyName: "Maple Street Duplex", unitId: "unt_00000001", unitLabel: "Unit A", entityType: "work_order", entityId: "wo_00000003", title: "Smoke detector battery replacement", detail: "Marked urgent, due in 2 days", date: date(2), daysOut: 2, url: "/p/prp_00000001/maintenance?wo=wo_00000003" },
  { id: "compliance_overdue:cmp_00000001", kind: "compliance_overdue", severity: "urgent", propertyId: "prp_00000001", propertyName: "Maple Street Duplex", unitId: null, unitLabel: null, entityType: "compliance_item", entityId: "cmp_00000001", title: "Fire extinguisher inspection", detail: "4 days overdue", date: date(-4), daysOut: -4, url: "/p/prp_00000001/compliance" },
  { id: "compliance_due:cmp_00000002", kind: "compliance_due", severity: "warning", propertyId: "prp_00000002", propertyName: "Birchwood Triplex", unitId: null, unitLabel: null, entityType: "compliance_item", entityId: "cmp_00000002", title: "Boiler service", detail: "Due in 9 days", date: date(9), daysOut: 9, url: "/p/prp_00000002/compliance" },
  { id: "lease_expiring:lse_00000002", kind: "lease_expiring", severity: "warning", propertyId: "prp_00000001", propertyName: "Maple Street Duplex", unitId: "unt_00000002", unitLabel: "Unit B", entityType: "lease", entityId: "lse_00000002", title: "Lease expiring — Unit B", detail: "Ends in 18 days, no renewal confirmed", date: date(18), daysOut: 18, url: "/p/prp_00000001/tenants" },
  { id: "unit_vacant:unt_00000005", kind: "unit_vacant", severity: "warning", propertyId: "prp_00000002", propertyName: "Birchwood Triplex", unitId: "unt_00000005", unitLabel: "Unit 3", entityType: "unit", entityId: "unt_00000005", title: "Unit 3 vacant", detail: "Mid-turnover, target ready in 6 days", date: date(6), daysOut: 6, url: "/p/prp_00000002/turnover" },
  { id: "rent_unpaid:rnt_00000002", kind: "rent_unpaid", severity: "warning", propertyId: "prp_00000001", propertyName: "Maple Street Duplex", unitId: "unt_00000002", unitLabel: "Unit B", entityType: "rent_entry", entityId: "rnt_00000002", title: "Rent unpaid — Unit B", detail: `${currentPeriod()} rent not yet received`, date: null, daysOut: null, url: "/p/prp_00000001/money" },
  { id: "turnover_stalled:trn_00000001", kind: "turnover_stalled", severity: "info", propertyId: "prp_00000002", propertyName: "Birchwood Triplex", unitId: "unt_00000005", unitLabel: "Unit 3", entityType: "turnover", entityId: "trn_00000001", title: "Turnover in progress — Unit 3", detail: "2 of 6 checklist items done", date: date(6), daysOut: 6, url: "/p/prp_00000002/turnover" },
  { id: "pm_due:pmt_00000002", kind: "pm_due", severity: "info", propertyId: "prp_00000001", propertyName: "Maple Street Duplex", unitId: null, unitLabel: null, entityType: "pm_template", entityId: "pmt_00000002", title: "Furnace filter change due", detail: "Due in 5 days", date: date(5), daysOut: 5, url: "/p/prp_00000001/maintenance" },
];

export function revealSecret(specId: Id): string | null {
  return SECRET_VALUES[specId] ?? null;
}
