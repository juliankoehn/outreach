import { PgBoss } from "pg-boss";

let boss: PgBoss | null = null;
let starting: Promise<PgBoss> | null = null;

export const INGEST_QUEUE = "ingest-document";
export const FEED_QUEUE = "fetch-feed";
export const POLL_FEEDS_QUEUE = "poll-feeds";
export const PUBLISH_DUE_QUEUE = "publish-due";
export const REFRESH_TOKENS_QUEUE = "refresh-tokens";
export const ENRICH_METRICS_QUEUE = "enrich-metrics";

export async function getBoss(): Promise<PgBoss> {
  if (boss) return boss;
  starting ??= (async () => {
    const b = new PgBoss(process.env.DATABASE_URL!);
    await b.start();
    // Capped retries with exponential backoff: a stuck/failing ingest job
    // shouldn't retry forever nor hammer the DB/embedding API immediately.
    await b.createQueue(INGEST_QUEUE, { retryLimit: 5, retryDelay: 30, retryBackoff: true });
    // A single broken feed shouldn't retry forever; capped retries with backoff.
    await b.createQueue(FEED_QUEUE, { retryLimit: 3, retryDelay: 60, retryBackoff: true });
    await b.createQueue(POLL_FEEDS_QUEUE);
    // publishDraft already records "failed" on its own errors, so an
    // aggressive pg-boss retry would just double-attempt (and risk
    // double-posting) an already-handled failure.
    await b.createQueue(PUBLISH_DUE_QUEUE, { retryLimit: 0 });
    await b.createQueue(REFRESH_TOKENS_QUEUE);
    await b.createQueue(ENRICH_METRICS_QUEUE);
    boss = b;
    return b;
  })().catch((e: unknown) => {
    // A failed start must not be cached — the next call should retry from
    // scratch rather than permanently wedge on a transient DB outage.
    starting = null;
    throw e;
  });
  return starting;
}

export async function enqueueIngest(resourceId: string): Promise<void> {
  const b = await getBoss();
  await b.send(INGEST_QUEUE, { resourceId });
}

export async function enqueueFeedFetch(sourceId: string): Promise<void> {
  const b = await getBoss();
  await b.send(FEED_QUEUE, { sourceId });
}
