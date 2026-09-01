// shared/types.ts — FROZEN FOUNDATION. Canonical owner: T1.
// Written byte-identically by T1, T2, T3, T4, T5.

export const API_VERSION = 1 as const;

/* ------------------------------------------------------------------ scalars */

/** ISO-8601 UTC with milliseconds: '2026-08-29T14:03:11.482Z'. Always UTC, always Z. */
export type ISODateTime = string;
/** Calendar date, no timezone: '2026-08-29'. Used for due dates, lease dates. */
export type ISODate = string;
/** 'YYYY-MM' — rent-roll period. */
export type YearMonth = string;
/** Integer minor units (US cents). Never a float. May be negative (credits). */
export type Cents = number;
/** '<prefix>_<26 char Crockford base32>' — lexicographically sortable by creation time. */
export type Id = string;

/* -------------------------------------------------------------------- enums */

export type Role = "owner" | "manager";
export const ROLES: readonly Role[] = ["owner", "manager"];

export type EntityType =
  | "user" | "invite" | "session"
  | "property" | "unit" | "note"
  | "work_order" | "work_order_comment" | "pm_template"
  | "project" | "project_line"
  | "tenant" | "lease" | "rent_entry" | "property_expense"
  | "vendor" | "spec_entry" | "compliance_item"
  | "turnover" | "turnover_item"
  | "upload" | "notification" | "backup"
  // Portfolio-wide operations that are not about one row — loading or removing
  // the demo portfolio, for instance. Audited like anything else; the entityId
  // names the operation.
  | "system";

export type AuditAction =
  | "create" | "update" | "delete"
  | "login" | "login_failed" | "logout"
  | "invite_issued" | "invite_revoked" | "invite_accepted"
  | "totp_enrolled" | "totp_reset" | "recovery_used" | "password_changed"
  | "user_deactivated" | "user_reactivated" | "role_changed"
  | "secret_revealed" | "upload_downloaded"
  | "backup_started" | "backup_completed" | "backup_failed" | "restore_verified";

export type WorkOrderStatus =
  | "new" | "triaged" | "scheduled" | "in_progress" | "done" | "cancelled";
export const WORK_ORDER_STATUSES: readonly WorkOrderStatus[] =
  ["new", "triaged", "scheduled", "in_progress", "done", "cancelled"];

export type Priority = "low" | "normal" | "high" | "urgent";
export const PRIORITIES: readonly Priority[] = ["low", "normal", "high", "urgent"];

export type WorkOrderSource = "manual" | "pm";

export type UnitStatus = "occupied" | "vacant" | "make_ready" | "offline";

/** Derived, never stored. Drives the dashboard card colour. */
export type PropertyStatus = "stable" | "attention" | "urgent";

/**
 * Whether you hold this property or are still deciding.
 *
 * "owned" is on the ring. "prospect" is one you are considering: the dossier
 * works in full so you can plan the renovation and cost it out before buying,
 * but it is left out of every portfolio total, because counting a building you
 * do not own would overstate what you have.
 *
 * Buying it is a stage change, not a re-entry — the projects, estimates, notes
 * and photos you built up while deciding come with it.
 */
export type PropertyStage = "owned" | "prospect";
export const PROPERTY_STAGES: readonly PropertyStage[] = ["owned", "prospect"];

export type ProjectStatus =
  | "idea" | "planning" | "quoted" | "approved"
  | "in_progress" | "blocked" | "done" | "cancelled";

export type ProjectLineKind = "budget" | "expense";

export type LeaseStatus = "upcoming" | "active" | "ended" | "terminated";

export type RentStatus = "unpaid" | "partial" | "paid" | "late" | "waived";

export type PmFrequency = "monthly" | "quarterly" | "semiannual" | "annual" | "custom_days";
export const PM_FREQUENCIES: readonly PmFrequency[] =
  ["monthly", "quarterly", "semiannual", "annual", "custom_days"];

export type ComplianceKind =
  | "insurance" | "tax" | "inspection" | "license" | "hoa" | "permit" | "other";
/** Stored state. */
export type ComplianceState = "open" | "done" | "waived";
/** Derived for display: state combined with dueDate vs today and leadDays. */
export type ComplianceStatus = "ok" | "due_soon" | "overdue" | "done" | "waived";

export type TurnoverPhase = "move_out" | "make_ready" | "move_in" | "complete";
export const TURNOVER_PHASES: readonly TurnoverPhase[] =
  ["move_out", "make_ready", "move_in", "complete"];

export type SpecCategory =
  | "appliance" | "filter" | "paint" | "shutoff" | "code" | "warranty" | "utility" | "other";

export type ExpenseCategory =
  | "repair" | "capex" | "utility" | "insurance" | "tax" | "management"
  | "supplies" | "legal" | "landscaping" | "other";

export type AttachmentParentType =
  | "property" | "unit" | "note" | "work_order" | "project" | "lease"
  | "tenant" | "property_expense" | "spec_entry" | "turnover" | "compliance_item" | "vendor";

export type UploadKind = "image" | "pdf";

export type NotificationType =
  | "mention" | "assignment" | "work_order_status"
  | "compliance_due" | "lease_expiring" | "system";

export type AttentionKind =
  | "work_order_overdue" | "work_order_urgent"
  | "compliance_overdue" | "compliance_due"
  | "lease_expiring" | "unit_vacant" | "rent_unpaid"
  | "turnover_stalled" | "pm_due";

export type PropertyType =
  | "single_family" | "duplex" | "triplex" | "fourplex" | "condo" | "townhouse" | "other";

/* ---------------------------------------------------------------- envelopes */

export type ErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION_FAILED"
  | "UNAUTHENTICATED"
  | "MFA_REQUIRED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "VERSION_CONFLICT"
  | "RATE_LIMITED"
  | "LOCKED_OUT"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "SETUP_REQUIRED"
  | "SETUP_ALREADY_DONE"
  | "INTERNAL";

export interface FieldError {
  path: string;
  message: string;
}

export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  /** Present for VALIDATION_FAILED. */
  fields?: FieldError[];
  /** Present for VERSION_CONFLICT: the server's current copy of the entity. */
  current?: unknown;
  /** Present for RATE_LIMITED / LOCKED_OUT: seconds until a retry is permitted. */
  retryAfter?: number;
  requestId: string;
}

export type ApiOk<T> = { ok: true; data: T };
export type ApiErr = { ok: false; error: ApiErrorBody };
export type ApiResponse<T> = ApiOk<T> | ApiErr;

/** Every list endpoint returns this shape as its `data`. */
export interface Page<T> {
  items: T[];
  /** Opaque; pass back as ?cursor= for the next page. null when exhausted. */
  nextCursor: string | null;
  /** Total matching rows when cheap to compute; otherwise null. */
  total: number | null;
}

/* ------------------------------------------------- create / patch modelling */

/** Fields the server always owns. Never present in a create or patch body. */
export type ServerManagedKey =
  | "id" | "createdAt" | "updatedAt" | "createdBy" | "updatedBy" | "version";

export type CreateInput<T> = Omit<T, Extract<keyof T, ServerManagedKey>>;

/**
 * Every PATCH body is a partial create input plus a mandatory expectedVersion.
 * Omitted keys are untouched. Explicit null clears a nullable column.
 */
export type PatchInput<T> = Partial<CreateInput<T>> & { expectedVersion: number };

/* -------------------------------------------------------------------- users */

export interface User {
  id: Id;
  email: string;
  /** Lowercase, unique, no '@'. Used for @mentions. */
  handle: string;
  displayName: string;
  role: Role;
  /** '#rrggbb' — presence avatar colour, assigned at creation. */
  avatarColor: string;
  isActive: boolean;
  totpEnrolled: boolean;
  lastLoginAt: ISODateTime | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  version: number;
}

/** The shape embedded in presence, audit rows, comments, notifications. */
export interface UserRef {
  id: Id;
  handle: string;
  displayName: string;
  avatarColor: string;
}

export interface SessionInfo {
  user: User;
  /** Mirror of the readable keyring_csrf cookie. Send as X-CSRF-Token on every non-GET. */
  csrfToken: string;
  expiresAt: ISODateTime;
  serverTime: ISODateTime;
  /** IANA zone the UI should format dates in. */
  timezone: string;
}

export interface Invite {
  id: Id;
  email: string;
  role: Role;
  createdBy: Id;
  createdAt: ISODateTime;
  expiresAt: ISODateTime;
  acceptedAt: ISODateTime | null;
  acceptedUserId: Id | null;
  revokedAt: ISODateTime | null;
  /** Present ONLY in the response to POST /api/invites. Never stored, never re-fetchable. */
  inviteUrl?: string;
}

export interface EnrollmentChallenge {
  /** base32 TOTP secret, shown once. */
  secret: string;
  /** otpauth://totp/Keyring:<email>?secret=...&issuer=Keyring */
  otpauthUrl: string;
}

export interface RecoveryCodes {
  /** Ten single-use codes, format 'xxxxx-xxxxx'. Shown exactly once. */
  codes: string[];
  generatedAt: ISODateTime;
}

/* ---------------------------------------------------------------- audit log */

export interface AuditEntry {
  id: Id;
  at: ISODateTime;
  actor: UserRef | null;
  /** Snapshot of the actor's display name at write time; survives user deletion. */
  actorLabel: string;
  action: AuditAction;
  entityType: EntityType;
  entityId: Id;
  propertyId: Id | null;
  /** Human sentence: 'changed status new -> triaged on "Leaking sink"'. */
  summary: string;
  /** Changed fields only. null for create/delete and non-entity actions. */
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip: string | null;
}

/* --------------------------------------------------------------- properties */

export interface Property {
  id: Id;
  name: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  propertyType: PropertyType;
  yearBuilt: number | null;
  sqft: number | null;
  lotSqft: number | null;
  parcelNumber: string | null;
  purchaseDate: ISODate | null;
  purchasePriceCents: Cents | null;
  mortgageLender: string | null;
  mortgagePaymentCents: Cents | null;
  insuranceCarrier: string | null;
  insurancePolicyNumber: string | null;
  coverUploadId: Id | null;
  /** Held, or still being considered. See PropertyStage. */
  stage: PropertyStage;
  /**
   * The property's hero colour — a CSS colour string, e.g.
   * `oklch(0.665 0.125 42)`.
   *
   * This is the Keyring design language's organizing idea: every property is a
   * key on a ring, and its colour follows it everywhere — sidebar key tag, card
   * band, occupancy bar, status dots, detail header wash.
   *
   * STORED, never derived. Deriving it from list position or a hash of the id
   * would reshuffle the ring whenever a property is reordered or renamed, which
   * defeats the point: the colour is part of the property's identity, so it has
   * to survive both.
   *
   * Null means "not yet assigned" and renders as a neutral key; the create path
   * assigns one from the palette.
   */
  heroColor: string | null;
  notes: string | null;
  sortOrder: number;
  archivedAt: ISODateTime | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  createdBy: Id;
  updatedBy: Id;
  version: number;
}

export interface Unit {
  id: Id;
  propertyId: Id;
  label: string;
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
  floor: string | null;
  marketRentCents: Cents | null;
  status: UnitStatus;
  notes: string | null;
  sortOrder: number;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  createdBy: Id;
  updatedBy: Id;
  version: number;
}

/** Derived header block for the dossier and the dashboard card. */
export interface PropertyQuickFacts {
  unitCount: number;
  occupiedUnits: number;
  vacantUnits: number;
  monthlyRentCents: Cents;
  openWorkOrders: number;
  urgentWorkOrders: number;
  overdueWorkOrders: number;
  activeProjects: number;
  nextLeaseExpiry: { unitId: Id; unitLabel: string; endDate: ISODate; daysOut: number } | null;
  nextComplianceDue: { id: Id; title: string; dueDate: ISODate; daysOut: number } | null;
  ytdExpenseCents: Cents;
  ytdRentReceivedCents: Cents;
  lastActivityAt: ISODateTime | null;
}

export interface PropertyView extends Property {
  units: Unit[];
  quickFacts: PropertyQuickFacts;
  status: PropertyStatus;
  coverUrl: string | null;
}

/* -------------------------------------------------------------------- notes */

export interface Note {
  id: Id;
  propertyId: Id;
  unitId: Id | null;
  title: string | null;
  body: string;
  pinned: boolean;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  createdBy: Id;
  updatedBy: Id;
  version: number;
}

export interface NoteView extends Note {
  author: UserRef | null;
  lastEditor: UserRef | null;
  attachments: Upload[];
}

/* -------------------------------------------------------------- work orders */

export interface WorkOrder {
  id: Id;
  propertyId: Id;
  unitId: Id | null;
  /** Per-property sequential number for humans: 'WO-14'. Server assigned. */
  number: number;
  title: string;
  description: string | null;
  status: WorkOrderStatus;
  priority: Priority;
  assigneeId: Id | null;
  vendorId: Id | null;
  dueDate: ISODate | null;
  scheduledFor: ISODate | null;
  completedAt: ISODateTime | null;
  estimateCents: Cents | null;
  costCents: Cents | null;
  source: WorkOrderSource;
  pmTemplateId: Id | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  createdBy: Id;
  updatedBy: Id;
  version: number;
}

export interface WorkOrderComment {
  id: Id;
  workOrderId: Id;
  body: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  createdBy: Id;
  updatedBy: Id;
  version: number;
}

export interface WorkOrderCommentView extends WorkOrderComment {
  author: UserRef | null;
  attachments: Upload[];
}

export interface WorkOrderView extends WorkOrder {
  unitLabel: string | null;
  propertyName: string;
  assignee: UserRef | null;
  vendor: Vendor | null;
  commentCount: number;
  attachments: Upload[];
  isOverdue: boolean;
}

export interface PmTemplate {
  id: Id;
  propertyId: Id;
  unitId: Id | null;
  title: string;
  description: string | null;
  priority: Priority;
  assigneeId: Id | null;
  vendorId: Id | null;
  frequency: PmFrequency;
  /** Required when frequency === 'custom_days'; null otherwise. */
  intervalDays: number | null;
  /** First occurrence; later ones are computed from this. */
  anchorDate: ISODate;
  /** A work order is generated this many days before the due date. */
  leadDays: number;
  nextDueDate: ISODate;
  lastGeneratedDate: ISODate | null;
  active: boolean;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  createdBy: Id;
  updatedBy: Id;
  version: number;
}

/* ----------------------------------------------------------------- projects */

export interface Project {
  id: Id;
  propertyId: Id;
  title: string;
  description: string | null;
  status: ProjectStatus;
  priority: Priority;
  ownerId: Id | null;
  targetStart: ISODate | null;
  targetEnd: ISODate | null;
  actualStart: ISODate | null;
  actualEnd: ISODate | null;
  budgetCents: Cents | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  createdBy: Id;
  updatedBy: Id;
  version: number;
}

export interface ProjectLine {
  id: Id;
  projectId: Id;
  kind: ProjectLineKind;
  label: string;
  category: ExpenseCategory | null;
  amountCents: Cents;
  incurredOn: ISODate | null;
  vendorId: Id | null;
  note: string | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  createdBy: Id;
  updatedBy: Id;
  version: number;
}

export interface ProjectView extends Project {
  owner: UserRef | null;
  lines: ProjectLine[];
  budgetTotalCents: Cents;
  actualTotalCents: Cents;
  /** budgetTotalCents - actualTotalCents. Negative means over budget. */
  varianceCents: Cents;
  attachments: Upload[];
}

/* ----------------------------------------------------------- tenants/leases */

export interface Tenant {
  id: Id;
  propertyId: Id;
  unitId: Id | null;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  notes: string | null;
  isPrimary: boolean;
  movedInAt: ISODate | null;
  movedOutAt: ISODate | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  createdBy: Id;
  updatedBy: Id;
  version: number;
}

export interface Lease {
  id: Id;
  propertyId: Id;
  unitId: Id;
  startDate: ISODate;
  /** null = month-to-month. */
  endDate: ISODate | null;
  rentCents: Cents;
  depositCents: Cents;
  /** Day of month rent is due, 1-28. */
  dueDay: number;
  status: LeaseStatus;
  renewalNoticeDays: number;
  documentUploadId: Id | null;
  notes: string | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  createdBy: Id;
  updatedBy: Id;
  version: number;
}

export interface LeaseView extends Lease {
  unitLabel: string;
  tenants: Tenant[];
  /** null when endDate is null. Negative when already expired. */
  daysUntilExpiry: number | null;
  attachments: Upload[];
}

/* -------------------------------------------------------------------- money */

export interface RentEntry {
  id: Id;
  propertyId: Id;
  unitId: Id;
  leaseId: Id | null;
  period: YearMonth;
  amountDueCents: Cents;
  amountReceivedCents: Cents;
  receivedOn: ISODate | null;
  /** HOW it was paid: check, ACH, cash, Zelle. */
  method: string | null;
  /** WHICH payment: check number, confirmation code, money-order stub. Free
   *  text because these share nothing but being a string you need to find
   *  again when reconciling a bank statement. */
  reference: string | null;
  status: RentStatus;
  note: string | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  createdBy: Id;
  updatedBy: Id;
  version: number;
}

export interface PropertyExpense {
  id: Id;
  propertyId: Id;
  unitId: Id | null;
  category: ExpenseCategory;
  description: string;
  amountCents: Cents;
  incurredOn: ISODate;
  vendorId: Id | null;
  workOrderId: Id | null;
  projectId: Id | null;
  /** Marks an expense that repeats (insurance, landscaping, the mortgage).
   *  A statement about the expense, not a schedule — nothing generates from
   *  it. See migration 2003. */
  isRecurring: boolean;
  /** The cadence in plain words: "monthly", "every spring". Free text
   *  because an enum would be wrong for half of them. */
  recurrenceNote: string | null;
  note: string | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  createdBy: Id;
  updatedBy: Id;
  version: number;
}

export interface MoneySummary {
  propertyId: Id;
  period: { from: ISODate; to: ISODate };
  rentDueCents: Cents;
  rentReceivedCents: Cents;
  rentOutstandingCents: Cents;
  expenseCents: Cents;
  /** rentReceivedCents - expenseCents. */
  netCents: Cents;
  byCategory: { category: ExpenseCategory; amountCents: Cents }[];
  byMonth: { period: YearMonth; rentReceivedCents: Cents; expenseCents: Cents }[];
}

/* ------------------------------------------------------------------ vendors */

export interface Vendor {
  id: Id;
  name: string;
  company: string | null;
  trade: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  notes: string | null;
  /** 1-5, null when unrated. */
  rating: number | null;
  preferred: boolean;
  licenseNumber: string | null;
  insuranceExpiresOn: ISODate | null;
  archivedAt: ISODateTime | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  createdBy: Id;
  updatedBy: Id;
  version: number;
}

/* --------------------------------------------------------------- spec vault */

export interface SpecEntry {
  id: Id;
  propertyId: Id;
  unitId: Id | null;
  category: SpecCategory;
  label: string;
  make: string | null;
  model: string | null;
  serial: string | null;
  /** Filter size, paint code, breaker rating, gate code, account number. */
  value: string | null;
  location: string | null;
  /** true for gate/lockbox codes and utility accounts: masked in list responses. */
  isSecret: boolean;
  installedOn: ISODate | null;
  warrantyExpiresOn: ISODate | null;
  vendorId: Id | null;
  notes: string | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  createdBy: Id;
  updatedBy: Id;
  version: number;
}

export interface SpecEntryView extends Omit<SpecEntry, "value"> {
  /** null when isSecret and not yet revealed; the real value after /reveal. */
  value: string | null;
  valueMasked: boolean;
  attachments: Upload[];
}

/* --------------------------------------------------------------- compliance */

export interface ComplianceItem {
  id: Id;
  propertyId: Id;
  unitId: Id | null;
  kind: ComplianceKind;
  title: string;
  authority: string | null;
  reference: string | null;
  dueDate: ISODate;
  /** Warn this many days before dueDate. */
  leadDays: number;
  recurrence: "none" | "monthly" | "quarterly" | "semiannual" | "annual";
  state: ComplianceState;
  completedOn: ISODate | null;
  costCents: Cents | null;
  vendorId: Id | null;
  notes: string | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  createdBy: Id;
  updatedBy: Id;
  version: number;
}

export interface ComplianceItemView extends ComplianceItem {
  status: ComplianceStatus;
  /** dueDate - today, in days. Negative when overdue. */
  daysOut: number;
  attachments: Upload[];
}

/* ----------------------------------------------------------------- turnover */

export interface Turnover {
  id: Id;
  propertyId: Id;
  unitId: Id;
  phase: TurnoverPhase;
  moveOutDate: ISODate | null;
  targetReadyDate: ISODate | null;
  moveInDate: ISODate | null;
  outgoingLeaseId: Id | null;
  incomingLeaseId: Id | null;
  depositHeldCents: Cents;
  depositWithheldCents: Cents;
  depositReturnedCents: Cents;
  depositReturnedOn: ISODate | null;
  depositNotes: string | null;
  conditionNotes: string | null;
  closedAt: ISODateTime | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  createdBy: Id;
  updatedBy: Id;
  version: number;
}

export interface TurnoverItem {
  id: Id;
  turnoverId: Id;
  phase: TurnoverPhase;
  label: string;
  done: boolean;
  doneAt: ISODateTime | null;
  doneBy: Id | null;
  costCents: Cents | null;
  note: string | null;
  workOrderId: Id | null;
  sortOrder: number;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  createdBy: Id;
  updatedBy: Id;
  version: number;
}

export interface TurnoverView extends Turnover {
  unitLabel: string;
  items: TurnoverItem[];
  progress: { done: number; total: number };
  attachments: Upload[];
}

/* ------------------------------------------------------------------ uploads */

export interface Upload {
  id: Id;
  parentType: AttachmentParentType;
  parentId: Id;
  propertyId: Id | null;
  filename: string;
  mime: string;
  kind: UploadKind;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  hasThumb: boolean;
  caption: string | null;
  uploadedBy: Id;
  createdAt: ISODateTime;
  /** Authorized handler paths, not static files. Fetch with credentials. */
  url: string;
  thumbUrl: string | null;
}

/* ------------------------------------------------------------ notifications */

export interface Notification {
  id: Id;
  userId: Id;
  type: NotificationType;
  title: string;
  body: string;
  propertyId: Id | null;
  entityType: EntityType | null;
  entityId: Id | null;
  /** Client route to open: '/p/prop_xxx/maintenance?wo=wo_yyy'. */
  url: string | null;
  actor: UserRef | null;
  createdAt: ISODateTime;
  readAt: ISODateTime | null;
}

/* ------------------------------------------------- dashboard & aggregations */

export interface AttentionItem {
  /** Stable synthetic id `${kind}:${entityId}` — safe as a React key. */
  id: string;
  kind: AttentionKind;
  severity: "urgent" | "warning" | "info";
  propertyId: Id;
  propertyName: string;
  unitId: Id | null;
  unitLabel: string | null;
  entityType: EntityType;
  entityId: Id;
  title: string;
  detail: string;
  /** Due/expiry date driving the alert; null for undated kinds. */
  date: ISODate | null;
  /** Negative when overdue. */
  daysOut: number | null;
  url: string;
}

export interface PropertyCard {
  id: Id;
  name: string;
  addressLine1: string;
  city: string;
  state: string;
  status: PropertyStatus;
  /** Held, or still being considered. The ring shows the two apart. */
  stage: PropertyStage;
  coverUrl: string | null;
  quickFacts: PropertyQuickFacts;
  attentionCount: number;
  /** The property's hero colour — see Property.heroColor. Carried on the card so
   *  the keyring rail and the dashboard grid can paint without a second fetch. */
  heroColor: string | null;
}

export interface DashboardPayload {
  properties: PropertyCard[];
  needsAttention: AttentionItem[];
  totals: {
    properties: number;
    units: number;
    occupied: number;
    vacant: number;
    openWorkOrders: number;
    monthlyRentCents: Cents;
    rentCollectedThisMonthCents: Cents;
  };
  generatedAt: ISODateTime;
}

/** The single payload the dossier page (and the offline cache) loads. */
export interface PropertyDossier {
  property: PropertyView;
  notes: NoteView[];
  workOrders: WorkOrderView[];
  pmTemplates: PmTemplate[];
  projects: ProjectView[];
  tenants: Tenant[];
  leases: LeaseView[];
  rentEntries: RentEntry[];
  expenses: PropertyExpense[];
  money: MoneySummary;
  specs: SpecEntryView[];
  compliance: ComplianceItemView[];
  turnovers: TurnoverView[];
  vendors: Vendor[];
  attachments: Upload[];
  attention: AttentionItem[];
  generatedAt: ISODateTime;
}

export interface TimelineEvent {
  id: Id;
  at: ISODateTime;
  actor: UserRef | null;
  actorLabel: string;
  action: AuditAction;
  entityType: EntityType;
  entityId: Id;
  summary: string;
  url: string | null;
}

export interface SearchHit {
  entityType: EntityType;
  entityId: Id;
  propertyId: Id | null;
  propertyName: string | null;
  title: string;
  /** FTS snippet with <mark> around matches. HTML-escaped by the server. */
  snippet: string;
  url: string;
  updatedAt: ISODateTime;
  rank: number;
}

/* ------------------------------------------------------------ health & ops */

export interface HealthPayload {
  status: "ok" | "degraded";
  version: string;
  uptimeSeconds: number;
  dbOk: boolean;
  migrations: number;
  time: ISODateTime;
}

export interface BackupRun {
  id: Id;
  kind: "scheduled" | "manual";
  status: "running" | "ok" | "failed";
  startedAt: ISODateTime;
  finishedAt: ISODateTime | null;
  archiveName: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  dbBytes: number | null;
  uploadsBytes: number | null;
  fileCount: number | null;
  retentionDeleted: number;
  error: string | null;
}

export interface OpsInfo {
  version: string;
  nodeVersion: string;
  dbPath: string;
  dbSizeBytes: number;
  walSizeBytes: number;
  journalMode: string;
  uploadCount: number;
  uploadBytes: number;
  backupDir: string;
  lastBackup: BackupRun | null;
  /** 'HH:mm' local, from BACKUP_AT. */
  scheduledBackupAt: string;
  retentionDays: number;
  uptimeSeconds: number;
}
