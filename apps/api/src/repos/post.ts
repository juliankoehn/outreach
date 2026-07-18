// apps/api/src/repos/post.ts
import { prisma } from "@outreach/db";
import { dedupeKey } from "@outreach/linkedin";
import type { RawPost } from "@outreach/core";

export async function upsertPosts(
  accountId: string,
  source: "linkedin_api" | "csv_import",
  posts: RawPost[],
): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;
  for (const p of posts) {
    const hash = dedupeKey(p);
    try {
      await prisma.post.create({
        data: {
          linkedinAccountId: accountId,
          source,
          externalId: p.externalId,
          dedupeHash: hash,
          text: p.text,
          mediaType: p.mediaType,
          publishedAt: p.publishedAt,
          metrics: (p.metrics as object | undefined) ?? undefined,
          raw: p.raw as object,
        },
      });
      inserted++;
    } catch (e: unknown) {
      // Unique violation on (linkedinAccountId, dedupeHash) => already ingested.
      if (typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "P2002") {
        skipped++;
      } else {
        throw e;
      }
    }
  }
  return { inserted, skipped };
}
