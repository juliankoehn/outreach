import { createHash } from "node:crypto";
import type { RawPost } from "@outreach/core";

export function hashPost(text: string, publishedAt: Date): string {
  return createHash("sha256").update(`${text}\n${publishedAt.toISOString()}`).digest("hex");
}

export function dedupeKey(raw: RawPost): string {
  return raw.externalId ?? hashPost(raw.text, raw.publishedAt);
}
