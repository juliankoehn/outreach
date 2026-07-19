// apps/api/src/repos/post.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@outreach/db";
import { upsertPosts, findSimilarPosts } from "./post.js";
import type { RawPost } from "@outreach/core";

let accountId = "";
let userId = "";

beforeAll(async () => {
  userId = `u_${(Date.now()+Math.floor(Math.random()*1e9))}`;
  await prisma.user.create({ data: { id: userId, email: `${userId}@ex.com` } });
  const a = await prisma.linkedInAccount.create({
    data: { userId, memberUrn: `urn:li:person:${(Date.now()+Math.floor(Math.random()*1e9))}`, displayName: "T", accessToken: "enc", scopes: [] },
  });
  accountId = a.id;
});

afterAll(async () => {
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

const post = (over: Partial<RawPost>): RawPost => ({
  externalId: null, text: "hi", mediaType: "none",
  publishedAt: new Date("2025-01-01T00:00:00Z"), raw: {}, ...over,
});

describe("upsertPosts", () => {
  it("inserts new posts and skips duplicates on re-run", async () => {
    const posts = [post({ externalId: "urn:li:share:1" }), post({ externalId: "urn:li:share:2" })];
    const first = await upsertPosts(accountId, "linkedin_api", posts);
    expect(first).toEqual({ inserted: 2, skipped: 0 });

    const second = await upsertPosts(accountId, "linkedin_api", posts);
    expect(second).toEqual({ inserted: 0, skipped: 2 });
  });

  it("dedupes CSV posts without externalId by content hash", async () => {
    const p = post({ text: "unique-body", publishedAt: new Date("2025-02-02T00:00:00Z") });
    await upsertPosts(accountId, "csv_import", [p]);
    const again = await upsertPosts(accountId, "csv_import", [p]);
    expect(again).toEqual({ inserted: 0, skipped: 1 });
  });
});

describe("findSimilarPosts", () => {
  it("surfaces a published post overlapping the query, ignores unrelated ones, and can exclude a draft", async () => {
    await prisma.post.create({
      data: {
        linkedinAccountId: accountId,
        source: "csv_import",
        dedupeHash: `dh_${Date.now() + Math.floor(Math.random() * 1e9)}`,
        text: "Shipping your MVP fast beats chasing perfection. Launch quickly and gather real user feedback.",
        publishedAt: new Date("2025-03-03T00:00:00Z"),
      },
    });

    const hit = await findSimilarPosts(accountId, "writing about shipping an MVP quickly for feedback");
    expect(hit.length).toBeGreaterThan(0);
    expect(hit[0]!.source).toBe("published");
    expect(hit[0]!.similarity).toBeGreaterThan(0.12);
    expect(hit[0]!.excerpt).toContain("MVP");

    const miss = await findSimilarPosts(accountId, "quarterly tax filing deadlines for freelancers abroad");
    expect(miss).toEqual([]);

    const draft = await prisma.draft.create({
      data: { linkedinAccountId: accountId, text: "Shipping your MVP fast beats chasing perfection today." },
    });
    const withDraft = await findSimilarPosts(accountId, "shipping your MVP fast perfection");
    expect(withDraft.some((m) => m.source === "draft")).toBe(true);

    const excluded = await findSimilarPosts(accountId, "shipping your MVP fast perfection", {
      excludeDraftId: draft.id,
    });
    expect(excluded.some((m) => m.source === "draft")).toBe(false);
  });
});
