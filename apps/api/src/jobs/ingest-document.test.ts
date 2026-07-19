import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@outreach/db";
import { putObject } from "../storage.js";
import { ingestDocument } from "./ingest-document.js";
import { searchChunks } from "../repos/chunk.js";

let userId = "", accountId = "", resourceId = "", key = "";
beforeAll(async () => {
  const u = await prisma.user.create({ data: { id: `u${Date.now()}`, email: `i${Date.now()}@ex.com`, name: "I" } });
  userId = u.id;
  accountId = (await prisma.linkedInAccount.create({ data: { userId, memberUrn: `urn:li:person:${Date.now()}`, displayName: "T", accessToken: "e", scopes: [] } })).id;
  key = `resources/${accountId}/${Date.now()}.md`;
  await putObject(key, Buffer.from("# Norm A\n" + "compliance ".repeat(300) + "\n## Norm B\ntail"), "text/markdown");
  resourceId = (await prisma.resource.create({ data: { accountId, kind: "document", name: "norm.md", mimeType: "text/markdown", sizeBytes: 10, storageKey: key, status: "pending" } })).id;
});
afterAll(async () => { await prisma.user.delete({ where: { id: userId } }); await prisma.$disconnect(); });

describe.skipIf(!process.env.OPENAI_API_KEY)("ingestDocument", () => {
  it("extracts, chunks, embeds, inserts, marks ready", async () => {
    await ingestDocument(resourceId);
    const res = await prisma.resource.findUniqueOrThrow({ where: { id: resourceId } });
    expect(res.status).toBe("ready");
    expect((res.meta as { chunkCount?: number }).chunkCount).toBeGreaterThan(0);
    // a query embedding retrieves at least one chunk for this account
    // (uses the real embedding model — requires OPENAI_API_KEY in env)
    const { embedQuery } = await import("@outreach/ai");
    const hits = await searchChunks(accountId, await embedQuery("compliance norm"), 3);
    expect(hits.length).toBeGreaterThan(0);
  });
});
