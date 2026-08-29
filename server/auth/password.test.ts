import { describe, expect, it } from "vitest";
import { hashPassword, passwordPolicyError, verifyPassword } from "./password.js";

describe("password hashing", () => {
  it("uses argon2id with memoryCost >= 19456 KiB and timeCost >= 2", async () => {
    const hash = await hashPassword("correct horse battery staple 42");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    const params = /\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(hash);
    expect(params).not.toBeNull();
    expect(Number(params![1])).toBeGreaterThanOrEqual(19_456);
    expect(Number(params![2])).toBeGreaterThanOrEqual(2);
  });

  it("verifies a correct password and rejects an incorrect one", async () => {
    const hash = await hashPassword("correct horse battery staple 42");
    expect(await verifyPassword(hash, "correct horse battery staple 42")).toBe(true);
    expect(await verifyPassword(hash, "totally the wrong password")).toBe(false);
  });

  it("never stores anything resembling plaintext", async () => {
    const password = "correct horse battery staple 42";
    const hash = await hashPassword(password);
    expect(hash).not.toContain(password);
  });

  it("enforces a minimum length policy", () => {
    expect(passwordPolicyError("short")).not.toBeNull();
    expect(passwordPolicyError("a".repeat(12))).toBeNull();
  });
});
