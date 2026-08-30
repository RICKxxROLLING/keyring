// server/uploads/storage.ts — filesystem layout and row<->DTO mapping for uploads.
import { mkdirSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getDb } from "../db/index.js";
import { getEnv } from "../config/env.js";
import { mapRow } from "../domain/common/rowmap.js";
import { notFound } from "../lib/errors.js";
import type { AttachmentParentType, Upload } from "../../shared/types.js";

export interface UploadRow {
  id: string;
  parentType: AttachmentParentType;
  parentId: string;
  propertyId: string | null;
  filename: string;
  storedPath: string;
  thumbPath: string | null;
  mime: string;
  kind: "image" | "pdf";
  sizeBytes: number;
  sha256: string;
  width: number | null;
  height: number | null;
  caption: string | null;
  uploadedBy: string;
  createdAt: string;
  deletedAt: string | null;
}

export function toUploadDto(row: UploadRow): Upload {
  return {
    id: row.id,
    parentType: row.parentType,
    parentId: row.parentId,
    propertyId: row.propertyId,
    filename: row.filename,
    mime: row.mime,
    kind: row.kind,
    sizeBytes: row.sizeBytes,
    width: row.width,
    height: row.height,
    hasThumb: row.thumbPath !== null,
    caption: row.caption,
    uploadedBy: row.uploadedBy,
    createdAt: row.createdAt,
    url: `/api/uploads/${row.id}/raw`,
    thumbUrl: row.thumbPath !== null ? `/api/uploads/${row.id}/thumb` : null,
  };
}

export function getUploadRow(id: string): UploadRow | null {
  const row = getDb()
    .prepare(`SELECT * FROM uploads WHERE id = ? AND deleted_at IS NULL`)
    .get(id) as Record<string, unknown> | undefined;
  return row ? mapRow<UploadRow>(row) : null;
}

export function requireUploadRow(id: string): UploadRow {
  const row = getUploadRow(id);
  if (!row) throw notFound("Upload");
  return row;
}

export function listAttachmentsFor(parentType: AttachmentParentType, parentId: string): Upload[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM uploads WHERE parent_type = ? AND parent_id = ? AND deleted_at IS NULL
        ORDER BY created_at`,
    )
    .all(parentType, parentId) as Record<string, unknown>[];
  return rows.map((r) => toUploadDto(mapRow<UploadRow>(r)));
}

export function listAttachmentsForProperty(propertyId: string): Upload[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM uploads WHERE property_id = ? AND deleted_at IS NULL ORDER BY created_at DESC`,
    )
    .all(propertyId) as Record<string, unknown>[];
  return rows.map((r) => toUploadDto(mapRow<UploadRow>(r)));
}

function monthDir(now = new Date()): { yyyy: string; mm: string } {
  return {
    yyyy: String(now.getUTCFullYear()),
    mm: String(now.getUTCMonth() + 1).padStart(2, "0"),
  };
}

/** `$UPLOAD_DIR/<YYYY>/<MM>/<uploadId>.<ext>` — never derived from the client filename. */
export function storedPathFor(uploadId: string, ext: string): { relPath: string; absPath: string } {
  const { yyyy, mm } = monthDir();
  const relPath = join(yyyy, mm, `${uploadId}.${ext}`);
  const absPath = join(getEnv().UPLOAD_DIR, relPath);
  mkdirSync(join(getEnv().UPLOAD_DIR, yyyy, mm), { recursive: true });
  return { relPath, absPath };
}

export function thumbPathFor(uploadId: string): { relPath: string; absPath: string } {
  const { yyyy, mm } = monthDir();
  const relPath = join(yyyy, mm, `${uploadId}.thumb.webp`);
  const absPath = join(getEnv().UPLOAD_DIR, relPath);
  return { relPath, absPath };
}

export function absPathFromRel(relPath: string): string {
  return join(getEnv().UPLOAD_DIR, relPath);
}

export function deleteFileIfExists(absPath: string): void {
  try {
    if (existsSync(absPath)) unlinkSync(absPath);
  } catch {
    /* best-effort */
  }
}

/** Strips path separators, '..' and NUL from a client-supplied filename. Display-only. */
export function sanitizeFilename(name: string): string {
  const base = name.replace(/^.*[/\\]/, "");
  return base.replace(/\0/g, "").replace(/\.\./g, "").trim().slice(0, 255) || "upload";
}
