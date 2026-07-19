import { prisma } from "@outreach/db";
import { extractText, chunkText, embedBatch } from "@outreach/ai";
import { getObject } from "../storage.js";
import { insertChunks, deleteChunksForResource } from "../repos/chunk.js";

export async function ingestDocument(resourceId: string): Promise<void> {
  const res = await prisma.resource.findUnique({ where: { id: resourceId } });
  if (!res || res.kind !== "document") return;
  if (res.status !== "pending" && res.status !== "failed") return;
  await prisma.resource.update({ where: { id: resourceId }, data: { status: "processing", error: null } });
  try {
    const obj = await getObject(res.storageKey);
    if (!obj) throw new Error("object missing in storage");
    const text = await extractText(obj.body, res.mimeType);
    const chunks = chunkText(text);
    await deleteChunksForResource(resourceId); // idempotent re-ingest
    // embed + insert in batches
    const BATCH = 64;
    for (let i = 0; i < chunks.length; i += BATCH) {
      const slice = chunks.slice(i, i + BATCH);
      const embeddings = await embedBatch(slice.map((c) => c.content));
      await insertChunks(slice.map((c, j) => ({
        resourceId, accountId: res.accountId, ordinal: c.ordinal,
        content: c.content, section: c.section, tokenCount: c.tokenCount, embedding: embeddings[j]!,
      })));
    }
    await prisma.resource.update({
      where: { id: resourceId },
      data: { status: "ready", meta: { ...((res.meta as object | null) ?? {}), chunkCount: chunks.length } },
    });
  } catch (e) {
    await prisma.resource.update({ where: { id: resourceId }, data: { status: "failed", error: String((e as Error).message ?? e) } });
    throw e; // let pg-boss apply its retry policy
  }
}
