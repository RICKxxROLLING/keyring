// web/lib/status.ts — maps domain status enums to a semantic severity + label.
// Severity colour is kept strictly separate from the brand accent (see web/styles.css).
import type {
  AttentionKind,
  ComplianceStatus,
  LeaseStatus,
  PropertyStatus,
  RentStatus,
  UnitStatus,
  WorkOrderStatus,
} from "../../shared/types";

export type Severity = "ok" | "warn" | "urgent" | "neutral";

export interface StatusDisplay {
  severity: Severity;
  label: string;
}

export function propertyStatusDisplay(status: PropertyStatus): StatusDisplay {
  switch (status) {
    case "stable":
      return { severity: "ok", label: "Stable" };
    case "attention":
      return { severity: "warn", label: "Needs attention" };
    case "urgent":
      return { severity: "urgent", label: "Urgent" };
  }
}

export function complianceStatusDisplay(status: ComplianceStatus): StatusDisplay {
  switch (status) {
    case "ok":
      return { severity: "ok", label: "On track" };
    case "due_soon":
      return { severity: "warn", label: "Due soon" };
    case "overdue":
      return { severity: "urgent", label: "Overdue" };
    case "done":
      return { severity: "ok", label: "Done" };
    case "waived":
      return { severity: "neutral", label: "Waived" };
  }
}

export function workOrderStatusDisplay(status: WorkOrderStatus, isOverdue?: boolean): StatusDisplay {
  if (isOverdue && status !== "done" && status !== "cancelled") {
    return { severity: "urgent", label: "Overdue" };
  }
  switch (status) {
    case "new":
      return { severity: "neutral", label: "New" };
    case "triaged":
      return { severity: "neutral", label: "Triaged" };
    case "scheduled":
      return { severity: "warn", label: "Scheduled" };
    case "in_progress":
      return { severity: "warn", label: "In progress" };
    case "done":
      return { severity: "ok", label: "Done" };
    case "cancelled":
      return { severity: "neutral", label: "Cancelled" };
  }
}

export function leaseStatusDisplay(status: LeaseStatus): StatusDisplay {
  switch (status) {
    case "upcoming":
      return { severity: "neutral", label: "Upcoming" };
    case "active":
      return { severity: "ok", label: "Active" };
    case "ended":
      return { severity: "neutral", label: "Ended" };
    case "terminated":
      return { severity: "urgent", label: "Terminated" };
  }
}

export function rentStatusDisplay(status: RentStatus): StatusDisplay {
  switch (status) {
    case "unpaid":
      return { severity: "warn", label: "Unpaid" };
    case "partial":
      return { severity: "warn", label: "Partial" };
    case "paid":
      return { severity: "ok", label: "Paid" };
    case "late":
      return { severity: "urgent", label: "Late" };
    case "waived":
      return { severity: "neutral", label: "Waived" };
  }
}

export function unitStatusDisplay(status: UnitStatus): StatusDisplay {
  switch (status) {
    case "occupied":
      return { severity: "ok", label: "Occupied" };
    case "vacant":
      return { severity: "warn", label: "Vacant" };
    case "make_ready":
      return { severity: "warn", label: "Make-ready" };
    case "offline":
      return { severity: "neutral", label: "Offline" };
  }
}

export const ATTENTION_KIND_LABEL: Record<AttentionKind, string> = {
  work_order_overdue: "Work order overdue",
  work_order_urgent: "Urgent work order",
  compliance_overdue: "Compliance overdue",
  compliance_due: "Compliance due soon",
  lease_expiring: "Lease expiring",
  unit_vacant: "Unit vacant",
  rent_unpaid: "Rent unpaid",
  turnover_stalled: "Turnover stalled",
  pm_due: "Preventive maintenance due",
};

export function attentionSeverityDisplay(severity: "urgent" | "warning" | "info"): Severity {
  if (severity === "urgent") return "urgent";
  if (severity === "warning") return "warn";
  return "neutral";
}
