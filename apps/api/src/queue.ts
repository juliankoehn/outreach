import { PgBoss } from "pg-boss";

let boss: PgBoss | null = null;
let starting: Promise<PgBoss> | null = null;

export const INGEST_QUEUE = "ingest-document";

export async function getBoss(): Promise<PgBoss> {
  if (boss) return boss;
  starting ??= (async () => {
    const b = new PgBoss(process.env.DATABASE_URL!);
    await b.start();
    // Capped retries with exponential backoff: a stuck/failing ingest job
    // shouldn't retry forever nor hammer the DB/embedding API immediately.
    await b.createQueue(INGEST_QUEUE, { retryLimit: 5, retryDelay: 30, retryBackoff: true });
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
