// server/auth/totp.test.ts — the enrollment URL, and that it stays scannable.
//
// The QR encoder tops out at 134 bytes. The URL used to be exactly 134 bytes
// for a 20-character email address, so any longer address lost the QR without
// anything reporting a problem. These pin the size down so that cannot creep
// back, and check the URL still says everything an authenticator needs.
import { describe, expect, it } from "vitest";
import { generateTotpSecret, totpEnrollmentUri, verifyTotpCode } from "./totp.js";
import { TOTP, Secret } from "otpauth";

/** The encoder's byte-mode ceiling — see web/lib/qrcode.ts. */
const QR_CAPACITY = 134;

const SECRET = generateTotpSecret();

describe("totpEnrollmentUri", () => {
  it("carries what an authenticator needs and nothing it doesn't", () => {
    const uri = totpEnrollmentUri(SECRET, "riley@example.com");
    const url = new URL(uri);

    expect(url.protocol).toBe("otpauth:");
    expect(uri.startsWith("otpauth://totp/")).toBe(true);
    expect(url.searchParams.get("secret")).toBe(SECRET);
    expect(url.searchParams.get("issuer")).toBe("Keyring");
    // Label carries the issuer prefix too, which is what most apps display.
    expect(decodeURIComponent(uri.split("?")[0]!)).toContain("Keyring:riley@example.com");

    // Omitted on purpose: these are the spec defaults and cost 34 bytes.
    expect(url.searchParams.get("algorithm")).toBeNull();
    expect(url.searchParams.get("digits")).toBeNull();
    expect(url.searchParams.get("period")).toBeNull();
  });

  it("fits the QR encoder for a realistically long address", () => {
    // 50 characters — longer than any address likely to sign in here.
    const uri = totpEnrollmentUri(SECRET, "firstname.lastname+tag@a-long-domain.example.com");
    expect(Buffer.byteLength(uri, "utf8")).toBeLessThanOrEqual(QR_CAPACITY);
  });

  it("still fits once an address is percent-encoded", () => {
    // Every "@" becomes "%40" — three bytes for one character. Measuring the
    // raw address rather than the encoded URL is how this would be missed.
    const uri = totpEnrollmentUri(SECRET, "a.name+with+plenty+of+tags@example.co.uk");
    expect(Buffer.byteLength(uri, "utf8")).toBeLessThanOrEqual(QR_CAPACITY);
  });

  it("describes the same credential the verifier accepts", () => {
    // The URL is only useful if an authenticator built from it produces codes
    // this server accepts. Round-tripped through the library a real app uses.
    const url = new URL(totpEnrollmentUri(SECRET, "riley@example.com"));
    const fromUri = new TOTP({
      issuer: url.searchParams.get("issuer")!,
      label: "riley@example.com",
      secret: Secret.fromBase32(url.searchParams.get("secret")!),
      // Left unset on purpose: the defaults have to be the right ones.
    });
    expect(verifyTotpCode(SECRET, fromUri.generate(), "riley@example.com")).toBe(true);
  });

  it("rejects a code from a different secret", () => {
    const other = new TOTP({ secret: Secret.fromBase32(generateTotpSecret()) });
    expect(verifyTotpCode(SECRET, other.generate(), "riley@example.com")).toBe(false);
  });
});
