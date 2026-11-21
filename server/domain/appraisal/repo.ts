// server/domain/appraisal/repo.ts — the appraisal-readiness checklist.
import { getDb } from "../../db/index.js";
import { mapRow, mapRows } from "../common/rowmap.js";
import { notFound } from "../../lib/errors.js";
import { toUploadDto, type UploadRow } from "../../uploads/storage.js";
import type {
  AppraisalItem,
  AppraisalItemView,
  AppraisalReport,
  AppraisalReportView,
  ProjectStatus,
  Upload,
} from "../../../shared/types.js";

export function getAppraisalRow(id: string): AppraisalItem {
  const row = getDb().prepare(`SELECT * FROM appraisal_items WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw notFound("Appraisal item");
  return mapRow<AppraisalItem>(row);
}

/**
 * Attached files, oldest first.
 *
 * Soft-deleted uploads are left out rather than shown: a checklist that claims
 * to hold a document someone has since removed is claiming evidence it does
 * not have.
 */
export function documentsFor(itemId: string): Upload[] {
  const rows = getDb()
    .prepare(
      `SELECT u.* FROM appraisal_item_uploads l
         JOIN uploads u ON u.id = l.upload_id
        WHERE l.item_id = ? AND u.deleted_at IS NULL
        ORDER BY l.created_at ASC, u.created_at ASC`,
    )
    .all(itemId) as Record<string, unknown>[];
  return mapRows<UploadRow>(rows).map(toUploadDto);
}

function projectFor(projectId: string | null): AppraisalItemView["project"] {
  if (!projectId) return null;
  const row = getDb()
    .prepare(`SELECT id, title, status FROM projects WHERE id = ?`)
    .get(projectId) as { id: string; title: string; status: ProjectStatus } | undefined;
  return row ?? null;
}

export function toAppraisalView(item: AppraisalItem): AppraisalItemView {
  return { ...item, documents: documentsFor(item.id), project: projectFor(item.projectId) };
}

export function listAppraisal(propertyId: string): AppraisalItemView[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM appraisal_items WHERE property_id = ?
        ORDER BY sort_order ASC, created_at ASC`,
    )
    .all(propertyId) as Record<string, unknown>[];
  return mapRows<AppraisalItem>(rows).map(toAppraisalView);
}

export function nextAppraisalSortOrder(propertyId: string): number {
  const row = getDb()
    .prepare(`SELECT COALESCE(MAX(sort_order), -1) AS n FROM appraisal_items WHERE property_id = ?`)
    .get(propertyId) as { n: number };
  return row.n + 1;
}

/** How many units the property has, for deciding which template lines apply. */
export function unitCount(propertyId: string): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM units WHERE property_id = ?`)
    .get(propertyId) as { n: number };
  return row.n;
}

/* ------------------------------------------------------- appraisal reports -- */

export function toReportView(report: AppraisalReport): AppraisalReportView {
  let document: Upload | null = null;
  if (report.uploadId) {
    const row = getDb().prepare(`SELECT * FROM uploads WHERE id = ? AND deleted_at IS NULL`).get(report.uploadId) as
      | Record<string, unknown>
      | undefined;
    document = row ? toUploadDto(mapRow<UploadRow>(row)) : null;
  }
  return { ...report, document };
}

/** Newest effective date first; reports with no date last. */
export function listAppraisalReports(propertyId: string): AppraisalReportView[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM appraisal_reports WHERE property_id = ?
        ORDER BY effective_date IS NULL, effective_date DESC, created_at DESC`,
    )
    .all(propertyId) as Record<string, unknown>[];
  return mapRows<AppraisalReport>(rows).map(toReportView);
}

export function getAppraisalReportRow(id: string): AppraisalReport {
  const row = getDb().prepare(`SELECT * FROM appraisal_reports WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw notFound("Appraisal report");
  return mapRow<AppraisalReport>(row);
}
