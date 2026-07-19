// apps/api/src/repos/post.ts
import { prisma } from "@outreach/db";
import { dedupeKey } from "@outreach/linkedin";
import type { RawPost } from "@outreach/core";

export async function upsertPosts(
  accountId: string,
  source: "linkedin_api" | "csv_import" | "manual" | "embed",
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
  const rows = await prisma.post.findMany({
    where: { linkedinAccountId: accountId },
    orderBy: { publishedAt: "desc" },
    select: {
      id: true,
      text: true,
      publishedAt: true,
      mediaType: true,
      externalId: true,
      metrics: true,
      source: true,
      raw: true,
    },
  });
  // Surface the stored image (embed imports keep it in `raw.imageUrl`) as a flat
  // field, and drop the potentially-large `raw` blob from the list payload.
  return rows.map(({ raw, ...r }) => ({ ...r, imageUrl: imageUrlFromRaw(raw) }));
}

function imageUrlFromRaw(raw: unknown): string | null {
  if (raw && typeof raw === "object" && "imageUrl" in raw) {
    const v = (raw as { imageUrl?: unknown }).imageUrl;
    return typeof v === "string" && v ? v : null;
  }
  return null;
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

export interface SimilarPost {
  source: "published" | "draft";
  similarity: number; // 0..1 token overlap
  publishedAt: string;
  excerpt: string;
}

// Token-overlap search over the account's published posts + existing drafts so
// the studio agent can avoid re-writing something the creator already posted.
// Deterministic (no model call), so it never hits an API rate limit.
export async function findSimilarPosts(
  accountId: string,
  query: string,
  opts?: { limit?: number; excludeDraftId?: string },
): Promise<SimilarPost[]> {
  const limit = opts?.limit ?? 4;
  const q = tokenize(query);
  if (q.size === 0) return [];

  const [posts, drafts] = await Promise.all([
    prisma.post.findMany({
      where: { linkedinAccountId: accountId },
      orderBy: { publishedAt: "desc" },
      take: 300,
      select: { text: true, publishedAt: true },
    }),
    prisma.draft.findMany({
      where: {
        linkedinAccountId: accountId,
        text: { not: "" },
        ...(opts?.excludeDraftId ? { id: { not: opts.excludeDraftId } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 300,
      select: { text: true, createdAt: true },
    }),
  ]);

  const candidates = [
    ...posts.map((p) => ({ source: "published" as const, text: p.text, date: p.publishedAt })),
    ...drafts.map((d) => ({ source: "draft" as const, text: d.text, date: d.createdAt })),
  ];

  return candidates
    .map((c) => ({
      source: c.source,
      similarity: jaccard(q, tokenize(c.text)),
      publishedAt: c.date.toISOString(),
      excerpt: c.text.slice(0, 200),
    }))
    .filter((c) => c.similarity >= 0.12)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit)
    .map((c) => ({ ...c, similarity: Math.round(c.similarity * 100) / 100 }));
}

const STOPWORDS = new Set(
  "the a an and or but of to in on for with is are was were be been being this that these those you your we our it its as at by from".split(" "),
);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}
