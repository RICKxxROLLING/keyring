// server/domain/appraisal/routes.import.ts — import a past appraisal.
//
// One endpoint, two modes, the same file both times:
//
//   mode=preview  read the file and say what is in it and where each value
//                 would go. Writes nothing.
//   mode=apply    read the file AGAIN and write only what the person ticked.
//
// The client sends back the keys it ticked, never the values. What is saved is
// what the server reads out of the file on the second pass, so a browser cannot
// put a figure into the checklist that the report does not contain.
//
// Accepted: the UAD 3.6 delivery ZIP (XML + report PDF + images), a bare UAD
// 3.6 XML file, or a PDF of any appraisal. The report PDF, when there is one,
// is filed under the property through the normal upload pipeline and attached
// to every item the import touched.
import type { FastifyInstance, FastifyRequest } from "fastify";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { getDb, tx } from "../../db/index.js";
import { getEnv } from "../../config/env.js";
import { requireAuth, requireUser } from "../../auth/middleware.js";
import { parseParams, zId, IdParamSchema } from "../../lib/validate.js";
import { ApiError, ok, deleted, notFound } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import { nowIso } from "../../lib/time.js";
import { isZip, unzip, ZipError } from "../../lib/unzip.js";
import { XmlError } from "../../lib/xml.js";
import { indexEntity } from "../../search/index-entity.js";
import { recordMutation, recordDelete, publishAfterCommit } from "../common/crud.js";
import { getPropertyRow, toPropertyView } from "../properties/repo.js";
import { storeUpload } from "../../uploads/routes.uploads.js";
import { toUploadDto, type UploadRow } from "../../uploads/storage.js";
import { mapRow } from "../common/rowmap.js";
import {
  getAppraisalReportRow,
  getAppraisalRow,
  listAppraisal,
  nextAppraisalSortOrder,
  toAppraisalView,
  toReportView,
} from "./repo.js";
import { extractFromPdfText, extractFromUadXml, ImportError, type Extracted } from "./import.js";
import { APPRAISAL_TEMPLATE } from "../../../shared/appraisal-checklist.js";
import type { AppContext } from "../../context.js";
import type {
  AppraisalImportPreview,
  AppraisalImportResult,
  AppraisalItem,
  AppraisalItemView,
  ImportablePropertyField,
  Property,
} from "../../../shared/types.js";

const run = promisify(execFile);

const SelectionSchema = z
  .object({
    facts: z.array(z.string().max(40)).max(100).default([]),
    defects: z.array(z.string().max(40)).max(500).default([]),
    propertyFields: z.array(z.enum(["yearBuilt", "sqft", "lotSqft", "parcelNumber"])).max(4).default([]),
    /** Fact keys whose items should be marked N/A ("no ADU reported"). */
    markNotApplicable: z.array(z.string().max(40)).max(50).default([]),
  })
  .strict();

const PROPERTY_COLUMNS: Record<ImportablePropertyField, string> = {
  yearBuilt: "year_built",
  sqft: "sqft",
  lotSqft: "lot_sqft",
  parcelNumber: "parcel_number",
};

interface ReadFile {
  extracted: Extracted;
  /** The report PDF to file, if the input carried one. */
  pdf: { data: Buffer; filename: string } | null;
}

/** pdftotext, installed in the image. Null when it is not there (a dev box, CI). */
async function pdfText(pdf: Buffer): Promise<string | null> {
  const dir = mkdtempSync(join(tmpdir(), "keyring-pdf-"));
  try {
    const path = join(dir, "in.pdf");
    writeFileSync(path, pdf);
    const { stdout } = await run("pdftotext", ["-layout", "-q", path, "-"], {
      timeout: 30_000,
      maxBuffer: 32 * 1024 * 1024,
    });
    return stdout;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new ImportError("That PDF could not be read. It may be damaged or password-protected.");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Swappable in tests, where pdftotext may not be installed. */
export const importSeams = { pdfText };

async function readAppraisalFile(buf: Buffer, filename: string): Promise<ReadFile> {
  const lower = filename.toLowerCase();
  try {
    if (isZip(buf)) {
      const entries = unzip(buf, (n) => /\.(xml|pdf)$/i.test(n) && !n.startsWith("__MACOSX/"));
      const xml = entries.filter((e) => e.name.toLowerCase().endsWith(".xml")).sort((a, b) => b.data.length - a.data.length)[0];
      const pdf = entries.filter((e) => e.name.toLowerCase().endsWith(".pdf")).sort((a, b) => b.data.length - a.data.length)[0];
      const pdfOut = pdf ? { data: pdf.data, filename: pdf.name.split(/[\\/]/).pop()! } : null;
      if (xml) return { extracted: extractFromUadXml(xml.data.toString("utf8")), pdf: pdfOut };
      if (pdf) return readAppraisalFile(pdf.data, pdfOut!.filename);
      throw new ImportError("That ZIP has no appraisal XML or PDF in it.");
    }
    if (buf.subarray(0, 5).toString("latin1") === "%PDF-") {
      const text = await importSeams.pdfText(buf);
      if (text === null) {
        throw new ImportError(
          "Reading PDFs isn't available on this server. Import the UAD 3.6 ZIP or XML instead — or update to an image that includes pdftotext.",
        );
      }
      return { extracted: extractFromPdfText(text), pdf: { data: buf, filename } };
    }
    const head = buf.subarray(0, 512).toString("utf8").replace(/^\uFEFF/, "").trimStart();
    if (head.startsWith("<") || lower.endsWith(".xml")) {
      return { extracted: extractFromUadXml(buf.toString("utf8")), pdf: null };
    }
  } catch (err) {
    if (err instanceof ImportError || err instanceof ZipError || err instanceof XmlError) {
      throw new ApiError("BAD_REQUEST", err.message);
    }
    throw err;
  }
  throw new ApiError(
    "BAD_REQUEST",
    "That isn't an appraisal file this can read. Use the UAD 3.6 ZIP or XML, or a PDF of the report.",
  );
}

/** Loose on purpose: catches the wrong house, not a differently typed address. */
function addressMismatch(subject: string | null, p: Property): boolean {
  if (!subject) return false;
  const zip = /\b(\d{5})(?:-\d{4})?\b(?!.*\b\d{5}\b)/.exec(subject)?.[1];
  if (zip && p.postalCode && zip !== p.postalCode.slice(0, 5)) return true;
  const number = /^\s*(\d+)/.exec(subject)?.[1];
  const ours = /^\s*(\d+)/.exec(p.addressLine1)?.[1];
  return Boolean(number && ours && number !== ours);
}

function currentValue(p: Property, field: ImportablePropertyField): number | string | null {
  return p[field] ?? null;
}

function toPreview(read: ReadFile, filename: string, property: Property): AppraisalImportPreview {
  const e = read.extracted;
  return {
    ...e,
    sourceFilename: filename,
    hasReportPdf: read.pdf !== null,
    addressMismatch: addressMismatch(e.subjectAddress, property),
    facts: e.facts.map((f) =>
      f.propertyField ? { ...f, currentPropertyValue: currentValue(property, f.propertyField) } : f,
    ),
  };
}

async function readMultipart(req: FastifyRequest): Promise<{ file: Buffer; filename: string; fields: Record<string, string> }> {
  const limit = getEnv().UPLOAD_MAX_BYTES;
  let file: Buffer | null = null;
  let filename = "";
  const fields: Record<string, string> = {};
  for await (const part of req.parts()) {
    if (part.type === "file") {
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of part.file as AsyncIterable<Buffer>) {
        total += chunk.length;
        if (total > limit) {
          part.file.resume();
          throw new ApiError("PAYLOAD_TOO_LARGE", `File exceeds the ${limit} byte limit.`);
        }
        chunks.push(chunk);
      }
      if ((part.file as { truncated?: boolean }).truncated) {
        throw new ApiError("PAYLOAD_TOO_LARGE", `File exceeds the ${limit} byte limit.`);
      }
      file = Buffer.concat(chunks);
      filename = part.filename || "appraisal";
    } else {
      fields[part.fieldname] = String(part.value);
    }
  }
  if (!file) throw new ApiError("BAD_REQUEST", "No file was sent.");
  return { file, filename, fields };
}

/** A description short enough to be a list label, cut at a word. */
function defectLabel(description: string): string {
  const one = description.replace(/\s+/g, " ").trim();
  if (one.length <= 110) return one;
  const cut = one.slice(0, 107);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 60))}…`;
}

export function registerAppraisalImportRoutes(app: FastifyInstance, _ctx: AppContext): void {
  const db = getDb();

  app.post("/api/properties/:propertyId/appraisal/import", { preHandler: [requireAuth] }, async (req, reply) => {
    const user = requireUser(req);
    const { propertyId } = parseParams(req, z.object({ propertyId: zId }).strict());
    const property = getPropertyRow(propertyId);
    const { file, filename, fields } = await readMultipart(req);
    const mode = fields.mode === "apply" ? "apply" : "preview";

    const read = await readAppraisalFile(file, filename);
    const preview = toPreview(read, filename, property);
    if (mode === "preview") return ok(preview);

    let selectionRaw: unknown;
    try {
      selectionRaw = JSON.parse(fields.selection ?? "{}");
    } catch {
      throw new ApiError("BAD_REQUEST", "The selection could not be read.");
    }
    const parsed = SelectionSchema.safeParse(selectionRaw);
    if (!parsed.success) throw new ApiError("VALIDATION_FAILED", "The selection is not valid.");
    const sel = parsed.data;

    const facts = preview.facts.filter((f) => sel.facts.includes(f.key));
    const defects = preview.defects.filter((d) => sel.defects.includes(d.key));
    const propertyFacts = preview.facts.filter(
      (f) => f.propertyField && f.propertyValue !== undefined && sel.propertyFields.includes(f.propertyField),
    );

    // Filed first, outside the transaction below: storeUpload commits its own.
    // If the import then fails, the report is still in Files — which is where
    // a person would look for it anyway.
    // The same report imported again reuses the copy already in Files (PDFs
    // are stored byte for byte, so the hash identifies it) rather than filing
    // a second one.
    const sameFile = read.pdf
      ? (db
          .prepare(`SELECT * FROM uploads WHERE property_id = ? AND sha256 = ? AND deleted_at IS NULL LIMIT 1`)
          .get(propertyId, createHash("sha256").update(read.pdf.data).digest("hex")) as Record<string, unknown> | undefined)
      : undefined;
    const upload = sameFile
      ? toUploadDto(mapRow<UploadRow>(sameFile))
      : read.pdf
      ? await storeUpload(req, {
          buffer: read.pdf.data,
          filename: read.pdf.filename,
          parentType: "property",
          parentId: propertyId,
          caption: `Appraisal${preview.report.effectiveDate ? ` effective ${preview.report.effectiveDate}` : ""}`,
        })
      : null;

    const at = nowIso();
    const asOf = preview.report.effectiveDate;
    const intro = `From the appraisal${asOf ? ` effective ${asOf}` : ""}:`;
    const touched = new Map<string, "created" | "updated">();
    let itemsCreated = 0;

    const result = tx(() => {
      const byLabel = new Map(listAppraisal(propertyId).map((i) => [i.label.trim().toLowerCase(), i as AppraisalItem]));
      let order = nextAppraisalSortOrder(propertyId);

      const link = (itemId: string): void => {
        if (!upload) return;
        db.prepare(
          `INSERT OR IGNORE INTO appraisal_item_uploads (item_id, upload_id, created_at, created_by) VALUES (?, ?, ?, ?)`,
        ).run(itemId, upload.id, at, user.id);
      };
      const insert = (row: Omit<AppraisalItem, "createdAt" | "updatedAt" | "createdBy" | "updatedBy" | "version">): AppraisalItem => {
        db.prepare(
          `INSERT INTO appraisal_items (id, property_id, label, section, kind, status, detail, finding, as_of,
             recommended_action, estimate_cents, project_id, sort_order, created_at, updated_at, created_by, updated_by, version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 1)`,
        ).run(
          row.id, propertyId, row.label, row.section, row.kind, row.status, row.detail, row.finding, row.asOf,
          row.recommendedAction, row.estimateCents, row.sortOrder, at, at, user.id, user.id,
        );
        itemsCreated++;
        touched.set(row.id, "created");
        const saved = getAppraisalRow(row.id);
        byLabel.set(saved.label.trim().toLowerCase(), saved);
        return saved;
      };

      /* facts -> checklist items, grouped so one item gets one paragraph */
      const groups = new Map<string, typeof facts>();
      for (const f of facts) {
        if (!f.itemLabel) continue;
        groups.set(f.itemLabel, [...(groups.get(f.itemLabel) ?? []), f]);
      }
      for (const [label, group] of groups) {
        let item = byLabel.get(label.trim().toLowerCase());
        if (!item) {
          const t = APPRAISAL_TEMPLATE.find((x) => x.label === label);
          item = insert({
            id: newId("apr"), propertyId, label, section: t?.section ?? "other", kind: t?.kind ?? "fact",
            status: "todo", detail: t?.detail ?? null, finding: null, asOf: null, recommendedAction: null,
            estimateCents: null, projectId: null, sortOrder: order++,
          });
        }
        const text = `${intro} ${group.map((f) => f.value).join("; ")}`;
        // Appended, never overwritten: what someone typed there is theirs. And
        // importing the same report twice does not write the paragraph twice.
        const finding = item.finding?.includes(text) ? item.finding : [item.finding, text].filter(Boolean).join("\n");
        const markNa = group.some((f) => f.suggestsNotApplicable && sel.markNotApplicable.includes(f.key));
        const status = markNa
          ? "not_applicable"
          : item.status !== "todo"
            ? item.status
            : item.kind === "fact"
              ? "ready"
              : "in_progress";
        const newAsOf = asOf && (!item.asOf || item.asOf < asOf) ? asOf : item.asOf;
        db.prepare(
          `UPDATE appraisal_items SET finding = ?, status = ?, as_of = ?, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?`,
        ).run(finding, status, newAsOf, at, user.id, item.id);
        link(item.id);
        if (!touched.has(item.id)) touched.set(item.id, "updated");
      }

      /* defects */
      let defectsAdded = 0;
      for (const d of defects) {
        const label = defectLabel(d.description);
        const existing = byLabel.get(label.trim().toLowerCase());
        if (existing) {
          link(existing.id);
          continue;
        }
        const saved = insert({
          id: newId("apr"), propertyId, label, section: "defects", kind: "defect", status: "todo",
          detail: [d.where ? `${d.where}.` : null, d.description, d.affectsSoundness ? "Affects soundness or structural integrity." : null, `${intro.replace(/:$/, ".")}`]
            .filter(Boolean)
            .join(" "),
          finding: null, asOf, recommendedAction: d.recommendedAction ?? "repair", estimateCents: d.estimateCents,
          projectId: null, sortOrder: order++,
        });
        link(saved.id);
        defectsAdded++;
      }

      /* property record */
      const updatedFields: ImportablePropertyField[] = [];
      if (propertyFacts.length) {
        const sets = propertyFacts.map((f) => `${PROPERTY_COLUMNS[f.propertyField!]} = ?`);
        db.prepare(
          `UPDATE properties SET ${sets.join(", ")}, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?`,
        ).run(...propertyFacts.map((f) => f.propertyValue as string | number), at, user.id, propertyId);
        updatedFields.push(...propertyFacts.map((f) => f.propertyField!));
      }

      /* history — one entry per report, however many times it is imported */
      const itemsFilled = groups.size;
      const existingReport = db
        .prepare(
          `SELECT id FROM appraisal_reports WHERE property_id = ? AND source_format = ?
             AND effective_date IS ? AND opinion_of_value_cents IS ? LIMIT 1`,
        )
        .get(propertyId, preview.format, asOf, preview.report.opinionOfValueCents) as { id: string } | undefined;
      const reportId = existingReport?.id ?? newId("apx");
      if (existingReport) {
        db.prepare(
          `UPDATE appraisal_reports SET items_filled = MAX(items_filled, ?), defects_added = defects_added + ?,
             upload_id = COALESCE(upload_id, ?) WHERE id = ?`,
        ).run(itemsFilled, defectsAdded, upload?.id ?? null, reportId);
      } else db.prepare(
        `INSERT INTO appraisal_reports (id, property_id, effective_date, opinion_of_value_cents, assignment_type,
           value_condition, overall_condition, overall_quality, source_format, source_filename, upload_id,
           items_filled, defects_added, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        reportId, propertyId, asOf, preview.report.opinionOfValueCents, preview.report.assignmentType,
        preview.report.valueCondition, preview.report.overallCondition, preview.report.overallQuality,
        preview.format, filename.slice(0, 200), upload?.id ?? null, itemsFilled, defectsAdded, at, user.id,
      );

      for (const id of touched.keys()) {
        const row = getAppraisalRow(id);
        indexEntity({
          entityType: "appraisal_item", entityId: id, propertyId, title: row.label,
          body: [row.detail, row.finding].filter(Boolean).join(" "),
          url: `/p/${propertyId}/appraisal?item=${id}`, updatedAt: at,
        });
      }
      recordMutation(req, {
        action: "create",
        entityType: "appraisal_item",
        entityId: reportId,
        propertyId,
        summary: `imported an appraisal${asOf ? ` effective ${asOf}` : ""} into "${property.name}": ${itemsFilled} checklist ${
          itemsFilled === 1 ? "item" : "items"
        } filled, ${defectsAdded} ${defectsAdded === 1 ? "defect" : "defects"} added${
          updatedFields.length ? `, property ${updatedFields.join(", ")} updated` : ""
        }`,
        after: { reportId, facts: facts.map((f) => f.key), defects: defectsAdded, propertyFields: updatedFields },
      });

      const out: AppraisalImportResult = {
        report: toReportView(getAppraisalReportRow(reportId)),
        itemsFilled,
        itemsCreated,
        defectsAdded,
        propertyFieldsUpdated: updatedFields,
      };
      return out;
    });

    for (const [id, how] of touched) {
      const view: AppraisalItemView = toAppraisalView(getAppraisalRow(id));
      publishAfterCommit({
        action: how, entityType: "appraisal_item", entityId: id, propertyId,
        version: view.version, actorId: user.id, data: view,
      });
    }
    if (result.propertyFieldsUpdated.length) {
      const view = toPropertyView(getPropertyRow(propertyId));
      publishAfterCommit({
        action: "updated", entityType: "property", entityId: propertyId, propertyId,
        version: view.version, actorId: user.id, data: view,
      });
    }
    return reply.code(201).send(ok(result));
  });

  /** Remove a history entry. The report PDF stays in Files. */
  app.delete("/api/appraisal-reports/:id", { preHandler: [requireAuth] }, async (req) => {
    requireUser(req);
    const { id } = parseParams(req, IdParamSchema);
    const report = getAppraisalReportRow(id);
    tx(() => {
      const info = db.prepare(`DELETE FROM appraisal_reports WHERE id = ?`).run(id);
      if (info.changes === 0) throw notFound("Appraisal report");
      recordDelete(req, {
        action: "delete",
        entityType: "appraisal_item",
        entityId: id,
        propertyId: report.propertyId,
        summary: `removed the appraisal${report.effectiveDate ? ` of ${report.effectiveDate}` : ""} from the history`,
      });
    });
    return deleted(id);
  });
}
