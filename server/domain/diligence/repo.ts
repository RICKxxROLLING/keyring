// server/domain/diligence/repo.ts — the pre-purchase checklist.
import { getDb } from "../../db/index.js";
import { mapRow, mapRows } from "../common/rowmap.js";
import { notFound } from "../../lib/errors.js";
import { userRef } from "../common/access.js";
import { getUploadRow, toUploadDto } from "../../uploads/storage.js";
import type { DiligenceItem, DiligenceItemView, Upload } from "../../../shared/types.js";

export function getDiligenceRow(id: string): DiligenceItem {
  const row = getDb().prepare(`SELECT * FROM diligence_items WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw notFound("Checklist item");
  return mapRow<DiligenceItem>(row);
}

/**
 * The attached document, or null.
 *
 * Soft-deleted uploads resolve to null rather than to a row with deleted_at
 * set: a checklist that still shows a paperclip for a file someone removed is
 * claiming to hold evidence it does not have.
 */
function documentFor(uploadId: string | null): Upload | null {
  if (!uploadId) return null;
  const row = getUploadRow(uploadId);
  return row ? toUploadDto(row) : null;
}

export function toDiligenceView(item: DiligenceItem): DiligenceItemView {
  return {
    ...item,
    assignee: userRef(item.assigneeId),
    document: documentFor(item.uploadId),
  };
}

export function listDiligence(propertyId: string): DiligenceItemView[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM diligence_items WHERE property_id = ?
        ORDER BY sort_order ASC, created_at ASC`,
    )
    .all(propertyId) as Record<string, unknown>[];
  return mapRows<DiligenceItem>(rows).map(toDiligenceView);
}

/** Highest sort_order in use, so appended items land at the bottom. */
export function nextSortOrder(propertyId: string): number {
  const row = getDb()
    .prepare(`SELECT COALESCE(MAX(sort_order), -1) AS n FROM diligence_items WHERE property_id = ?`)
    .get(propertyId) as { n: number };
  return row.n + 1;
}
