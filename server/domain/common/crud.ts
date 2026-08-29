// server/domain/common/crud.ts — shared create/patch/delete helpers for the domain modules.
//
// Every mutation in server/domain/** follows the same shape:
//   1. Inside tx(): perform the row write(s), write the search index, write the audit row.
//   2. After tx() returns (i.e. after commit): call publishEntity().
// These helpers encode that shape once so every module gets it identically.

import type { FastifyRequest } from "fastify";
import { getDb } from "../../db/index.js";
import { nowIso } from "../../lib/time.js";
import { notFound, versionConflict } from "../../lib/errors.js";
import { snakeKeys } from "../../lib/rowmap.js";
import { auditFromRequest } from "../../audit/audit.js";
import { indexEntity, removeFromIndex, type SearchDoc } from "../../search/index-entity.js";
import { publishEntity } from "../../seams.js";
import type { AuditAction, EntityType } from "../../../shared/types.js";

/** Build an `UPDATE <table> SET col=?,... WHERE id=? AND version=?` and run it. */
export function patchWithVersionGuard(opts: {
  table: string;
  id: string;
  /** camelCase patch fields, already validated, excluding expectedVersion. */
  patch: Record<string, unknown>;
  expectedVersion: number;
  actorId: string;
}): number {
  const db = getDb();
  const snake = snakeKeys(opts.patch);
  const cols = Object.keys(snake).filter((k) => snake[k] !== undefined);
  const setClauses = cols.map((c) => `${c} = ?`);
  setClauses.push("updated_at = ?", "updated_by = ?", "version = version + 1");
  const sql = `UPDATE ${opts.table} SET ${setClauses.join(", ")} WHERE id = ? AND version = ?`;
  const params = [
    ...cols.map((c) => snake[c]),
    nowIso(),
    opts.actorId,
    opts.id,
    opts.expectedVersion,
  ];
  const info = db.prepare(sql).run(...(params as never[]));
  return info.changes;
}

/**
 * changes === 0 means either the row does not exist (NOT_FOUND) or someone else wrote first
 * (VERSION_CONFLICT, carrying the server's current copy). Throws in both cases; no-op on success.
 */
export function assertVersionMatch(opts: {
  table: string;
  id: string;
  changes: number;
  what: string;
  currentView: () => unknown;
}): void {
  if (opts.changes > 0) return;
  const exists = getDb().prepare(`SELECT id FROM ${opts.table} WHERE id = ?`).get(opts.id);
  if (!exists) throw notFound(opts.what);
  throw versionConflict(
    `${opts.what} was changed by someone else while you were editing.`,
    opts.currentView(),
  );
}

/** Fetch a row by id, or throw NOT_FOUND. Optionally requires deleted_at IS NULL. */
export function requireRow<T = Record<string, unknown>>(
  table: string,
  id: string,
  what: string,
  opts: { softDeleteColumn?: string } = {},
): T {
  const sql = opts.softDeleteColumn
    ? `SELECT * FROM ${table} WHERE id = ? AND ${opts.softDeleteColumn} IS NULL`
    : `SELECT * FROM ${table} WHERE id = ?`;
  const row = getDb().prepare(sql).get(id) as T | undefined;
  if (!row) throw notFound(what);
  return row;
}

export interface AuditWriteInput {
  action: AuditAction;
  entityType: EntityType;
  entityId: string;
  propertyId: string | null;
  summary: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

/** Writes the audit row and (optionally) the search index row, inside the open transaction. */
export function recordMutation(
  req: FastifyRequest,
  audit: AuditWriteInput,
  search?: SearchDoc | null,
): void {
  auditFromRequest(req, audit);
  if (search) indexEntity(search);
}

/** Writes the audit row for a delete and removes the entity from the search index. */
export function recordDelete(
  req: FastifyRequest,
  audit: AuditWriteInput,
  searchEntity?: { entityType: EntityType; entityId: string } | null,
): void {
  auditFromRequest(req, audit);
  if (searchEntity) removeFromIndex(searchEntity.entityType, searchEntity.entityId);
}

export interface PublishAfterCommit {
  action: "created" | "updated" | "deleted";
  entityType: EntityType;
  entityId: string;
  propertyId: string | null;
  version: number;
  actorId: string | null;
  data?: unknown;
}

/** Call AFTER tx() has returned (i.e. after commit). Never call inside a transaction. */
export function publishAfterCommit(input: PublishAfterCommit): void {
  publishEntity(input);
}
