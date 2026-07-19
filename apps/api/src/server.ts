import { serve } from "@hono/node-server";
import { prisma } from "@outreach/db";
import { createApp } from "./app.js";
import { env } from "./env.js";
import { getBoss, enqueueIngest, INGEST_QUEUE } from "./queue.js";
import { ingestDocument } from "./jobs/ingest-document.js";

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
  } catch (e) {
    console.error("server: pg-boss ingestion worker failed to start", e);
  }
})();
