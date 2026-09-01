// web/lib/api.ts — typed fetch client (owner T4). See design §C10.3.
import type { ApiErrorBody, ApiResponse, ErrorCode, FieldError, Upload } from "../../shared/types";

export class ApiClientError extends Error {
  code: ErrorCode;
  status: number;
  fields?: FieldError[];
  current?: unknown;
  retryAfter?: number;

  constructor(body: ApiErrorBody, status: number) {
    super(body.message);
    this.name = "ApiClientError";
    this.code = body.code;
    this.status = status;
    this.fields = body.fields;
    this.current = body.current;
    this.retryAfter = body.retryAfter;
  }
}

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1] ?? "") : null;
}

/** Set by the session context so a 401 can redirect without a circular import. */
let onUnauthenticated: (() => void) | null = null;
export function setUnauthenticatedHandler(fn: (() => void) | null): void {
  onUnauthenticated = fn;
}

async function unwrap<T>(res: Response): Promise<T> {
  let body: ApiResponse<T> | undefined;
  try {
    body = (await res.json()) as ApiResponse<T>;
  } catch {
    throw new ApiClientError(
      { code: "INTERNAL", message: "Internal error.", requestId: "req_unknown" },
      res.status,
    );
  }
  if (body.ok) return body.data;
  if (body.error.code === "UNAUTHENTICATED") onUnauthenticated?.();
  throw new ApiClientError(body.error, res.status);
}

function request(path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  const method = (init.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    const csrf = readCookie("keyring_csrf");
    if (csrf) headers.set("X-CSRF-Token", csrf);
  }
  return fetch(path, { ...init, headers, credentials: "same-origin" });
}

export async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await request(path, { ...init, method: "GET" });
  return unwrap<T>(res);
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await request(path, {
    method: "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return unwrap<T>(res);
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await request(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return unwrap<T>(res);
}

/** For a resource sent whole rather than field by field — see the deal analysis. */
export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const res = await request(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return unwrap<T>(res);
}

export async function apiDelete<T>(path: string): Promise<T> {
  const res = await request(path, { method: "DELETE" });
  return unwrap<T>(res);
}

export async function apiUpload(path: string, form: FormData): Promise<Upload> {
  const res = await request(path, { method: "POST", body: form });
  return unwrap<Upload>(res);
}
