import type { FastifyInstance, FastifyReply } from "fastify";
import type { ApiErrorBody, ApiOk, ErrorCode, FieldError } from "../../shared/types.js";

export const STATUS_BY_CODE: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_FAILED: 422,
  UNAUTHENTICATED: 401,
  MFA_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  VERSION_CONFLICT: 409,
  RATE_LIMITED: 429,
  LOCKED_OUT: 423,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  SETUP_REQUIRED: 409,
  SETUP_ALREADY_DONE: 409,
  INTERNAL: 500,
};

export interface ApiErrorExtra {
  fields?: FieldError[];
  current?: unknown;
  retryAfter?: number;
}

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly extra: ApiErrorExtra;
  constructor(code: ErrorCode, message: string, extra: ApiErrorExtra = {}) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.extra = extra;
  }
  get status(): number {
    return STATUS_BY_CODE[this.code];
  }
}

export const notFound = (what = "Resource"): ApiError => new ApiError("NOT_FOUND", `${what} not found.`);
export const forbidden = (msg = "Not permitted."): ApiError => new ApiError("FORBIDDEN", msg);
export const unauthenticated = (msg = "Sign in required."): ApiError =>
  new ApiError("UNAUTHENTICATED", msg);
export const conflict = (msg: string): ApiError => new ApiError("CONFLICT", msg);
export const versionConflict = (msg: string, current: unknown): ApiError =>
  new ApiError("VERSION_CONFLICT", msg, { current });

export function ok<T>(data: T): ApiOk<T> {
  return { ok: true, data };
}

export function deleted(id: string): ApiOk<{ id: string; deleted: true }> {
  return { ok: true, data: { id, deleted: true } };
}

export function errorBody(err: ApiError, requestId: string): { ok: false; error: ApiErrorBody } {
  const body: ApiErrorBody = { code: err.code, message: err.message, requestId };
  if (err.extra.fields) body.fields = err.extra.fields;
  if (err.extra.current !== undefined) body.current = err.extra.current;
  if (err.extra.retryAfter !== undefined) body.retryAfter = err.extra.retryAfter;
  return { ok: false, error: body };
}

export function sendError(reply: FastifyReply, err: ApiError, requestId: string): FastifyReply {
  if (err.extra.retryAfter !== undefined) reply.header("Retry-After", String(err.extra.retryAfter));
  return reply.code(err.status).send(errorBody(err, requestId));
}

export function installErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, req, reply) => {
    const requestId = String(req.id);
    if (err instanceof ApiError) {
      if (err.status >= 500) req.log.error({ err, requestId }, err.message);
      else req.log.info({ code: err.code, requestId }, err.message);
      return sendError(reply, err, requestId);
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status === 429) {
      return sendError(reply, new ApiError("RATE_LIMITED", "Too many requests.", { retryAfter: 60 }), requestId);
    }
    if (status === 413) {
      return sendError(reply, new ApiError("PAYLOAD_TOO_LARGE", "File is too large."), requestId);
    }
    if (status >= 400 && status < 500) {
      return sendError(reply, new ApiError("BAD_REQUEST", "Malformed request."), requestId);
    }
    req.log.error({ err, requestId }, "unhandled error");
    return sendError(reply, new ApiError("INTERNAL", "Internal error."), requestId);
  });
}
