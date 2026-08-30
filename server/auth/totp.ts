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

export function totpEnrollmentUri(secretBase32: string, email: string): string {
  return totpFor(secretBase32, email).toString();
}

/** ±1 step (±30s) window to absorb host clock drift, per §Risks. */
export function verifyTotpCode(secretBase32: string, code: string, email = "user"): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const delta = totpFor(secretBase32, email).validate({ token: code, window: 1 });
  return delta !== null;
}
