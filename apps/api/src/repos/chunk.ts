import { prisma } from "@outreach/db";

export interface ChunkInsert {
  resourceId: string; accountId: string; ordinal: number;
  content: string; section?: string | null; tokenCount: number; embedding: number[];
}
export interface ChunkHit {
  id: string; resourceId: string; resourceName: string;
  section: string | null; content: string; score: number;
}

const toVec = (e: number[]) => `[${e.join(",")}]`;

export async function insertChunks(rows: ChunkInsert[]): Promise<void> {
  // Insert one row at a time with a parameterized halfvec cast. (Row counts are
  // modest per batch; the ingestion job batches upstream.)
  for (const r of rows) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "ResourceChunk" ("id","resourceId","accountId","ordinal","content","section","tokenCount","embedding","createdAt")
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7::halfvec, now())`,
      r.resourceId, r.accountId, r.ordinal, r.content, r.section ?? null, r.tokenCount, toVec(r.embedding),
    );
  }
}

export async function searchChunks(accountId: string, embedding: number[], topK: number): Promise<ChunkHit[]> {
  return prisma.$queryRawUnsafe<ChunkHit[]>(
    `SELECT c."id", c."resourceId", r."name" AS "resourceName", c."section", c."content",
            1 - (c."embedding" <=> $1::halfvec) AS "score"
     FROM "ResourceChunk" c
     JOIN "Resource" r ON r."id" = c."resourceId"
     WHERE c."accountId" = $2 AND r."status" = 'ready'
     ORDER BY c."embedding" <=> $1::halfvec
     LIMIT $3`,
    toVec(embedding), accountId, topK,
  );
}

export async function deleteChunksForResource(resourceId: string): Promise<void> {
  await prisma.$executeRawUnsafe(`DELETE FROM "ResourceChunk" WHERE "resourceId" = $1`, resourceId);
}
