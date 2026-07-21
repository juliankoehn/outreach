import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@outreach/db";
import { encrypt } from "@outreach/core";
import { env } from "../env.js";
import { enrichAccountMetrics } from "./enrich.js";

let accountId = "", userId = "", postId = "";

beforeAll(async () => {
  userId = `u_enrich_analysis_${Date.now()}`;
  const user = await prisma.user.create({ data: { id: userId, email: `en${Date.now()}@ex.com`, name: "t" } });
  const acct = await prisma.linkedInAccount.create({
    data: { userId, memberUrn: `urn:li:person:e${Date.now()}`, displayName: "T",
      accessToken: encrypt("tok", env.ENCRYPTION_KEY), scopes: [] },
  });
  accountId = acct.id;
  const post = await prisma.post.create({
    data: { linkedinAccountId: accountId, source: "linkedin_api", dedupeHash: `he${Date.now()}`,
      text: "hi", mediaType: "none", publishedAt: new Date(), externalId: `urn:li:share:${Date.now()}` },
  });
  postId = post.id;
});
afterAll(async () => { await prisma.user.delete({ where: { id: userId } }); });

const deps = (impr: number, analyzeSpy: () => void) => ({
  makeClient: () => ({ forPost: async () => ({ impressions: impr, reactions: 2, comments: 1, reshares: 0 }) }),
  analyzePost: async (input: unknown) => { analyzeSpy(); return {
    performance: { summary: "s", verdict: "on-par" as const }, teardown: { hook: "h", structure: "s", pillar: "p", format: "f", cta: "c", toneMatch: "t" }, goalFit: "g", learnings: ["l1"],
  }; },
});

describe("enrichAccountMetrics + analysis", () => {
  it("analyses on first enrich and stores basis", async () => {
    const spy = vi.fn();
    const r = await enrichAccountMetrics(accountId, userId, { deps: deps(500, spy) });
    expect(r.analyzed).toBe(1);
    expect(spy).toHaveBeenCalledTimes(1);
    const p = await prisma.post.findUnique({ where: { id: postId } });
    expect((p!.analysis as { basis: { impressions: number } }).basis.impressions).toBe(500);
  });
  it("skips re-analysis when impressions are unchanged", async () => {
    const spy = vi.fn();
    const r = await enrichAccountMetrics(accountId, userId, { deps: deps(500, spy) });
    expect(spy).not.toHaveBeenCalled();
    expect(r.analyzed).toBe(0);
  });
  it("re-analyses when impressions changed", async () => {
    const spy = vi.fn();
    await enrichAccountMetrics(accountId, userId, { deps: deps(900, spy) });
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it("force re-analyses even when unchanged", async () => {
    const spy = vi.fn();
    await enrichAccountMetrics(accountId, userId, { force: true, deps: deps(900, spy) });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
