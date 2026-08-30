// server/uploads/validate-file.ts — magic-byte detection and the upload allowlist.
import { ApiError } from "../lib/errors.js";

export type DetectedKind = "image" | "pdf";

export interface DetectedFile {
  kind: DetectedKind;
  mime: string;
}

const ALLOWED_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
]);

/** Sniffs the first bytes of a file. Never trusts the declared Content-Type. */
export function detectFileType(buf: Buffer): DetectedFile | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { kind: "image", mime: "image/jpeg" };
  }
  if (
    buf.length >= 4 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return { kind: "image", mime: "image/png" };
  }
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return { kind: "image", mime: "image/webp" };
  }
  if (buf.length >= 32) {
    const head = buf.toString("ascii", 4, 32);
    if (head.includes("ftyp") && (head.includes("heic") || head.includes("heix") || head.includes("mif1"))) {
      return { kind: "image", mime: "image/heic" };
    }
  }
  if (buf.length >= 5 && buf.toString("ascii", 0, 5) === "%PDF-") {
    return { kind: "pdf", mime: "application/pdf" };
  }
  return null;
}

/** Throws UNSUPPORTED_MEDIA_TYPE (415) if the bytes don't match the allowlist. */
export function requireKnownFileType(buf: Buffer): DetectedFile {
  const detected = detectFileType(buf);
  if (!detected || !ALLOWED_MIMES.has(detected.mime)) {
    throw new ApiError("UNSUPPORTED_MEDIA_TYPE", "Unsupported or unrecognized file type.");
  }
  return detected;
}

export function requireWithinSizeLimit(sizeBytes: number, maxBytes: number): void {
  if (sizeBytes > maxBytes) {
    throw new ApiError("PAYLOAD_TOO_LARGE", `File exceeds the ${maxBytes} byte limit.`);
  }
}
