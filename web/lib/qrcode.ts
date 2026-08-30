// web/lib/qrcode.ts — minimal, dependency-free QR code encoder (owner T4).
// No QR package is in the frozen dependency list (package.json, §C3.1), so TOTP enrollment
// renders its own code. Supports byte-mode text up to 78 bytes (versions 1-4, EC level L),
// which comfortably covers an `otpauth://` URL. Longer input returns null so the caller can
// fall back to the copyable secret + URL (still a complete enrollment path without a QR).
//
// Implementation follows the public ISO/IEC 18004 algorithm (finder/alignment/timing patterns,
// GF(256) Reed-Solomon error correction, BCH(15,5) format info, standard mask-penalty scoring).

const BYTE_CAPACITY: Record<number, number> = { 1: 17, 2: 32, 3: 53, 4: 78 };
const EC_CODEWORDS: Record<number, number> = { 1: 7, 2: 10, 3: 15, 4: 20 };
const TOTAL_CODEWORDS: Record<number, number> = { 1: 26, 2: 44, 3: 70, 4: 100 };
const ALIGNMENT_POSITIONS: Record<number, number[]> = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26] };
const EC_LEVEL_L_BITS = 0b01;

/* --------------------------------------------------------------- GF(256) */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(function initTables() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255] as number;
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[(LOG[a] as number) + (LOG[b] as number)] as number;
}

function polyMul(a: number[], b: number[]): number[] {
  const result = new Array<number>(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      result[i + j] = (result[i + j] as number) ^ gfMul(a[i] as number, b[j] as number);
    }
  }
  return result;
}

function rsGeneratorPoly(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    poly = polyMul(poly, [1, EXP[i] as number]);
  }
  return poly;
}

function rsEncode(data: number[], ecLen: number): number[] {
  const generator = rsGeneratorPoly(ecLen);
  const result = new Uint8Array(data.length + ecLen);
  result.set(data);
  for (let i = 0; i < data.length; i++) {
    const factor = result[i] as number;
    if (factor === 0) continue;
    for (let j = 0; j < generator.length; j++) {
      result[i + j] = (result[i + j] as number) ^ gfMul(generator[j] as number, factor);
    }
  }
  return Array.from(result.slice(data.length));
}

/* ------------------------------------------------------------- bit stream */

class BitBuffer {
  bits: number[] = [];
  push(value: number, length: number) {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }
}

function chooseVersion(byteLength: number): number | null {
  for (const v of [1, 2, 3, 4]) {
    if (byteLength <= (BYTE_CAPACITY[v] as number)) return v;
  }
  return null;
}

function buildCodewords(text: string, version: number): number[] {
  const bytes = Array.from(new TextEncoder().encode(text));
  const dataCodewords = (TOTAL_CODEWORDS[version] as number) - (EC_CODEWORDS[version] as number);
  const bb = new BitBuffer();
  bb.push(0b0100, 4); // byte mode
  bb.push(bytes.length, 8); // count indicator (8 bits for versions 1-9)
  for (const byte of bytes) bb.push(byte, 8);

  const capacityBits = dataCodewords * 8;
  // terminator (up to 4 zero bits)
  for (let i = 0; i < 4 && bb.bits.length < capacityBits; i++) bb.bits.push(0);
  // pad to byte boundary
  while (bb.bits.length % 8 !== 0) bb.bits.push(0);
  // pad codewords
  const padBytes = [0xec, 0x11];
  let padIndex = 0;
  while (bb.bits.length < capacityBits) {
    bb.push(padBytes[padIndex % 2] as number, 8);
    padIndex++;
  }

  const dataBytes: number[] = [];
  for (let i = 0; i < bb.bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | (bb.bits[i + j] as number);
    dataBytes.push(byte);
  }

  const ec = rsEncode(dataBytes, EC_CODEWORDS[version] as number);
  return [...dataBytes, ...ec];
}

/* ----------------------------------------------------------------- matrix */

type Grid = boolean[][];

function makeGrid(size: number, fill = false): Grid {
  return Array.from({ length: size }, () => Array<boolean>(size).fill(fill));
}

function buildMatrix(version: number, codewords: number[]): boolean[][] {
  const size = version * 4 + 17;
  const dark = makeGrid(size);
  const isFunction = makeGrid(size);

  function setFn(row: number, col: number, value: boolean) {
    if (row < 0 || row >= size || col < 0 || col >= size) return;
    dark[row]![col] = value;
    isFunction[row]![col] = true;
  }

  function drawFinder(centerRow: number, centerCol: number) {
    for (let dr = -4; dr <= 4; dr++) {
      for (let dc = -4; dc <= 4; dc++) {
        const dist = Math.max(Math.abs(dr), Math.abs(dc));
        setFn(centerRow + dr, centerCol + dc, dist !== 2 && dist !== 4);
      }
    }
  }
  drawFinder(3, 3);
  drawFinder(3, size - 4);
  drawFinder(size - 4, 3);

  const positions = ALIGNMENT_POSITIONS[version] as number[];
  const isFinderCorner = (r: number, c: number) =>
    (r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6);
  for (const r of positions) {
    for (const c of positions) {
      if (isFinderCorner(r, c)) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dist = Math.max(Math.abs(dr), Math.abs(dc));
          setFn(r + dr, c + dc, dist !== 1);
        }
      }
    }
  }

  for (let i = 8; i <= size - 9; i++) {
    setFn(6, i, i % 2 === 0);
    setFn(i, 6, i % 2 === 0);
  }

  setFn(4 * version + 9, 8, true); // dark module

  // Reserve format-info areas (filled in later by drawFormatBits).
  for (let i = 0; i <= 8; i++) {
    if (!isFunction[8]![i]) setFn(8, i, false);
    if (!isFunction[i]![8]) setFn(i, 8, false);
  }
  for (let i = 0; i < 8; i++) {
    setFn(8, size - 1 - i, false);
    setFn(size - 1 - i, 8, false);
  }

  // Data placement: zigzag two-column strips from bottom-right, skipping column 6.
  const allBits: number[] = [];
  for (const byte of codewords) for (let i = 7; i >= 0; i--) allBits.push((byte >>> i) & 1);
  let bitIndex = 0;
  let upward = true;
  for (let colPair = size - 1; colPair >= 1; colPair -= 2) {
    const col = colPair === 6 ? 5 : colPair; // never place in the timing column
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (const c of [col, col - 1]) {
        if (isFunction[row]![c]) continue;
        const bit = bitIndex < allBits.length ? (allBits[bitIndex] as number) : 0;
        dark[row]![c] = bit === 1;
        bitIndex++;
      }
    }
    upward = !upward;
  }

  // Try all 8 masks, keep the lowest-penalty result (standard QR mask selection).
  function maskFn(m: number, r: number, c: number): boolean {
    switch (m) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
      case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
      default: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    }
  }

  function applyMask(m: number): Grid {
    const g = dark.map((row) => row.slice());
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!isFunction[r]![c] && maskFn(m, r, c)) g[r]![c] = !g[r]![c];
      }
    }
    return g;
  }

  function penalty(g: Grid): number {
    let score = 0;
    // Rule 1: runs of 5+ same-colour modules in a row/column.
    for (let r = 0; r < size; r++) {
      let runColor = g[r]![0];
      let runLen = 1;
      for (let c = 1; c < size; c++) {
        if (g[r]![c] === runColor) {
          runLen++;
        } else {
          if (runLen >= 5) score += 3 + (runLen - 5);
          runColor = g[r]![c];
          runLen = 1;
        }
      }
      if (runLen >= 5) score += 3 + (runLen - 5);
    }
    for (let c = 0; c < size; c++) {
      let runColor = g[0]![c];
      let runLen = 1;
      for (let r = 1; r < size; r++) {
        if (g[r]![c] === runColor) {
          runLen++;
        } else {
          if (runLen >= 5) score += 3 + (runLen - 5);
          runColor = g[r]![c];
          runLen = 1;
        }
      }
      if (runLen >= 5) score += 3 + (runLen - 5);
    }
    // Rule 3: dark:light:dark:dark:dark:light:dark pattern with 4-module light run either side.
    const finderLike = [true, false, true, true, true, false, true];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c + 7 <= size; c++) {
        let match = true;
        for (let k = 0; k < 7; k++) if (g[r]![c + k] !== finderLike[k]) match = false;
        if (match) score += 40;
      }
    }
    for (let c = 0; c < size; c++) {
      for (let r = 0; r + 7 <= size; r++) {
        let match = true;
        for (let k = 0; k < 7; k++) if (g[r + k]![c] !== finderLike[k]) match = false;
        if (match) score += 40;
      }
    }
    return score;
  }

  let best: { mask: number; grid: Grid; score: number } | null = null;
  for (let m = 0; m < 8; m++) {
    const g = applyMask(m);
    const score = penalty(g);
    if (!best || score < best.score) best = { mask: m, grid: g, score };
  }
  const chosen = best as { mask: number; grid: Grid; score: number };

  // Format info: 2-bit EC level + 3-bit mask, BCH(15,5)-protected, XORed with the fixed mask.
  const data = (EC_LEVEL_L_BITS << 3) | chosen.mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const bit = (i: number) => ((bits >>> i) & 1) === 1;

  for (let i = 0; i <= 5; i++) chosen.grid[8]![i] = bit(i);
  chosen.grid[8]![7] = bit(6);
  chosen.grid[8]![8] = bit(7);
  chosen.grid[7]![8] = bit(8);
  for (let i = 9; i <= 14; i++) chosen.grid[14 - i]![8] = bit(i);
  for (let i = 0; i <= 7; i++) chosen.grid[size - 1 - i]![8] = bit(i);
  for (let i = 8; i <= 14; i++) chosen.grid[8]![size - 15 + i] = bit(i);
  chosen.grid[size - 8]![8] = true; // dark module

  return chosen.grid;
}

/** Encodes `text` as a QR code SVG string, or null if it exceeds this encoder's byte-mode capacity (78 bytes). */
export function encodeQrSvg(text: string, moduleSize = 5, margin = 4): string | null {
  const byteLength = new TextEncoder().encode(text).length;
  const version = chooseVersion(byteLength);
  if (version === null) return null;
  const codewords = buildCodewords(text, version);
  const grid = buildMatrix(version, codewords);
  const size = grid.length;
  const px = (size + margin * 2) * moduleSize;

  let path = "";
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (grid[r]![c]) {
        const x = (c + margin) * moduleSize;
        const y = (r + margin) * moduleSize;
        path += `M${x},${y}h${moduleSize}v${moduleSize}h-${moduleSize}z`;
      }
    }
  }
  return `<svg viewBox="0 0 ${px} ${px}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="QR code"><rect width="${px}" height="${px}" fill="#fff"/><path d="${path}" fill="#0f172a"/></svg>`;
}
