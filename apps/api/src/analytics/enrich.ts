import { MemberAnalyticsClient } from "@outreach/linkedin";
import { getDecryptedAccount } from "../repos/linkedin-account.js";
import { postsToEnrich, postsToEnrichRecent, setPostMetrics } from "../repos/post.js";
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
}

// Pull per-post LinkedIn metrics for an account's posts and persist them. Used
// both by the manual `/enrich` route (recent, capped at ENRICH_LIMIT) and by the
// auto-enrich worker (windowed to `since`). The analytics client is injectable
// so the logic is testable without a real LinkedIn call.
export async function enrichAccountMetrics(
  accountId: string,
  userId: string,
  opts?: { since?: Date; limit?: number; deps?: EnrichDeps },
): Promise<{ enriched: number; failed: number; total: number }> {
  const acct = await getDecryptedAccount(accountId, userId);
  if (!acct) return { enriched: 0, failed: 0, total: 0 };

  const targets = opts?.since
    ? await postsToEnrichRecent(accountId, opts.since)
    : await postsToEnrich(accountId, opts?.limit ?? ENRICH_LIMIT);
  if (targets.length === 0) return { enriched: 0, failed: 0, total: 0 };

  const client: EnrichClient =
    opts?.deps?.makeClient?.(acct.accessToken) ??
    new MemberAnalyticsClient({ accessToken: acct.accessToken, apiVersion: env.LINKEDIN_API_VERSION });

  let enriched = 0;
  let failed = 0;
  await mapLimit(targets, 3, async (p) => {
    try {
      const metrics = await client.forPost(p.externalId!);
      await setPostMetrics(p.id, metrics);
      enriched++;
    } catch {
      failed++;
    }
  });
  return { enriched, failed, total: targets.length };
}
