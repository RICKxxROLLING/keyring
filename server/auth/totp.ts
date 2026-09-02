import { Secret, TOTP } from "otpauth";

const ISSUER = "Keyring";

export function generateTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

function totpFor(secretBase32: string, label: string): TOTP {
  return new TOTP({
    issuer: ISSUER,
    label,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secretBase32),
  });
}

/**
 * The `otpauth://` URL an authenticator scans.
 *
 * Built by hand rather than via TOTP#toString() to leave out algorithm, digits
 * and period. Those are exactly the defaults in the Key Uri Format spec, and
 * exactly what totpFor() configures, so stating them changes nothing for any
 * authenticator — while costing 34 bytes.
 *
 * Those 34 bytes matter. The full form is 134 bytes for a 20-character address,
 * which is precisely the QR encoder's ceiling, so any longer email tipped over
 * it and lost the QR entirely. Dropping the redundant parameters leaves room
 * for an address of about 56 characters, and makes the code less dense and
 * easier to scan at every length.
 */
export function totpEnrollmentUri(secretBase32: string, email: string): string {
  const label = `${encodeURIComponent(ISSUER)}:${encodeURIComponent(email)}`;
  return `otpauth://totp/${label}?issuer=${encodeURIComponent(ISSUER)}&secret=${secretBase32}`;
}

/** ±1 step (±30s) window to absorb host clock drift, per §Risks. */
export function verifyTotpCode(secretBase32: string, code: string, email = "user"): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const delta = totpFor(secretBase32, email).validate({ token: code, window: 1 });
  return delta !== null;
}
