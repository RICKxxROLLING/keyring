// server/uploads/thumbnails.ts — re-encode + thumbnail via sharp. All raster images are
// normalized to JPEG on write (auto-rotated, metadata stripped, capped at 4000px long edge);
// a 480px WebP thumbnail is written alongside. A sharp failure means the "image" was not a
// real image, which the caller reports as UNSUPPORTED_MEDIA_TYPE.
import sharp from "sharp";
import { ApiError } from "../lib/errors.js";

export interface ProcessedImage {
  output: Buffer;
  outputMime: "image/jpeg";
  thumb: Buffer;
  width: number;
  height: number;
}

export async function processImage(input: Buffer): Promise<ProcessedImage> {
  try {
    const pipeline = sharp(input, { failOn: "error" }).rotate();
    const resized = pipeline.clone().resize({
      width: 4000,
      height: 4000,
      fit: "inside",
      withoutEnlargement: true,
    });
    const output = await resized.jpeg({ quality: 87, mozjpeg: true }).toBuffer();
    const meta = await sharp(output).metadata();
    const thumb = await sharp(input)
      .rotate()
      .resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    return {
      output,
      outputMime: "image/jpeg",
      thumb,
      width: meta.width ?? 0,
      height: meta.height ?? 0,
    };
  } catch {
    throw new ApiError("UNSUPPORTED_MEDIA_TYPE", "File could not be processed as an image.");
  }
}
