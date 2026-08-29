import type { ISODate, ISODateTime } from "../../shared/types.js";

export function nowIso(): ISODateTime {
  return new Date().toISOString();
}

/** Today's calendar date in the app timezone (not UTC). */
export function todayLocal(timeZone: string): ISODate {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** 'HH:mm' now, in the given timezone. Used by the daily job scheduler. */
export function clockLocal(timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

export function toIsoDate(d: Date): ISODate {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: ISODate, days: number): ISODate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return toIsoDate(d);
}

export function addMonths(date: ISODate, months: number): ISODate {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return toIsoDate(d);
}

/** b - a, in whole days. Positive when b is later. */
export function daysBetween(a: ISODate, b: ISODate): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export function addHoursIso(hours: number, from: Date = new Date()): ISODateTime {
  return new Date(from.getTime() + hours * 3_600_000).toISOString();
}

export function isPastIso(iso: ISODateTime): boolean {
  return Date.parse(iso) < Date.now();
}

/** 'YYYY-MM' for a calendar date. */
export function periodOf(date: ISODate): string {
  return date.slice(0, 7);
}
