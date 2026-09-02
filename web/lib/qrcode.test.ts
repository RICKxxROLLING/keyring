// web/lib/qrcode.test.ts — the encoder, proved by decoding what it produces.
//
// A hand-rolled QR encoder has a nasty failure mode: it emits something that
// LOOKS like a QR code, renders happily, and simply will not scan. Eyeballing
// the SVG proves nothing.
//
// So these decode the output with jsQR — a real scanner — and assert the text
// comes back exactly. That, not resemblance to another encoder's output, is the
// property that matters: an equally valid code may pick a different mask or a
// different segmentation and look nothing like ours while scanning fine.
//
// The bug that prompted this: the encoder stopped at version 4, or 78 bytes, on
// the stated grounds that this "comfortably covers an otpauth:// URL". A real
// enrollment URL is 100-140 bytes, so the QR never rendered for anyone and
// every 2FA enrollment fell back to typing the secret in by hand.
import { describe, expect, it } from "vitest";
import jsQR from "jsqr";
import { encodeQrSvg } from "./qrcode";

/** The encoder's defaults; its SVG geometry is expressed in these units. */
const MODULE = 5;
const MARGIN = 4;

/**
 * Decode our own SVG back to text, the way a phone camera would.
 *
 * The dark modules are a single `<path>` of `M x,y h5 v5 h-5 z` sub-paths — the
 * only `<rect>` in the document is the white background — so the grid is
 * recovered from the path, rendered to RGBA, and handed to a scanner.
 */
function decodeSvg(svg: string): string | null {
  const px = Number(/viewBox="0 0 (\d+)/.exec(svg)?.[1]);
  const size = px / MODULE - MARGIN * 2;
  const grid = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  for (const m of svg.matchAll(/M(\d+),(\d+)h/g)) {
    grid[Number(m[2]) / MODULE - MARGIN]![Number(m[1]) / MODULE - MARGIN] = true;
  }

  // Scaled up with a quiet zone, because a scanner needs both to lock on.
  const scale = 4;
  const quiet = 4;
  const dim = (size + quiet * 2) * scale;
  const data = new Uint8ClampedArray(dim * dim * 4).fill(255);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!grid[r]![c]) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const i = (((r + quiet) * scale + dy) * dim + ((c + quiet) * scale + dx)) * 4;
          data[i] = 0;
          data[i + 1] = 0;
          data[i + 2] = 0;
        }
      }
    }
  }
  return jsQR(data, dim, dim)?.data ?? null;
}

function expectRoundTrip(text: string): void {
  const svg = encodeQrSvg(text);
  expect(svg, `encoder returned null for ${new TextEncoder().encode(text).length} bytes`).not.toBeNull();
  expect(decodeSvg(svg!)).toBe(text);
}

const SECRET = "CMHMM5N4XBTDSO5M2ZQGIMJNFX2WBO4N";
const otpauth = (email: string): string =>
  `otpauth://totp/Keyring:${encodeURIComponent(email)}?issuer=Keyring&secret=${SECRET}`;

describe("encodeQrSvg", () => {
  it("round-trips at every supported version", () => {
    // One length per version, so a broken version cannot hide behind a
    // passing neighbour. 100 and 130 are the two the old encoder could not
    // reach at all; 130 is the first needing block interleaving.
    for (const n of [10, 30, 50, 75, 100, 130]) {
      expectRoundTrip("a".repeat(n));
    }
  });

  it("round-trips a real enrollment URL — the case that was broken", () => {
    expectRoundTrip(otpauth("riley.hire@gmail.com"));
  });

  it("round-trips enrollment URLs across realistic address lengths", () => {
    for (const email of [
      "a@b.co",
      "riley.hire@gmail.com",
      "a.very.long.name@some-company-domain.com",
      "firstname.lastname+tag@a-fairly-long-domain.example",
    ]) {
      expectRoundTrip(otpauth(email));
    }
  });

  it("round-trips at the exact capacity boundary of every version", () => {
    // An off-by-one in a capacity table shows up here and nowhere else: one
    // byte over and the codewords overflow the block silently.
    for (const n of [17, 18, 32, 33, 53, 54, 78, 79, 106, 107, 134]) {
      expectRoundTrip("x".repeat(n));
    }
  });

  it("returns null past its ceiling rather than emitting a broken code", () => {
    // Refusing is correct: the caller falls back to the copyable secret, which
    // is a complete enrollment path. Emitting an unscannable code is not.
    expect(encodeQrSvg("x".repeat(135))).toBeNull();
  });

  it("sizes versions by UTF-8 length, not character count", () => {
    // 40 characters but 92 bytes. Sizing from character count would pick a
    // version far too small and produce an unscannable code.
    const text = "é".repeat(40) + "@example.com";
    expect(new TextEncoder().encode(text).length).toBeGreaterThan(text.length);
    expectRoundTrip(text);
  });

  it("uses the smallest version that fits, so the code stays legible", () => {
    // A needlessly large symbol has smaller modules, which scans worse on a
    // phone. 17 bytes is version 1 (21 modules), 18 tips into version 2 (25).
    expect(encodeQrSvg("x".repeat(17))).toContain(`viewBox="0 0 ${(21 + 8) * 5}`);
    expect(encodeQrSvg("x".repeat(18))).toContain(`viewBox="0 0 ${(25 + 8) * 5}`);
  });
});
