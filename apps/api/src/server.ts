import { serve } from "@hono/node-server";
import { prisma } from "@outreach/db";
import { createApp } from "./app.js";
import { env } from "./env.js";
import {
  getBoss,
  enqueueIngest,
  INGEST_QUEUE,
  FEED_QUEUE,
  POLL_FEEDS_QUEUE,
  PUBLISH_DUE_QUEUE,
  REFRESH_TOKENS_QUEUE,
  enqueueFeedFetch,
} from "./queue.js";
import { ingestDocument } from "./jobs/ingest-document.js";
import { fetchFeedSource } from "./jobs/fetch-feed.js";
import { publishDraft } from "./publish/publish-draft.js";
import { claimDuePublishDrafts, listAccountsNeedingRefresh } from "./publish/due.js";
import { refreshAccountToken } from "./publish/refresh-tokens.js";

serve({ fetch: createApp().fetch, port: env.API_PORT }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`);
});

// Start pg-boss and the document-ingestion worker in-process. Guarded so a
// boss/DB hiccup at boot is logged rather than crashing the API — uploads
// still succeed and land in "pending"; the worker (once it does come up on a
// later boot) will pick them up via the backfill below.
(async () => {
  try {
    const boss = await getBoss();
    await boss.work<{ resourceId: string }>(
      INGEST_QUEUE,
      { batchSize: 1, pollingIntervalSeconds: 2 },
      async ([job]) => {
        await ingestDocument(job!.data.resourceId);
      },
    );

    // Backfill: catch any document resources left "pending", "processing", or
    // "failed" from before this worker was up (e.g. an enqueue that failed, a
    // previous boot crash mid-processing, or a job that exhausted retries).
    const pending = await prisma.resource.findMany({
      where: { kind: "document", status: { in: ["pending", "processing", "failed"] } },
      select: { id: true },
    });
    for (const r of pending) await enqueueIngest(r.id);

    // Feed ingestion: a worker that fetches a single source, plus a
    // scheduled poll that enqueues a fetch for every active source every
    // 30 minutes.
    await boss.work<{ sourceId: string }>(FEED_QUEUE, { batchSize: 2 }, async (jobs) => {
      for (const j of jobs) await fetchFeedSource(j.data.sourceId);
    });
    await boss.work(POLL_FEEDS_QUEUE, async () => {
      // Include "error" sources so a feed that hit a transient blip recovers on
      // the next poll (a successful fetch resets it to "active").
      const sources = await prisma.feedSource.findMany({
        where: { status: { in: ["active", "error"] } },
        select: { id: true },
      });
      for (const s of sources) await enqueueFeedFetch(s.id);
    });
    await boss.schedule(POLL_FEEDS_QUEUE, "*/30 * * * *");

    // Publish due scheduled drafts. `claimDuePublishDrafts` atomically flips
    // due drafts to "publishing" in a single UPDATE ... RETURNING so two
    // overlapping runs of this scheduled job can never both pick up (and
    // double-post) the same draft.
    await boss.work(PUBLISH_DUE_QUEUE, async () => {
      const due = await claimDuePublishDrafts();
      for (const d of due) {
        try {
          // skipClaim: claimDuePublishDrafts already atomically flipped this
          // draft to "publishing" above, so publishDraft's own claim (which
          // guards against a concurrent "Publish now" click) would otherwise
          // see status="publishing" and wrongly refuse to publish here too.
          await publishDraft(d.id, d.linkedinAccountId, d.userId, { skipClaim: true });
        } catch (e) {
          console.error("publish-due failed", d.id, e);
        }
      }
    });
    await boss.schedule(PUBLISH_DUE_QUEUE, "* * * * *");

    // Proactively refresh LinkedIn tokens nearing expiry so publishing never
    // has to refresh (and risk failing) inline.
    await boss.work(REFRESH_TOKENS_QUEUE, async () => {
      const accts = await listAccountsNeedingRefresh();
      for (const a of accts) {
        try {
          await refreshAccountToken(a.id, a.userId);
        } catch (e) {
          console.error("refresh-tokens failed", a.id, e);
        }
      }
    });
    await boss.schedule(REFRESH_TOKENS_QUEUE, "0 */6 * * *");
  } catch (e) {
    console.error("server: pg-boss ingestion worker failed to start", e);
  }
})();
