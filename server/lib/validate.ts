import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { ApiError } from "./errors.js";
import type { FieldError } from "../../shared/types.js";

function toFieldErrors(err: z.ZodError): FieldError[] {
  return err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

function parse<T>(schema: z.ZodType<T>, value: unknown, where: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ApiError("VALIDATION_FAILED", `Invalid ${where}.`, {
      fields: toFieldErrors(result.error),
    });
  }
  return result.data;
}

export function parseBody<T>(req: FastifyRequest, schema: z.ZodType<T>): T {
  return parse(schema, req.body, "request body");
}
export function parseQuery<T>(req: FastifyRequest, schema: z.ZodType<T>): T {
  return parse(schema, req.query, "query string");
}
export function parseParams<T>(req: FastifyRequest, schema: z.ZodType<T>): T {
  return parse(schema, req.params, "path parameters");
}

/* Shared primitives — use these rather than redeclaring. */
export const zId = z.string().regex(/^[a-z]{2,4}_[0-9A-HJKMNP-TV-Z]{26}$/, "not an id");
export const zIsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
export const zIsoDateTime = z.string().datetime();
export const zPeriod = z.string().regex(/^\d{4}-\d{2}$/, "expected YYYY-MM");
export const zCents = z.number().int();
export const zVersion = z.number().int().nonnegative();
export const zText = (max: number) => z.string().trim().max(max);
export const zOptText = (max: number) => z.string().trim().max(max).nullable().optional();

export const IdParamSchema = z.object({ id: zId }).strict();
export const PropertyParamSchema = z.object({ propertyId: zId }).strict();
export const PagingQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.string().max(200).optional(),
  })
  .strict();

/** Every PATCH body must extend this. */
export const PatchBase = z.object({ expectedVersion: zVersion });
