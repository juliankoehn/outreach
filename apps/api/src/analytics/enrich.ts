import { MemberAnalyticsClient } from "@outreach/linkedin";
import { engagementRate, analyzePost as realAnalyzePost, type PostMetrics } from "@outreach/ai";
import { getDecryptedAccount, getAnalyticsCache } from "../repos/linkedin-account.js";
import { getAccountProfile } from "../repos/profile.js";
import { postsToEnrich, postsToEnrichRecent, setPostMetrics, getPostDetail, setPostAnalysis } from "../repos/post.js";
import { env } from "../env.js";

export const ENRICH_LIMIT = 25;

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    let next = queue.shift();
    while (next !== undefined) {
      await fn(next);
      next = queue.shift();
    }
  });
  await Promise.all(workers);
}

export interface EnrichClient {
  forPost(urn: string): Promise<object>;
}
export interface EnrichDeps {
  makeClient?(accessToken: string): EnrichClient;
  analyzePost?: typeof realAnalyzePost;
}

// Pull per-post LinkedIn metrics for an account's posts and persist them. Used
// both by the manual `/enrich` route (recent, capped at ENRICH_LIMIT) and by the
// auto-enrich worker (windowed to `since`). The analytics client is injectable
// so the logic is testable without a real LinkedIn call.
//
// After refreshing a post's metrics, also (re)runs `analyzePost` when it's
// cheap-appropriate: `force`, first-time analysis, or the impressions moved
// vs. the stored `analysis.basis.impressions` (a money-guard against
// re-analysing every post on every enrich pass).
export async function enrichAccountMetrics(
  accountId: string,
  userId: string,
  opts?: { since?: Date; limit?: number; force?: boolean; deps?: EnrichDeps },
): Promise<{ enriched: number; failed: number; analyzed: number; total: number }> {
  const acct = await getDecryptedAccount(accountId, userId);
  if (!acct) return { enriched: 0, failed: 0, analyzed: 0, total: 0 };

  const targets = opts?.since
    ? await postsToEnrichRecent(accountId, opts.since)
    : await postsToEnrich(accountId, opts?.limit ?? ENRICH_LIMIT);
  if (targets.length === 0) return { enriched: 0, failed: 0, analyzed: 0, total: 0 };

  const client: EnrichClient =
    opts?.deps?.makeClient?.(acct.accessToken) ??
    new MemberAnalyticsClient({ accessToken: acct.accessToken, apiVersion: env.LINKEDIN_API_VERSION });

  const analyze = opts?.deps?.analyzePost ?? realAnalyzePost;
  const profile = await getAccountProfile(accountId);
  const baseline = ((await getAnalyticsCache(accountId))?.analytics ?? null) as PostMetrics | null;

  let enriched = 0;
  let failed = 0;
  let analyzed = 0;
  await mapLimit(targets, 3, async (p) => {
    try {
      const metrics = (await client.forPost(p.externalId!)) as PostMetrics;
      await setPostMetrics(p.id, metrics);
      enriched++;

      // Money-guard: only (re)analyse on force, first-time, or when impressions moved.
      const detail = await getPostDetail(accountId, p.id);
      const prevBasis = (detail?.analysis as { basis?: { impressions?: number } } | null)?.basis?.impressions;
      const impressions = metrics.impressions ?? 0;
      if (opts?.force || !detail?.analyzedAt || prevBasis !== impressions) {
        const analysis = await analyze({
          text: detail?.text ?? "",
          mediaType: detail?.mediaType ?? "none",
          publishedAt: (detail?.publishedAt ?? new Date()).toISOString(),
          metrics,
          engagementRate: engagementRate(metrics),
          baseline,
          profile: profile
            ? { goals: profile.goals, audience: profile.audience, pillars: profile.pillars, toneWords: profile.toneWords, noGos: profile.noGos, brandBrief: profile.brandBrief }
            : null,
        });
        await setPostAnalysis(p.id, { ...analysis, basis: { impressions } });
        analyzed++;
      }
    } catch {
      failed++;
    }
  });
  return { enriched, failed, analyzed, total: targets.length };
}
