// server/domain/workorders/pm.ts — recurring preventive-maintenance templates and generation.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb, tx } from "../../db/index.js";
import { requireAuth, requireUser } from "../../auth/middleware.js";
import {
  parseBody,
  parseParams,
  zId,
  zOptText,
  zText,
  zIsoDate,
  zVersion,
  IdParamSchema,
} from "../../lib/validate.js";
import { ok, deleted, notFound } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import { nowIso, todayLocal, addDays, addMonths } from "../../lib/time.js";
import { getEnv } from "../../config/env.js";
import { onePage } from "../../lib/paging.js";
import { snakeKeys } from "../../lib/rowmap.js";
import { mapRow } from "../common/rowmap.js";
import { requirePropertyExists } from "../common/access.js";
import {
  patchWithVersionGuard,
  assertVersionMatch,
  recordMutation,
  recordDelete,
  publishAfterCommit,
} from "../common/crud.js";
import { getWorkOrderRow, toWorkOrderView, nextWorkOrderNumber } from "./repo.js";
import { registerJob } from "../../lib/scheduler.js";
import { writeAudit } from "../../audit/audit.js";
import { indexEntity } from "../../search/index-entity.js";
import type { AppContext } from "../../context.js";
import type { PmFrequency, PmTemplate, WorkOrderView } from "../../../shared/types.js";

const FrequencyEnum = z.enum(["monthly", "quarterly", "semiannual", "annual", "custom_days"]);
const PriorityEnum = z.enum(["low", "normal", "high", "urgent"]);

const CreatePmSchema = z
  .object({
    unitId: zId.nullable().optional(),
    title: zText(200),
    description: zOptText(20000),
    priority: PriorityEnum.default("normal"),
    assigneeId: zId.nullable().optional(),
    vendorId: zId.nullable().optional(),
    frequency: FrequencyEnum,
    intervalDays: z.number().int().positive().nullable().optional(),
    anchorDate: zIsoDate,
    leadDays: z.number().int().nonnegative().default(7),
    active: z.boolean().default(true),
  })
  .strict()
  .refine((v) => v.frequency !== "custom_days" || (v.intervalDays ?? 0) > 0, {
    message: "intervalDays is required when frequency is custom_days",
    path: ["intervalDays"],
  });

const PatchPmSchema = z
  .object({
    unitId: zId.nullable().optional(),
    title: zText(200).optional(),
    description: zOptText(20000),
    priority: PriorityEnum.optional(),
    assigneeId: zId.nullable().optional(),
    vendorId: zId.nullable().optional(),
    frequency: FrequencyEnum.optional(),
    intervalDays: z.number().int().positive().nullable().optional(),
    anchorDate: zIsoDate.optional(),
    leadDays: z.number().int().nonnegative().optional(),
    nextDueDate: zIsoDate.optional(),
    lastGeneratedDate: zIsoDate.nullable().optional(),
    active: z.boolean().optional(),
    expectedVersion: zVersion,
  })
  .strict();

function getPmRow(id: string): PmTemplate {
  const row = getDb().prepare(`SELECT * FROM pm_templates WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw notFound("PM template");
  return mapRow<PmTemplate>(row);
}

export function advanceDueDate(date: string, frequency: PmFrequency, intervalDays: number | null): string {
  switch (frequency) {
    case "monthly":
      return addMonths(date, 1);
    case "quarterly":
      return addMonths(date, 3);
    case "semiannual":
      return addMonths(date, 6);
    case "annual":
      return addMonths(date, 12);
    case "custom_days":
      return addDays(date, intervalDays ?? 1);
  }
}

/** Generates a work order for one PM template if it is due; advances the schedule. Idempotent
 * per (pm_template_id, due_date) via the ux_wo_pm_cycle unique index. */
function generateForTemplate(
  template: PmTemplate,
  actorId: string,
): { workOrder: WorkOrderView | null; skipped: boolean } {
  const db = getDb();
  const today = todayLocal(getEnv().APP_TIMEZONE);
  if (!template.active) return { workOrder: null, skipped: true };
  const daysOut = Math.round(
    (Date.parse(`${template.nextDueDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
  if (daysOut > template.leadDays) return { workOrder: null, skipped: true };

  const dueDate = template.nextDueDate;
  const already = db
    .prepare(`SELECT id FROM work_orders WHERE pm_template_id = ? AND due_date = ?`)
    .get(template.id, dueDate);
  const nextDue = advanceDueDate(template.nextDueDate, template.frequency, template.intervalDays);

  if (already) {
    // A work order for this cycle already exists (e.g. re-run). Still advance if we somehow
    // haven't yet, but do not create a duplicate work order.
    db.prepare(`UPDATE pm_templates SET next_due_date = ?, last_generated_date = ?, updated_at = ? WHERE id = ?`).run(
      nextDue,
      today,
      nowIso(),
      template.id,
    );
    return { workOrder: null, skipped: true };
  }

  const id = newId("wo");
  const at = nowIso();
  const number = nextWorkOrderNumber(template.propertyId);
  db.prepare(
    `INSERT INTO work_orders (id, property_id, unit_id, number, title, description, status,
       priority, assignee_id, vendor_id, due_date, scheduled_for, completed_at, estimate_cents,
       cost_cents, source, pm_template_id, created_at, updated_at, created_by, updated_by, version)
     VALUES (?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, NULL, NULL, NULL, NULL, 'pm', ?, ?, ?, ?, ?, 1)`,
  ).run(
    id,
    template.propertyId,
    template.unitId,
    number,
    template.title,
    template.description,
    template.priority,
    template.assigneeId,
    template.vendorId,
    dueDate,
    template.id,
    at,
    at,
    actorId,
    actorId,
  );
  db.prepare(
    `UPDATE pm_templates SET next_due_date = ?, last_generated_date = ?, updated_at = ? WHERE id = ?`,
  ).run(nextDue, today, at, template.id);

  const wo = getWorkOrderRow(id);
  writeAudit({
    actorUserId: actorId,
    actorLabel: "system",
    action: "create",
    entityType: "work_order",
    entityId: id,
    propertyId: template.propertyId,
    summary: `generated work order "${wo.title}" (WO-${wo.number}) from PM template`,
    after: { source: "pm", pmTemplateId: template.id },
  });
  indexEntity({
    entityType: "work_order",
    entityId: id,
    propertyId: template.propertyId,
    title: `WO-${wo.number} ${wo.title}`,
    body: wo.description ?? "",
    url: `/p/${template.propertyId}/maintenance?wo=${id}`,
    updatedAt: at,
  });
  return { workOrder: toWorkOrderView(wo), skipped: false };
}

/** The `pm-generate` job: runs for every active template. Never throws. */
export function runPmGenerate(actorId: string | null): void {
  const db = getDb();
  const templates = camelRowsPm(db.prepare(`SELECT * FROM pm_templates WHERE active = 1`).all());
  for (const t of templates) {
    tx(() => {
      generateForTemplate(t, actorId ?? t.createdBy);
    });
  }
}

function camelRowsPm(rows: unknown[]): PmTemplate[] {
  return (rows as Record<string, unknown>[]).map((r) => mapRow<PmTemplate>(r));
}

export function registerPmRoutes(app: FastifyInstance, ctx: AppContext): void {
  const db = getDb();

  registerJob({
    name: "pm-generate",
    dailyAt: "02:00",
    runOnStart: true,
    fn: () => runPmGenerate(null),
  });

  app.get("/api/properties/:propertyId/pm-templates", { preHandler: [requireAuth] }, async (req) => {
    const { propertyId } = parseParams(req, z.object({ propertyId: zId }).strict());
    requirePropertyExists(propertyId);
    const rows = db
      .prepare(`SELECT * FROM pm_templates WHERE property_id = ? ORDER BY next_due_date`)
      .all(propertyId) as Record<string, unknown>[];
    return ok(onePage(rows.map((r) => mapRow<PmTemplate>(r))));
  });

  app.post(
    "/api/properties/:propertyId/pm-templates",
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const user = requireUser(req);
      const { propertyId } = parseParams(req, z.object({ propertyId: zId }).strict());
      requirePropertyExists(propertyId);
      const body = parseBody(req, CreatePmSchema);
      const id = newId("pmt");
      const at = nowIso();
      const template = tx(() => {
        const snake = snakeKeys(body);
        db.prepare(
          `INSERT INTO pm_templates (id, property_id, unit_id, title, description, priority,
             assignee_id, vendor_id, frequency, interval_days, anchor_date, lead_days,
             next_due_date, last_generated_date, active, created_at, updated_at, created_by,
             updated_by, version)
           VALUES (@id,@property_id,@unit_id,@title,@description,@priority,@assignee_id,
             @vendor_id,@frequency,@interval_days,@anchor_date,@lead_days,@next_due_date,NULL,
             @active,@created_at,@updated_at,@created_by,@updated_by,1)`,
        ).run({
          id,
          property_id: propertyId,
          unit_id: snake.unit_id ?? null,
          title: snake.title,
          description: snake.description ?? null,
          priority: snake.priority ?? "normal",
          assignee_id: snake.assignee_id ?? null,
          vendor_id: snake.vendor_id ?? null,
          frequency: snake.frequency,
          interval_days: snake.interval_days ?? null,
          anchor_date: snake.anchor_date,
          lead_days: snake.lead_days ?? 7,
          next_due_date: snake.anchor_date,
          active: snake.active === false ? 0 : 1,
          created_at: at,
          updated_at: at,
          created_by: user.id,
          updated_by: user.id,
        });
        const row = getPmRow(id);
        recordMutation(req, {
          action: "create",
          entityType: "pm_template",
          entityId: id,
          propertyId,
          summary: `created PM template "${row.title}"`,
          after: body as Record<string, unknown>,
        });
        return row;
      });
      publishAfterCommit({
        action: "created",
        entityType: "pm_template",
        entityId: id,
        propertyId,
        version: 1,
        actorId: user.id,
        data: template,
      });
      return reply.code(201).send(ok(template));
    },
  );

  app.patch("/api/pm-templates/:id", { preHandler: [requireAuth] }, async (req) => {
    const user = requireUser(req);
    const { id } = parseParams(req, IdParamSchema);
    const body = parseBody(req, PatchPmSchema);
    const { expectedVersion, ...patch } = body;
    const existing = getPmRow(id);
    const result = tx(() => {
      const changes = patchWithVersionGuard({
        table: "pm_templates",
        id,
        patch,
        expectedVersion,
        actorId: user.id,
      });
      assertVersionMatch({ table: "pm_templates", id, changes, what: "PM template", currentView: () => getPmRow(id) });
      const row = getPmRow(id);
      recordMutation(req, {
        action: "update",
        entityType: "pm_template",
        entityId: id,
        propertyId: row.propertyId,
        summary: `updated PM template "${row.title}"`,
        after: patch as Record<string, unknown>,
      });
      return row;
    });
    publishAfterCommit({
      action: "updated",
      entityType: "pm_template",
      entityId: id,
      propertyId: existing.propertyId,
      version: result.version,
      actorId: user.id,
      data: result,
    });
    return ok(result);
  });

  app.delete("/api/pm-templates/:id", { preHandler: [requireAuth] }, async (req) => {
    const user = requireUser(req);
    const { id } = parseParams(req, IdParamSchema);
    const existing = getPmRow(id);
    tx(() => {
      const info = db.prepare(`DELETE FROM pm_templates WHERE id = ?`).run(id);
      if (info.changes === 0) throw notFound("PM template");
      recordDelete(req, {
        action: "delete",
        entityType: "pm_template",
        entityId: id,
        propertyId: existing.propertyId,
        summary: `deleted PM template "${existing.title}"`,
      });
    });
    publishAfterCommit({
      action: "deleted",
      entityType: "pm_template",
      entityId: id,
      propertyId: existing.propertyId,
      version: 0,
      actorId: user.id,
    });
    return deleted(id);
  });

  app.post("/api/pm-templates/:id/generate", { preHandler: [requireAuth] }, async (req) => {
    const user = requireUser(req);
    const { id } = parseParams(req, IdParamSchema);
    const template = getPmRow(id);
    const result = tx(() => generateForTemplate(template, user.id));
    if (result.workOrder) {
      publishAfterCommit({
        action: "created",
        entityType: "work_order",
        entityId: result.workOrder.id,
        propertyId: template.propertyId,
        version: 1,
        actorId: user.id,
        data: result.workOrder,
      });
    }
    return ok(result);
  });

  void ctx;
}
