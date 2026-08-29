import { newToken } from "../lib/ids.js";

/**
 * Double-submit CSRF token paired with the `stoop_session` cookie at login time.
 * Verification against the incoming `X-CSRF-Token` header happens in
 * `server/auth/middleware.ts` (`requireAuth`) — this module only mints tokens.
 */
export function newCsrfToken(): string {
  return newToken(16);
}
