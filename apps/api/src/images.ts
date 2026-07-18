// apps/api/src/images.ts
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
export const uploadsDir = join(here, "..", "uploads");

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export async function saveImage(base64: string, mediaType: string): Promise<{ url: string; path: string }> {
  await mkdir(uploadsDir, { recursive: true });
  const ext = EXT[mediaType] ?? "png";
  const name = `${randomBytes(12).toString("hex")}.${ext}`;
  const path = join(uploadsDir, name);
  await writeFile(path, Buffer.from(base64, "base64"));
  return { url: `/uploads/${name}`, path };
}
