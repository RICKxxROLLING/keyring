import { describe, expect, it } from "vitest";
import { generateTotpSecret, totpEnrollmentUri, verifyTotpCode } from "./totp.js";
import { totpCodeFor } from "./test-support.js";

describe("totp", () => {
  it("accepts a code generated from the same secret", () => {
    const secret = generateTotpSecret();
    const code = totpCodeFor(secret, "a@b.com");
    expect(verifyTotpCode(secret, code, "a@b.com")).toBe(true);
  });

  it("rejects a code generated from a different secret", () => {
    const secret = generateTotpSecret();
    const other = generateTotpSecret();
    const code = totpCodeFor(other, "a@b.com");
    expect(verifyTotpCode(secret, code, "a@b.com")).toBe(false);
  });

  it("rejects malformed codes", () => {
    const secret = generateTotpSecret();
    expect(verifyTotpCode(secret, "abc", "a@b.com")).toBe(false);
    expect(verifyTotpCode(secret, "", "a@b.com")).toBe(false);
  });

  it("produces a well-formed otpauth:// enrollment URI", () => {
    const secret = generateTotpSecret();
    const uri = totpEnrollmentUri(secret, "a@b.com");
    expect(uri.startsWith("otpauth://totp/")).toBe(true);
    expect(uri).toContain("issuer=Stoop");
  });
});
