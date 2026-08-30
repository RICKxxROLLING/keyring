// web/lib/format.ts — money/date/relative-time formatting (owner T4). See design §C5.3, §C5.4.
import type { Cents, ISODate, ISODateTime } from "../../shared/types";

/** Formats integer minor units (cents) as USD, e.g. 125050 -> "$1,250.50". Negative = credit. */
export function formatCents(cents: Cents): string {
  const dollars = cents / 100;
  return dollars.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Parses user money input ("1,250.50", "$1250", "-40") into integer cents. Returns null if invalid. */
export function parseMoneyInput(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, "").trim();
  if (cleaned === "" || cleaned === "-") return null;
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

/** Formats an ISODate (YYYY-MM-DD) for display, timezone-agnostic (calendar date). */
export function formatDate(date: ISODate | null): string {
  if (!date) return "—";
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** Formats an ISODateTime in the given IANA timezone. */
export function formatDateTime(dt: ISODateTime | null, timezone: string): string {
  if (!dt) return "—";
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return dt;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  });
}

/** Formats an ISODateTime as a short relative time: "just now", "5m ago", "3d ago". */
export function formatRelativeTime(dt: ISODateTime | null): string {
  if (!dt) return "—";
  const then = new Date(dt).getTime();
  if (Number.isNaN(then)) return dt;
  const diffMs = Date.now() - then;
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.round(diffHour / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  const diffMonth = Math.round(diffDay / 30);
  if (diffMonth < 12) return `${diffMonth}mo ago`;
  return `${Math.round(diffMonth / 12)}y ago`;
}

/** Formats a "days out" figure (negative = overdue) as a short human label. */
export function formatDaysOut(daysOut: number | null): string {
  if (daysOut === null) return "";
  if (daysOut < 0) return `${Math.abs(daysOut)}d overdue`;
  if (daysOut === 0) return "due today";
  if (daysOut === 1) return "due tomorrow";
  return `due in ${daysOut}d`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return (parts[0]?.[0] ?? "?").toUpperCase();
  return `${parts[0]?.[0] ?? ""}${parts[parts.length - 1]?.[0] ?? ""}`.toUpperCase();
}
