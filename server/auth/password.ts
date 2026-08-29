import { hash, verify } from "@node-rs/argon2";

/**
 * `@node-rs/argon2`'s `Algorithm` is a `declare const enum`, which `verbatimModuleSyntax`
 * (frozen in tsconfig.base.json) refuses to import across a compiled module boundary
 * (TS2748). `2` is `Algorithm.Argon2id` — see node_modules/@node-rs/argon2/index.d.ts.
 * memoryCost is in KiB. 19456 KiB (~19 MiB) / timeCost 2 is the OWASP argon2id baseline.
 */
const HASH_OPTIONS = {
  algorithm: 2 as const,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(password: string): Promise<string> {
  return hash(password, HASH_OPTIONS);
}

/** The PHC hash string embeds its own algorithm/cost params, so verify needs no options. */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** Minimal strength gate. Returns an error message, or null when acceptable. */
export function passwordPolicyError(password: string): string | null {
  if (password.length < 12) return "Password must be at least 12 characters.";
  if (password.length > 200) return "Password must be at most 200 characters.";
  return null;
}
