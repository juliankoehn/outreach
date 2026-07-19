import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@outreach/db";
import { insertChunks, searchChunks, deleteChunksForResource } from "./chunk.js";

let userId = "", accountId = "", resourceId = "";
function vec(seed: number): number[] { return Array.from({ length: 3072 }, (_, i) => Math.sin(seed + i * 0.001)); }

beforeAll(async () => {
  const u = await prisma.user.create({ data: { id: `u${Date.now()}`, email: `c${Date.now()}@ex.com`, name: "C" } });
  userId = u.id;
  const a = await prisma.linkedInAccount.create({ data: { userId, memberUrn: `urn:li:person:${Date.now()}`, displayName: "T", accessToken: "e", scopes: [] } });
  accountId = a.id;
  const r = await prisma.resource.create({ data: { accountId, kind: "document", name: "norm.pdf", mimeType: "application/pdf", sizeBytes: 1, storageKey: "k", status: "ready" } });
  resourceId = r.id;
});
afterAll(async () => { await prisma.user.delete({ where: { id: userId } }); await prisma.$disconnect(); });

describe("chunk repo", () => {
  it("inserts chunks and cosine-searches nearest first, scoped by account", async () => {
    await insertChunks([
      { resourceId, accountId, ordinal: 0, content: "alpha passage", section: "A", tokenCount: 2, embedding: vec(1) },
      { resourceId, accountId, ordinal: 1, content: "beta passage", section: "B", tokenCount: 2, embedding: vec(50) },
    ]);
    const hits = await searchChunks(accountId, vec(1), 2);
    expect(hits.length).toBe(2);
    expect(hits[0]!.content).toBe("alpha passage");
    expect(hits[0]!.resourceName).toBe("norm.pdf");
    // other account sees nothing
    expect((await searchChunks("nope", vec(1), 2)).length).toBe(0);
    await deleteChunksForResource(resourceId);
    expect((await searchChunks(accountId, vec(1), 2)).length).toBe(0);
  });
});
