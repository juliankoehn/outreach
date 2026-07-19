import { embedQuery } from "@outreach/ai";
import { searchChunks, type ChunkHit } from "./chunk.js";

export async function retrieveKnowledge(accountId: string, query: string, topK = 6): Promise<ChunkHit[]> {
  const q = query.trim();
  if (!q) return [];
  const embedding = await embedQuery(q);
  return searchChunks(accountId, embedding, topK);
}
