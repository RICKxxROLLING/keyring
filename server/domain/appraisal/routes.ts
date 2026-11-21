// server/domain/appraisal/routes.ts — getting a property ready for a UAD 3.6
// appraisal: the checklist, the repair budget, and the binder.
//
// Three endpoints do the interesting work:
//
//   POST .../appraisal/checklist  applies the starter list, idempotent by label
//                                 (same rule and same reasons as diligence),
//                                 filtered to what can apply to this property.
//
//   POST .../appraisal/budget     takes every open defect with an estimate that
//                                 is not on a project yet and puts it on one as
//                                 a budget line. Run it twice and nothing is
//                                 budgeted twice: a linked defect is skipped.
//
//   GET  .../appraisal/binder.zip everything you would hand an appraiser, in
//                                 one download: a plain-text summary in report
//                                 order and every attached file, foldered by
//                                 section.
import type { FastifyInstance } from "fastify";
import { readFileSync, existsSync } from "node:fs";
import { z } from "zod";
import { getDb, tx } from "../../db/index.js";
import { requireAuth, requireUser } from "../../auth/middleware.js";
import {
  parseBody,
  parseParams,
  zCents,
  zId,
  zIsoDate,
  zOptText,
  zText,
  zVersion,
  IdParamSchema,
} from "../../lib/validate.js";
import { ok, deleted, notFound, conflict } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import { nowIso } from "../../lib/time.js";
import { onePage } from "../../lib/paging.js";
import { buildZip, type ZipEntry } from "../../lib/zip.js";
import { indexEntity } from "../../search/index-entity.js";
import { requirePropertyExists, propertyName } from "../common/access.js";
import {
  patchWithVersionGuard,
  assertVersionMatch,
  recordMutation,
  recordDelete,
  publishAfterCommit,
} from "../common/crud.js";
import { getUploadRow, absPathFromRel } from "../../uploads/storage.js";
import { getPropertyRow } from "../properties/repo.js";
import { getProjectRow, toProjectView } from "../projects/repo.js";
import {
  getAppraisalRow,
  listAppraisal,
  nextAppraisalSortOrder,
  toAppraisalView,
  unitCount,
} from "./repo.js";
import {
  APPRAISAL_ACTION_LABELS,
  APPRAISAL_KIND_LABELS,
  APPRAISAL_SECTION_LABELS,
  APPRAISAL_SECTION_ORDER,
  appraisalStatusLabel,
  appraisalTemplateFor,
  isBudgetable,
  summarizeAppraisal,
} from "../../../shared/appraisal-checklist.js";
import type { AppContext } from "../../context.js";
import type { FastifyRequest } from "fastify";
import type { AppraisalItem, AppraisalItemView, ProjectView } from "../../../shared/types.js";

const SECTIONS = [
  "site",
  "measurement",
  "dwelling",
  "updates",
  "defects",
  "energy",
  "mitigation",
  "additional",
  "photos",
  "income",
  "project",
  "other",
] as const;
const KINDS = ["document", "photo", "fact", "defect"] as const;
const STATUSES = ["todo", "in_progress", "ready", "not_applicable"] as const;
const ACTIONS = ["none", "repair", "inspect", "completion"] as const;

const CreateSchema = z
  .object({
    label: zText(200).min(1, "Give it a name."),
    section: z.enum(SECTIONS).default("other"),
    kind: z.enum(KINDS).default("document"),
    status: z.enum(STATUSES).default("todo"),
    detail: zOptText(4000),
    finding: zOptText(4000),
    asOf: zIsoDate.nullable().optional(),
    recommendedAction: z.enum(ACTIONS).nullable().optional(),
    estimateCents: zCents.nonnegative().nullable().optional(),
    projectId: zId.nullable().optional(),
    sortOrder: z.number().int().optional(),
  })
  .strict();

// Defaulted fields re-declared without defaults, so a PATCH that omits them
// leaves them alone instead of resetting them.
const PatchSchema = CreateSchema.partial()
  .extend({
    section: z.enum(SECTIONS).optional(),
    kind: z.enum(KINDS).optional(),
    status: z.enum(STATUSES).optional(),
    expectedVersion: zVersion,
  })
  .strict();

const AttachSchema = z.object({ uploadId: zId }).strict();
const BudgetSchema = z.object({ projectId: zId.optional() }).strict().optional();

const BUDGET_PROJECT_TITLE = "Repairs before the appraisal";

function searchDoc(row: AppraisalItem) {
  return {
    entityType: "appraisal_item" as const,
    entityId: row.id,
    propertyId: row.propertyId,
    title: row.label,
    body: [row.detail, row.finding].filter(Boolean).join(" "),
    url: `/p/${row.propertyId}/appraisal?item=${row.id}`,
    updatedAt: row.updatedAt,
  };
}

/** A project referenced from an item must exist and be on the same property. */
function checkProject(projectId: string | null | undefined, propertyId: string): void {
  if (!projectId) return;
  const project = getProjectRow(projectId);
  if (project.propertyId !== propertyId) {
    throw conflict("That project belongs to a different property.");
  }
}

function bumpVersion(id: string, actorId: string): void {
  getDb()
    .prepare(
      `UPDATE appraisal_items SET updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?`,
    )
    .run(nowIso(), actorId, id);
}

function publishUpdated(view: AppraisalItemView, actorId: string): void {
  publishAfterCommit({
    action: "updated",
    entityType: "appraisal_item",
    entityId: view.id,
    propertyId: view.propertyId,
    version: view.version,
    actorId,
    data: view,
  });
}

export function registerAppraisalRoutes(app: FastifyInstance, _ctx: AppContext): void {
  const db = getDb();

  app.get("/api/properties/:propertyId/appraisal", { preHandler: [requireAuth] }, async (req) => {
    const { propertyId } = parseParams(req, z.object({ propertyId: zId }).strict());
    requirePropertyExists(propertyId);
    const items = listAppraisal(propertyId);
    return ok({ ...onePage(items), summary: summarizeAppraisal(items) });
  });

  app.post("/api/properties/:propertyId/appraisal", { preHandler: [requireAuth] }, async (req, reply) => {
    const user = requireUser(req);
    const { propertyId } = parseParams(req, z.object({ propertyId: zId }).strict());
    requirePropertyExists(propertyId);
    const body = parseBody(req, CreateSchema);
    checkProject(body.projectId, propertyId);

    const id = newId("apr");
    const at = nowIso();
    const view = tx(() => {
      insertItem({
        id,
        property_id: propertyId,
        label: body.label,
        section: body.section,
        kind: body.kind,
        status: body.status,
        detail: body.detail ?? null,
        finding: body.finding ?? null,
        as_of: body.asOf ?? null,
        recommended_action: body.recommendedAction ?? (body.kind === "defect" ? "repair" : null),
        estimate_cents: body.estimateCents ?? null,
        project_id: body.projectId ?? null,
        sort_order: body.sortOrder ?? nextAppraisalSortOrder(propertyId),
        at,
        actor: user.id,
      });
      const row = getAppraisalRow(id);
      recordMutation(
        req,
        {
          action: "create",
          entityType: "appraisal_item",
          entityId: id,
          propertyId,
          summary:
            row.kind === "defect"
              ? `logged a defect, "${row.label}", on "${propertyName(propertyId)}"`
              : `added "${row.label}" to the appraisal checklist for "${propertyName(propertyId)}"`,
          after: body as Record<string, unknown>,
        },
        searchDoc(row),
      );
      return toAppraisalView(row);
    });

    publishAfterCommit({
      action: "created",
      entityType: "appraisal_item",
      entityId: id,
      propertyId,
      version: 1,
      actorId: user.id,
      data: view,
    });
    return reply.code(201).send(ok(view));
  });

  /**
   * Apply the starter list, adding only what is missing, and only the lines
   * that can apply: a rent roll for a single-family house or a condo
   * questionnaire for a detached house would be noise to mark N/A.
   */
  app.post(
    "/api/properties/:propertyId/appraisal/checklist",
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const user = requireUser(req);
      const { propertyId } = parseParams(req, z.object({ propertyId: zId }).strict());
      const property = getPropertyRow(propertyId);
      const template = appraisalTemplateFor({
        propertyType: property.propertyType,
        unitCount: unitCount(propertyId),
      });

      const at = nowIso();
      const result = tx(() => {
        const existing = new Set(
          listAppraisal(propertyId).map((i) => i.label.trim().toLowerCase()),
        );
        let order = nextAppraisalSortOrder(propertyId);
        const added: AppraisalItemView[] = [];
        for (const t of template) {
          if (existing.has(t.label.trim().toLowerCase())) continue;
          const id = newId("apr");
          insertItem({
            id,
            property_id: propertyId,
            label: t.label,
            section: t.section,
            kind: t.kind,
            status: "todo",
            detail: t.detail,
            finding: null,
            as_of: null,
            recommended_action: null,
            estimate_cents: null,
            project_id: null,
            sort_order: order++,
            at,
            actor: user.id,
          });
          const row = getAppraisalRow(id);
          // Indexed one by one so "elevation certificate" finds the item, but
          // audited once below — forty identical rows would bury the afternoon.
          indexEntity(searchDoc(row));
          added.push(toAppraisalView(row));
        }
        if (added.length > 0) {
          recordMutation(req, {
            action: "create",
            entityType: "appraisal_item",
            entityId: propertyId,
            propertyId,
            summary: `added ${added.length} UAD 3.6 appraisal checklist ${
              added.length === 1 ? "item" : "items"
            } to "${propertyName(propertyId)}"`,
            after: { labels: added.map((i) => i.label) },
          });
        }
        return { added, skipped: template.length - added.length };
      });

      for (const item of result.added) {
        publishAfterCommit({
          action: "created",
          entityType: "appraisal_item",
          entityId: item.id,
          propertyId,
          version: 1,
          actorId: user.id,
          data: item,
        });
      }
      return reply.code(201).send(ok(result));
    },
  );

  app.patch("/api/appraisal-items/:id", { preHandler: [requireAuth] }, async (req) => {
    const user = requireUser(req);
    const { id } = parseParams(req, IdParamSchema);
    const existing = getAppraisalRow(id);
    const { expectedVersion, ...patch } = parseBody(req, PatchSchema);
    checkProject(patch.projectId, existing.propertyId);

    const view = tx(() => {
      const changes = patchWithVersionGuard({
        table: "appraisal_items",
        id,
        patch,
        expectedVersion,
        actorId: user.id,
      });
      assertVersionMatch({
        table: "appraisal_items",
        id,
        changes,
        what: "Appraisal item",
        currentView: () => toAppraisalView(getAppraisalRow(id)),
      });
      const row = getAppraisalRow(id);
      recordMutation(
        req,
        {
          action: "update",
          entityType: "appraisal_item",
          entityId: id,
          propertyId: row.propertyId,
          summary:
            patch.status && patch.status !== existing.status
              ? `marked "${row.label}" ${appraisalStatusLabel(patch.status, row.kind).toLowerCase()}`
              : `updated "${row.label}" on the appraisal checklist`,
          after: patch as Record<string, unknown>,
        },
        searchDoc(row),
      );
      return toAppraisalView(row);
    });
    publishUpdated(view, user.id);
    return ok(view);
  });

  app.delete("/api/appraisal-items/:id", { preHandler: [requireAuth] }, async (req) => {
    const user = requireUser(req);
    const { id } = parseParams(req, IdParamSchema);
    const existing = getAppraisalRow(id);
    tx(() => {
      // The link rows cascade; the files themselves stay in Files.
      const info = db.prepare(`DELETE FROM appraisal_items WHERE id = ?`).run(id);
      if (info.changes === 0) throw notFound("Appraisal item");
      recordDelete(
        req,
        {
          action: "delete",
          entityType: "appraisal_item",
          entityId: id,
          propertyId: existing.propertyId,
          summary: `removed "${existing.label}" from the appraisal checklist`,
        },
        { entityType: "appraisal_item", entityId: id },
      );
    });
    publishAfterCommit({
      action: "deleted",
      entityType: "appraisal_item",
      entityId: id,
      propertyId: existing.propertyId,
      version: 0,
      actorId: user.id,
    });
    return deleted(id);
  });

  /** Attach a file already filed under this property. Attaching twice is a no-op. */
  app.post("/api/appraisal-items/:id/uploads", { preHandler: [requireAuth] }, async (req, reply) => {
    const user = requireUser(req);
    const { id } = parseParams(req, IdParamSchema);
    const { uploadId } = parseBody(req, AttachSchema);
    const item = getAppraisalRow(id);
    const upload = getUploadRow(uploadId);
    if (!upload || upload.deletedAt) throw notFound("Upload");
    if (upload.propertyId !== item.propertyId) {
      throw conflict("That file belongs to a different property.");
    }

    const view = tx(() => {
      const info = db
        .prepare(
          `INSERT OR IGNORE INTO appraisal_item_uploads (item_id, upload_id, created_at, created_by)
           VALUES (?, ?, ?, ?)`,
        )
        .run(id, uploadId, nowIso(), user.id);
      if (info.changes > 0) {
        bumpVersion(id, user.id);
        recordMutation(req, {
          action: "update",
          entityType: "appraisal_item",
          entityId: id,
          propertyId: item.propertyId,
          summary: `attached "${upload.filename}" to "${item.label}"`,
          after: { uploadId },
        });
      }
      return toAppraisalView(getAppraisalRow(id));
    });
    publishUpdated(view, user.id);
    return reply.code(201).send(ok(view));
  });

  /** Detach only. The file stays filed under the property. */
  app.delete(
    "/api/appraisal-items/:id/uploads/:uploadId",
    { preHandler: [requireAuth] },
    async (req) => {
      const user = requireUser(req);
      const { id, uploadId } = parseParams(req, z.object({ id: zId, uploadId: zId }).strict());
      const item = getAppraisalRow(id);
      const view = tx(() => {
        const info = db
          .prepare(`DELETE FROM appraisal_item_uploads WHERE item_id = ? AND upload_id = ?`)
          .run(id, uploadId);
        if (info.changes === 0) throw notFound("Attachment");
        bumpVersion(id, user.id);
        recordMutation(req, {
          action: "update",
          entityType: "appraisal_item",
          entityId: id,
          propertyId: item.propertyId,
          summary: `detached a file from "${item.label}"`,
          after: { uploadId, detached: true },
        });
        return toAppraisalView(getAppraisalRow(id));
      });
      publishUpdated(view, user.id);
      return ok(view);
    },
  );

  /**
   * Put the open, estimated, unbudgeted defects on a project as budget lines.
   *
   * Which project: the one named in the body; otherwise the live project the
   * checklist already budgets into, so a second batch of defects joins the
   * first; otherwise a new one. A done or cancelled project is never reused —
   * new repairs reopening a finished job would muddle what that job cost.
   */
  app.post(
    "/api/properties/:propertyId/appraisal/budget",
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const user = requireUser(req);
      const { propertyId } = parseParams(req, z.object({ propertyId: zId }).strict());
      requirePropertyExists(propertyId);
      const body = parseBody(req, BudgetSchema) ?? {};
      checkProject(body.projectId, propertyId);

      const at = nowIso();
      const result = tx((): { project: ProjectView | null; linked: AppraisalItemView[]; created: boolean } => {
        const candidates = listAppraisal(propertyId).filter(isBudgetable);
        if (candidates.length === 0) return { project: null, linked: [], created: false };

        let projectId = body.projectId ?? null;
        if (!projectId) {
          const live = db
            .prepare(
              `SELECT p.id FROM projects p
                WHERE p.property_id = ?
                  AND p.status NOT IN ('done', 'cancelled')
                  AND p.id IN (SELECT project_id FROM appraisal_items
                                WHERE property_id = ? AND project_id IS NOT NULL)
                ORDER BY p.created_at DESC LIMIT 1`,
            )
            .get(propertyId, propertyId) as { id: string } | undefined;
          projectId = live?.id ?? null;
        }

        let created = false;
        if (!projectId) {
          projectId = newId("prj");
          created = true;
          db.prepare(
            `INSERT INTO projects (id, property_id, title, description, status, priority, owner_id,
               target_start, target_end, actual_start, actual_end, budget_cents, created_at,
               updated_at, created_by, updated_by, version)
             VALUES (?, ?, ?, ?, 'planning', 'normal', NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?, 1)`,
          ).run(
            projectId,
            propertyId,
            BUDGET_PROJECT_TITLE,
            "Defects, damage and deficiencies from the appraisal checklist, fixed before the appraiser visits.",
            at,
            at,
            user.id,
            user.id,
          );
          recordMutation(
            req,
            {
              action: "create",
              entityType: "project",
              entityId: projectId,
              propertyId,
              summary: `created project "${BUDGET_PROJECT_TITLE}" from the appraisal checklist`,
            },
            {
              entityType: "project",
              entityId: projectId,
              propertyId,
              title: BUDGET_PROJECT_TITLE,
              body: "Repairs from the appraisal checklist",
              url: `/p/${propertyId}/projects?project=${projectId}`,
              updatedAt: at,
            },
          );
        }

        const insertLine = db.prepare(
          `INSERT INTO project_lines (id, project_id, kind, label, category, amount_cents,
             incurred_on, vendor_id, note, created_at, updated_at, created_by, updated_by, version)
           VALUES (?, ?, 'budget', ?, 'repair', ?, NULL, NULL, ?, ?, ?, ?, ?, 1)`,
        );
        const link = db.prepare(
          `UPDATE appraisal_items SET project_id = ?, updated_at = ?, updated_by = ?,
             version = version + 1 WHERE id = ?`,
        );
        const linked: AppraisalItemView[] = [];
        for (const item of candidates) {
          const action = item.recommendedAction ? APPRAISAL_ACTION_LABELS[item.recommendedAction] : null;
          insertLine.run(
            newId("pln"),
            projectId,
            item.label,
            item.estimateCents,
            ["From the appraisal checklist", action].filter(Boolean).join(" · "),
            at,
            at,
            user.id,
            user.id,
          );
          link.run(projectId, at, user.id, item.id);
          linked.push(toAppraisalView(getAppraisalRow(item.id)));
        }

        const project = getProjectRow(projectId);
        const total = candidates.reduce((s, i) => s + (i.estimateCents ?? 0), 0);
        recordMutation(req, {
          action: "update",
          entityType: "project",
          entityId: projectId,
          propertyId,
          summary: `budgeted ${linked.length} appraisal ${
            linked.length === 1 ? "repair" : "repairs"
          } on "${project.title}"`,
          after: { items: linked.map((i) => i.id), totalCents: total },
        });
        return { project: toProjectView(project), linked, created };
      });

      if (result.project) {
        publishAfterCommit({
          action: result.created ? "created" : "updated",
          entityType: "project",
          entityId: result.project.id,
          propertyId,
          version: result.project.version,
          actorId: user.id,
          data: result.project,
        });
      }
      for (const item of result.linked) publishUpdated(item, user.id);
      return reply.code(result.linked.length > 0 ? 201 : 200).send(ok(result));
    },
  );

  /**
   * The binder: a summary in report order and every attached file.
   *
   * Audited as a download, because it is one — every document on the property
   * that anyone thought an appraiser should see, in a single file that can be
   * emailed on.
   */
  app.get(
    "/api/properties/:propertyId/appraisal/binder.zip",
    { preHandler: [requireAuth] },
    async (req: FastifyRequest, reply) => {
      const { propertyId } = parseParams(req, z.object({ propertyId: zId }).strict());
      const property = getPropertyRow(propertyId);
      const items = listAppraisal(propertyId);
      const { entries, summary } = buildBinder(property.name, propertyAddress(property), items);
      entries.unshift({ name: "00 Summary.txt", data: Buffer.from(summary, "utf8") });
      const zip = buildZip(entries);

      tx(() =>
        recordMutation(req, {
          action: "upload_downloaded",
          entityType: "property",
          entityId: propertyId,
          propertyId,
          summary: `downloaded the appraisal binder for "${property.name}" (${entries.length - 1} files)`,
        }),
      );

      const filename = `${safeName(property.name)} - appraisal binder.zip`;
      reply.header("Content-Type", "application/zip");
      reply.header(
        "Content-Disposition",
        `attachment; filename="binder.zip"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      );
      reply.header("X-Content-Type-Options", "nosniff");
      return reply.send(zip);
    },
  );
}

function propertyAddress(p: { addressLine1: string; addressLine2: string | null; city: string; state: string; postalCode: string }): string {
  return [p.addressLine1, p.addressLine2, `${p.city}, ${p.state} ${p.postalCode}`].filter(Boolean).join(", ");
}

/** Strip what Windows, macOS and zip tools refuse in a path segment. */
export function safeName(s: string): string {
  // eslint-disable-next-line no-control-regex -- control characters are exactly what must go.
  const cleaned = s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/\s+/g, " ").trim();
  return (cleaned || "untitled").slice(0, 80);
}

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/** Pure, so the summary and the folder layout are testable without a server. */
export function buildBinder(
  propertyName: string,
  address: string,
  items: readonly AppraisalItemView[],
  readFile: (storedPath: string) => Buffer | null = defaultRead,
): { entries: ZipEntry[]; summary: string } {
  const entries: ZipEntry[] = [];
  const used = new Set<string>();
  const totals = summarizeAppraisal(items);
  const lines: string[] = [
    `Appraisal binder — ${propertyName}`,
    address,
    `Prepared ${new Date().toISOString().slice(0, 10)} from Keyring.`,
    "",
    "Laid out in the order of the redesigned URAR (UAD 3.6). This is the owner's",
    "information for the appraiser; ratings and conclusions are the appraiser's.",
    "",
    `${totals.ready} of ${totals.total} items ready · ${totals.openDefects} open ${
      totals.openDefects === 1 ? "defect" : "defects"
    }${totals.costToCureCents > 0 ? ` · ${money(totals.costToCureCents)} estimated to cure` : ""}`,
  ];

  APPRAISAL_SECTION_ORDER.forEach((section, index) => {
    const inSection = items.filter((i) => i.section === section && i.status !== "not_applicable");
    if (inSection.length === 0) return;
    const folder = `${String(index + 1).padStart(2, "0")} ${safeName(APPRAISAL_SECTION_LABELS[section])}`;
    lines.push("", "", APPRAISAL_SECTION_LABELS[section].toUpperCase(), "-".repeat(60));

    for (const item of inSection) {
      lines.push("", `* ${item.label}  [${appraisalStatusLabel(item.status, item.kind)} · ${APPRAISAL_KIND_LABELS[item.kind]}]`);
      if (item.finding) lines.push(`  ${item.finding.replace(/\n+/g, "\n  ")}`);
      if (item.asOf) lines.push(`  As of ${item.asOf}`);
      if (item.kind === "defect") {
        const parts = [
          item.recommendedAction ? `Recommended action: ${APPRAISAL_ACTION_LABELS[item.recommendedAction]}` : null,
          item.estimateCents !== null ? `Estimate: ${money(item.estimateCents)}` : null,
          item.project ? `Budgeted on: ${item.project.title}` : null,
        ].filter(Boolean);
        if (parts.length) lines.push(`  ${parts.join(" · ")}`);
      }
      for (const doc of item.documents) {
        const row = getUploadRowSafe(doc.id);
        const data = row ? readFile(row.storedPath) : null;
        let path = `${folder}/${safeName(item.label)} - ${safeName(doc.filename)}`;
        for (let n = 2; used.has(path); n++) {
          path = `${folder}/${safeName(item.label)} - ${n} - ${safeName(doc.filename)}`;
        }
        if (!data) {
          lines.push(`  File: ${doc.filename} (missing from storage — not included)`);
          continue;
        }
        used.add(path);
        entries.push({ name: path, data, modified: new Date(doc.createdAt) });
        lines.push(`  File: ${path}`);
      }
    }
  });

  return { entries, summary: lines.join("\n") + "\n" };
}

function getUploadRowSafe(id: string) {
  try {
    return getUploadRow(id);
  } catch {
    return null;
  }
}

function defaultRead(storedPath: string): Buffer | null {
  const abs = absPathFromRel(storedPath);
  return existsSync(abs) ? readFileSync(abs) : null;
}

interface InsertArgs {
  id: string;
  property_id: string;
  label: string;
  section: string;
  kind: string;
  status: string;
  detail: string | null;
  finding: string | null;
  as_of: string | null;
  recommended_action: string | null;
  estimate_cents: number | null;
  project_id: string | null;
  sort_order: number;
  at: string;
  actor: string;
}

function insertItem(a: InsertArgs): void {
  getDb()
    .prepare(
      `INSERT INTO appraisal_items (id, property_id, label, section, kind, status, detail, finding,
         as_of, recommended_action, estimate_cents, project_id, sort_order, created_at, updated_at,
         created_by, updated_by, version)
       VALUES (@id,@property_id,@label,@section,@kind,@status,@detail,@finding,@as_of,
         @recommended_action,@estimate_cents,@project_id,@sort_order,@at,@at,@actor,@actor,1)`,
    )
    .run(a as unknown as Record<string, unknown>);
}
