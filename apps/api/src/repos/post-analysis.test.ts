import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@outreach/db";
import { getPostDetail, setPostAnalysis } from "./post.js";

let accountId = "", postId = "", userId = "";

beforeAll(async () => {
  userId = `u_${Date.now() + Math.floor(Math.random() * 1e9)}`;
  await prisma.user.create({ data: { id: userId, email: `${userId}@ex.com`, name: "t" } });
  const acct = await prisma.linkedInAccount.create({
    data: { userId, memberUrn: `urn:li:person:${Date.now()}`, displayName: "T", accessToken: "x", scopes: [] },
  });
  accountId = acct.id;
  const post = await prisma.post.create({
    data: {
      linkedinAccountId: accountId, source: "linkedin_api", dedupeHash: `h${Date.now()}`,
      text: "hello", mediaType: "none", publishedAt: new Date(),
      metrics: { impressions: 100, reactions: 5 }, raw: { imageUrl: "/generated/x.jpg" },
    },
  });
  postId = post.id;
});

afterAll(async () => {
  await prisma.user.delete({ where: { id: userId } });
});

describe("getPostDetail / setPostAnalysis", () => {
  it("returns the post with imageUrl flattened and null analysis initially", async () => {
    const d = await getPostDetail(accountId, postId);
    expect(d?.text).toBe("hello");
    expect(d?.imageUrl).toBe("/generated/x.jpg");
    expect(d?.analysis).toBeNull();
  });
  it("stores + reads back an analysis with analyzedAt", async () => {
    await setPostAnalysis(postId, { performance: { verdict: "over" }, basis: { impressions: 100 } });
    const d = await getPostDetail(accountId, postId);
    expect((d?.analysis as { basis?: { impressions?: number } }).basis?.impressions).toBe(100);
    expect(d?.analyzedAt).toBeInstanceOf(Date);
  });
  it("scopes by account (foreign account → null)", async () => {
    expect(await getPostDetail("nope", postId)).toBeNull();
  });
});
