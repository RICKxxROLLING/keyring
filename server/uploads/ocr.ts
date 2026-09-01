// server/uploads/ocr.ts — read text off a receipt image, on this box.
//
// Tesseract, installed in the image (see Dockerfile), invoked as a subprocess.
// Nothing is sent anywhere: a receipt carries a property address, a vendor and
// an amount, and this app's whole premise is that such things stay on hardware
// you control. A cloud OCR API would be more accurate and would quietly undo
// that.
//
// Every entry point here degrades rather than fails. Tesseract is absent on a
// Windows dev machine and in CI, and an upload must still work there — you type
// the amount, exactly as before this existed. So `isAvailable()` is checked up
// front and the route says "not available" rather than throwing.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Wall-clock ceiling for one page.
 *
 * Tesseract on a photographed receipt is normally 1-3s. A pathological image
 * can take far longer, and this runs inside a request, so it is bounded rather
 * than left to finish whenever.
 */
const TIMEOUT_MS = 20_000;

/** Anything larger is not a phone photo of a receipt and is refused unread. */
export const MAX_OCR_BYTES = 12 * 1024 * 1024;

let availability: Promise<boolean> | null = null;

/**
 * Whether Tesseract is installed, asked once and remembered.
 *
 * Cached because it cannot change while the process runs, and because probing
 * the filesystem on every scan request would be a silly cost for an answer that
 * is fixed at image build time.
 */
export function isOcrAvailable(): Promise<boolean> {
  availability ??= run("tesseract", ["--version"], { timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  return availability;
}

/** Only for tests, which need to re-probe after changing the environment. */
export function resetOcrAvailability(): void {
  availability = null;
}

export interface OcrResult {
  text: string;
  /** Milliseconds spent in Tesseract, for the log. */
  ms: number;
}

/**
 * Read the text off an image.
 *
 * Returns null when Tesseract is not installed — the caller turns that into an
 * honest "scanning is not available on this server" rather than an error that
 * looks like the receipt was unreadable.
 *
 * `--psm 6` treats the page as a single uniform block of text, which is what a
 * receipt is. The default segmentation looks for columns and paragraphs and
 * does noticeably worse on a narrow till slip.
 */
export async function readImageText(absPath: string): Promise<OcrResult | null> {
  if (!(await isOcrAvailable())) return null;

  const started = Date.now();
  try {
    // "stdout" as the output base makes Tesseract write to stdout instead of a
    // file, so there is no temp file to name, collide on, or clean up.
    const { stdout } = await run("tesseract", [absPath, "stdout", "--psm", "6"], {
      timeout: TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
      // Tesseract writes progress to stderr; ignoring it keeps the logs quiet.
      windowsHide: true,
    });
    return { text: stdout, ms: Date.now() - started };
  } catch {
    // A timeout, an unreadable file, or a Tesseract crash. All of them mean the
    // same thing to the caller — no text — and none of them should take the
    // request down, because the upload itself already succeeded.
    return null;
  }
}
