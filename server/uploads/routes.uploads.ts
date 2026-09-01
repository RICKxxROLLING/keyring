// server/uploads/routes.uploads.ts
import { createHash } from "node:crypto";
import { createReadStream, writeFileSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb, tx } from "../db/index.js";
import { getEnv } from "../config/env.js";
import { requireAuth, requireUser } from "../auth/middleware.js";
import { ApiError, ok, deleted, notFound } from "../lib/errors.js";
import { newId } from "../lib/ids.js";
import { nowIso } from "../lib/time.js";
import { isOcrAvailable, readImageText, MAX_OCR_BYTES } from "./ocr.js";
import { parseReceipt } from "../../shared/receipt-parse.js";
import { buildPage, parsePaging } from "../lib/paging.js";
import { parseBody, parseParams, parseQuery, zId, zOptText, PagingQuerySchema, IdParamSchema } from "../lib/validate.js";
import { recordMutation, recordDelete, publishAfterCommit } from "../domain/common/crud.js";
import {
  toUploadDto,
  getUploadRow,
  requireUploadRow,
  storedPathFor,
  thumbPathFor,
  absPathFromRel,
  deleteFileIfExists,
  sanitizeFilename,
  type UploadRow,
} from "./storage.js";
import { requireKnownFileType, requireWithinSizeLimit } from "./validate-file.js";
import { processImage } from "./thumbnails.js";
import type { AppContext } from "../context.js";
import type { AttachmentParentType, Upload } from "../../shared/types.js";
import { mapRow } from "../domain/common/rowmap.js";

const PARENT_TABLE: Record<AttachmentParentType, string> = {
  property: "properties",
  unit: "units",
  note: "notes",
  work_order: "work_orders",
  project: "projects",
  lease: "leases",
  tenant: "tenants",
  property_expense: "property_expenses",
  spec_entry: "spec_entries",
  turnover: "turnovers",
  compliance_item: "compliance_items",
  vendor: "vendors",
};

const PARENT_TYPES = Object.keys(PARENT_TABLE) as AttachmentParentType[];

/** Resolves the propertyId a parent entity belongs to (null for portfolio-wide vendor). Throws NOT_FOUND. */
function resolveParentPropertyId(parentType: AttachmentParentType, parentId: string): string | null {
  const table = PARENT_TABLE[parentType];
  if (parentType === "property") {
    const row = getDb().prepare(`SELECT id FROM properties WHERE id = ?`).get(parentId);
    if (!row) throw notFound("Property");
    return parentId;
  }
  if (parentType === "vendor") {
    const row = getDb().prepare(`SELECT id FROM vendors WHERE id = ?`).get(parentId);
    if (!row) throw notFound("Vendor");
    return null;
  }
  const row = getDb().prepare(`SELECT property_id FROM ${table} WHERE id = ?`).get(parentId) as
    | { property_id: string }
    | undefined;
  if (!row) throw notFound("Parent entity");
  return row.property_id;
}

const ListQuerySchema = PagingQuerySchema.extend({
  parentType: z.enum(PARENT_TYPES as [AttachmentParentType, ...AttachmentParentType[]]).optional(),
  parentId: zId.optional(),
  propertyId: zId.optional(),
}).strict();

/**
 * Caption, and re-filing.
 *
 * parentType and parentId move together or not at all: half a move would leave
 * an upload pointing at an id of the wrong kind. A scanned receipt is uploaded
 * against the property — the only parent that exists at the time — and moved
 * onto the expense once that expense has been created.
 */
const PatchUploadSchema = z
  .object({
    caption: zOptText(500),
    parentType: z.enum(PARENT_TYPES as [AttachmentParentType, ...AttachmentParentType[]]).optional(),
    parentId: zId.optional(),
  })
  .strict()
  .refine((b) => (b.parentType === undefined) === (b.parentId === undefined), {
    message: "parentType and parentId must be given together.",
  });

export function registerUploadRoutes(app: FastifyInstance, _ctx: AppContext): void {
  const db = getDb();

  app.post("/api/uploads", { preHandler: [requireAuth] }, async (req, reply) => {
    const user = requireUser(req);
    const env = getEnv();

    let fileSeen = false;
    let declaredFilename = "";
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    const fields: Record<string, string> = {};

    for await (const part of req.parts()) {
      if (part.type === "file") {
        if (fileSeen) {
          part.file.resume();
          throw new ApiError("BAD_REQUEST", "Only one file part is allowed.");
        }
        fileSeen = true;
        declaredFilename = part.filename;
        for await (const chunk of part.file as AsyncIterable<Buffer>) {
          totalBytes += chunk.length;
          if (totalBytes > env.UPLOAD_MAX_BYTES) {
            part.file.resume();
            throw new ApiError("PAYLOAD_TOO_LARGE", `File exceeds the ${env.UPLOAD_MAX_BYTES} byte limit.`);
          }
          chunks.push(chunk);
        }
        if ((part.file as { truncated?: boolean }).truncated) {
          throw new ApiError("PAYLOAD_TOO_LARGE", `File exceeds the ${env.UPLOAD_MAX_BYTES} byte limit.`);
        }
      } else {
        fields[part.fieldname] = String(part.value);
      }
    }
    if (!fileSeen) throw new ApiError("BAD_REQUEST", "No file part provided.");

    const FieldsSchema = z
      .object({
        parentType: z.enum(PARENT_TYPES as [AttachmentParentType, ...AttachmentParentType[]]),
        parentId: zId,
        caption: zOptText(500),
      })
      .strict();
    const parsedFields = FieldsSchema.parse({
      parentType: fields.parentType,
      parentId: fields.parentId,
      caption: fields.caption ?? undefined,
    });

    const propertyId = resolveParentPropertyId(parsedFields.parentType, parsedFields.parentId);
    const buffer = Buffer.concat(chunks);
    requireWithinSizeLimit(buffer.length, env.UPLOAD_MAX_BYTES);
    const detected = requireKnownFileType(buffer);

    const id = newId("upl");
    const filename = sanitizeFilename(declaredFilename || "upload");
    const at = nowIso();

    let outBuf: Buffer;
    let outMime: string;
    let width: number | null = null;
    let height: number | null = null;
    let thumbRel: string | null = null;
    const { relPath, absPath } = storedPathFor(id, detected.kind === "pdf" ? "pdf" : "jpg");

    if (detected.kind === "image") {
      const processed = await processImage(buffer);
      outBuf = processed.output;
      outMime = processed.outputMime;
      width = processed.width;
      height = processed.height;
      const thumb = thumbPathFor(id);
      writeFileSync(thumb.absPath, processed.thumb);
      thumbRel = thumb.relPath;
    } else {
      outBuf = buffer;
      outMime = detected.mime;
    }
    writeFileSync(absPath, outBuf);
    const sha256 = createHash("sha256").update(outBuf).digest("hex");

    const dto = tx(() => {
      db.prepare(
        `INSERT INTO uploads (id, parent_type, parent_id, property_id, filename, stored_path,
           thumb_path, mime, kind, size_bytes, sha256, width, height, caption, uploaded_by,
           created_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      ).run(
        id,
        parsedFields.parentType,
        parsedFields.parentId,
        propertyId,
        filename,
        relPath,
        thumbRel,
        outMime,
        detected.kind,
        outBuf.length,
        sha256,
        width,
        height,
        parsedFields.caption ?? null,
        user.id,
        at,
      );
      recordMutation(req, {
        action: "create",
        entityType: "upload",
        entityId: id,
        propertyId,
        summary: `uploaded "${filename}" on ${parsedFields.parentType}`,
        after: { filename, kind: detected.kind, parentType: parsedFields.parentType },
      });
      const row = mapRow<UploadRow>(
        db.prepare(`SELECT * FROM uploads WHERE id = ?`).get(id) as Record<string, unknown>,
      );
      return toUploadDto(row);
    });
    publishAfterCommit({
      action: "created",
      entityType: "upload",
      entityId: id,
      propertyId,
      version: 1,
      actorId: user.id,
      data: dto,
    });
    return reply.code(201).send(ok(dto));
  });

  app.get("/api/uploads", { preHandler: [requireAuth] }, async (req) => {
    const q = parseQuery(req, ListQuerySchema);
    const { limit } = parsePaging(q);
    let rows: Record<string, unknown>[];
    if (q.parentType && q.parentId) {
      rows = db
        .prepare(
          `SELECT * FROM uploads WHERE parent_type = ? AND parent_id = ? AND deleted_at IS NULL
            ORDER BY created_at DESC LIMIT ?`,
        )
        .all(q.parentType, q.parentId, limit + 1) as Record<string, unknown>[];
    } else if (q.propertyId) {
      rows = db
        .prepare(
          `SELECT * FROM uploads WHERE property_id = ? AND deleted_at IS NULL
            ORDER BY created_at DESC LIMIT ?`,
        )
        .all(q.propertyId, limit + 1) as Record<string, unknown>[];
    } else {
      rows = db
        .prepare(`SELECT * FROM uploads WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT ?`)
        .all(limit + 1) as Record<string, unknown>[];
    }
    const dtos: Upload[] = rows.map((r) => toUploadDto(mapRow<UploadRow>(r)));
    return ok(buildPage(dtos, limit, (u) => u.createdAt));
  });

  app.get("/api/uploads/:id", { preHandler: [requireAuth] }, async (req) => {
    const { id } = parseParams(req, IdParamSchema);
    return ok(toUploadDto(requireUploadRow(id)));
  });

  app.get("/api/uploads/:id/raw", { preHandler: [requireAuth] }, async (req, reply) => {
    const { id } = parseParams(req, IdParamSchema);
    const row = requireUploadRow(id);
    const absPath = absPathFromRel(row.storedPath);
    if (row.kind === "pdf") {
      reply.header("Content-Disposition", `attachment; filename="${encodeURIComponent(row.filename)}"`);
      reply.header("Content-Type", "application/pdf");
      reply.header("X-Content-Type-Options", "nosniff");
      reply.header("Content-Security-Policy", "sandbox");
    } else {
      reply.header("Content-Type", row.mime);
      reply.header("Content-Disposition", `inline; filename="${encodeURIComponent(row.filename)}"`);
      reply.header("X-Content-Type-Options", "nosniff");
    }
    return reply.send(createReadStream(absPath));
  });

  /**
   * Read a receipt.
   *
   * A POST because it does real work — a subprocess and up to twenty seconds of
   * CPU — not because it changes anything. It stores nothing: the parsed fields
   * come back for a person to check and correct before an expense is created
   * from them. OCR is confidently wrong often enough that writing straight to
   * the ledger would be indefensible.
   */
  app.post("/api/uploads/:id/ocr", { preHandler: [requireAuth] }, async (req) => {
    const { id } = parseParams(req, IdParamSchema);
    const row = requireUploadRow(id);

    if (row.kind !== "image") {
      throw new ApiError("BAD_REQUEST", "Only photos can be scanned. PDFs are stored as they are.");
    }
    if (row.sizeBytes > MAX_OCR_BYTES) {
      throw new ApiError("BAD_REQUEST", "That image is too large to scan.");
    }

    if (!(await isOcrAvailable())) {
      // Not an error: the upload worked, and the fields are typed by hand
      // exactly as they were before scanning existed.
      return ok({ available: false as const, fields: {}, text: null });
    }

    const result = await readImageText(absPathFromRel(row.storedPath));
    if (!result) {
      return ok({ available: true as const, fields: {}, text: null });
    }

    req.log.info({ uploadId: id, ms: result.ms, chars: result.text.length }, "receipt scanned");
    return ok({
      available: true as const,
      fields: parseReceipt(result.text),
      // Returned so a wrong reading can be diagnosed as bad pixels rather than
      // a bad parser, without going to the server logs.
      text: result.text,
    });
  });

  app.get("/api/uploads/:id/thumb", { preHandler: [requireAuth] }, async (req, reply) => {
    const { id } = parseParams(req, IdParamSchema);
    const row = requireUploadRow(id);
    if (!row.thumbPath) throw notFound("Thumbnail");
    reply.header("Content-Type", "image/webp");
    reply.header("X-Content-Type-Options", "nosniff");
    return reply.send(createReadStream(absPathFromRel(row.thumbPath)));
  });

  app.patch("/api/uploads/:id", { preHandler: [requireAuth] }, async (req) => {
    const user = requireUser(req);
    const { id } = parseParams(req, IdParamSchema);
    const body = parseBody(req, PatchUploadSchema);
    const existing = requireUploadRow(id);
    // Re-resolved rather than carried over: the new parent decides which
    // property the upload belongs to, and this throws if it does not exist.
    const moving = body.parentType !== undefined && body.parentId !== undefined;
    const propertyId = moving
      ? resolveParentPropertyId(body.parentType!, body.parentId!)
      : existing.propertyId;

    const dto = tx(() => {
      if (moving) {
        db.prepare(
          `UPDATE uploads SET caption = ?, parent_type = ?, parent_id = ?, property_id = ?
            WHERE id = ? AND deleted_at IS NULL`,
        ).run(body.caption ?? null, body.parentType!, body.parentId!, propertyId, id);
      } else {
        db.prepare(`UPDATE uploads SET caption = ? WHERE id = ? AND deleted_at IS NULL`).run(
          body.caption ?? null,
          id,
        );
      }
      recordMutation(req, {
        action: "update",
        entityType: "upload",
        entityId: id,
        propertyId,
        summary: moving
          ? `filed "${existing.filename}" under ${body.parentType!.replace(/_/g, " ")}`
          : `updated caption on "${existing.filename}"`,
        after: moving
          ? { caption: body.caption ?? null, parentType: body.parentType, parentId: body.parentId }
          : { caption: body.caption ?? null },
      });
      return toUploadDto(requireUploadRow(id));
    });
    publishAfterCommit({
      action: "updated",
      entityType: "upload",
      entityId: id,
      propertyId: existing.propertyId,
      version: 1,
      actorId: user.id,
      data: dto,
    });
    return ok(dto);
  });

  app.delete("/api/uploads/:id", { preHandler: [requireAuth] }, async (req) => {
    const user = requireUser(req);
    const { id } = parseParams(req, IdParamSchema);
    const existing = requireUploadRow(id);
    tx(() => {
      const at = nowIso();
      const info = db
        .prepare(`UPDATE uploads SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`)
        .run(at, id);
      if (info.changes === 0) throw notFound("Upload");
      recordDelete(req, {
        action: "delete",
        entityType: "upload",
        entityId: id,
        propertyId: existing.propertyId,
        summary: `deleted upload "${existing.filename}"`,
      });
    });
    publishAfterCommit({
      action: "deleted",
      entityType: "upload",
      entityId: id,
      propertyId: existing.propertyId,
      version: 0,
      actorId: user.id,
    });
    return deleted(id);
  });
}

/** Used by domain modules to validate a singular pointer (coverUploadId, documentUploadId). */
export function requireUploadBelongsTo(
  uploadId: string,
  parentType: AttachmentParentType,
  parentId: string,
): void {
  const row = getUploadRow(uploadId);
  if (!row) throw notFound("Upload");
  if (row.parentType !== parentType || row.parentId !== parentId) {
    throw new ApiError("BAD_REQUEST", "Upload does not belong to this entity.");
  }
}

/** Deletes the on-disk files for uploads soft-deleted at least `days` ago. Used by the uploads-gc job. */
export function purgeSoftDeletedFiles(days: number): number {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = getDb()
    .prepare(`SELECT id, stored_path, thumb_path FROM uploads WHERE deleted_at IS NOT NULL AND deleted_at < ?`)
    .all(cutoff) as { id: string; stored_path: string; thumb_path: string | null }[];
  for (const r of rows) {
    deleteFileIfExists(absPathFromRel(r.stored_path));
    if (r.thumb_path) deleteFileIfExists(absPathFromRel(r.thumb_path));
  }
  return rows.length;
}
