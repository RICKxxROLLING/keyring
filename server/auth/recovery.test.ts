import { afterEach, describe, expect, it } from "vitest";
import { createTestApp, createTestUser, type TestApp } from "../testing/harness.js";
import { clearUnusedRecoveryCodes, consumeRecoveryCode, issueRecoveryCodes } from "./recovery.js";

describe("recovery codes", () => {
  let ctx: TestApp;

  afterEach(async () => {
    if (ctx) await ctx.close();
  });

  it("issues 10 unique single-use codes", async () => {
    ctx = await createTestApp();
    const user = createTestUser();
    const { codes, generatedAt } = issueRecoveryCodes(user.id);
    expect(codes.length).toBe(10);
    expect(new Set(codes).size).toBe(10);
    expect(generatedAt).toBeTruthy();
    for (const code of codes) expect(code).toMatch(/^[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}$/);
  });

  it("consumes a code exactly once", async () => {
    ctx = await createTestApp();
    const user = createTestUser();
    const { codes } = issueRecoveryCodes(user.id);
    expect(consumeRecoveryCode(user.id, codes[0]!)).toBe(true);
    expect(consumeRecoveryCode(user.id, codes[0]!)).toBe(false);
  });

  it("is case- and whitespace-insensitive on consumption", async () => {
    ctx = await createTestApp();
    const user = createTestUser();
    const { codes } = issueRecoveryCodes(user.id);
    const messy = `  ${codes[1]!.toLowerCase()}  `;
    expect(consumeRecoveryCode(user.id, messy)).toBe(true);
  });

  it("rejects a code belonging to a different user", async () => {
    ctx = await createTestApp();
    const userA = createTestUser();
    const userB = createTestUser();
    const { codes } = issueRecoveryCodes(userA.id);
    expect(consumeRecoveryCode(userB.id, codes[0]!)).toBe(false);
  });

  it("clearUnusedRecoveryCodes removes only the still-unused codes", async () => {
    ctx = await createTestApp();
    const user = createTestUser();
    const { codes } = issueRecoveryCodes(user.id);
    expect(consumeRecoveryCode(user.id, codes[0]!)).toBe(true);
    clearUnusedRecoveryCodes(user.id);
    expect(consumeRecoveryCode(user.id, codes[1]!)).toBe(false);
  });
});
