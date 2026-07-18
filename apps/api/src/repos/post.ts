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

export async function listPosts(accountId: string) {
  return prisma.post.findMany({
    where: { linkedinAccountId: accountId },
    orderBy: { publishedAt: "desc" },
    select: {
      id: true,
      text: true,
      publishedAt: true,
      mediaType: true,
      externalId: true,
      metrics: true,
    },
  });
}

/** Posts that carry a LinkedIn URN, so their per-post metrics can be fetched. */
export async function postsToEnrich(accountId: string, limit: number) {
  return prisma.post.findMany({
    where: { linkedinAccountId: accountId, externalId: { not: null } },
    orderBy: { publishedAt: "desc" },
    take: limit,
    select: { id: true, externalId: true },
  });
}

export async function setPostMetrics(postId: string, metrics: object): Promise<void> {
  await prisma.post.update({ where: { id: postId }, data: { metrics } });
}
