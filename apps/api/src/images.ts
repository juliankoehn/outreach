// apps/api/src/images.ts
import { randomUUID } from "node:crypto";
import { putObject } from "./storage.js";

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export async function saveImage(base64: string, mediaType: string): Promise<{ url: string }> {
  const ext = EXT[mediaType] ?? "png";
  const name = `${randomUUID()}.${ext}`;
  await putObject(`generated/${name}`, Buffer.from(base64, "base64"), mediaType);
  return { url: `/generated/${name}` };
}
