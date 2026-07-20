import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@outreach/db";
import { encrypt } from "@outreach/core";
import { postsToEnrichRecent, accountsWithRecentPublished, metricsForExternalId } from "../repos/post.js";
import { enrichAccountMetrics } from "./enrich.js";
import { env } from "../env.js";

const userId = `u_enrich_${Date.now()}`;
let accountId = "";

beforeAll(async () => {
  await prisma.user.create({ data: { id: userId, email: `${userId}@ex.com` } });
  const a = await prisma.linkedInAccount.create({
    data: { userId, memberUrn: `urn:${userId}`, displayName: "Enrich Acct", accessToken: encrypt("tok", env.ENCRYPTION_KEY), scopes: [], status: "active" },
  });
  accountId = a.id;
  const now = Date.now();
  await prisma.post.createMany({
    data: [
      // recent, has URN — enrichable
      { linkedinAccountId: accountId, source: "published", externalId: "urn:li:share:1", dedupeHash: "h1", text: "recent", mediaType: "none", publishedAt: new Date(now - 2 * 86400e3) },
      { linkedinAccountId: accountId, source: "published", externalId: "urn:li:share:2", dedupeHash: "h2", text: "recent2", mediaType: "none", publishedAt: new Date(now - 5 * 86400e3) },
      // old — outside the 30d window
      { linkedinAccountId: accountId, source: "csv_import", externalId: "urn:li:share:3", dedupeHash: "h3", text: "old", mediaType: "none", publishedAt: new Date(now - 90 * 86400e3) },
      // recent but no URN — cannot enrich
      { linkedinAccountId: accountId, source: "manual", externalId: null, dedupeHash: "h4", text: "nourn", mediaType: "none", publishedAt: new Date(now - 1 * 86400e3) },
    ],
  });
});

afterAll(async () => {
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("performance-loop enrichment", () => {
  const since = new Date(Date.now() - 30 * 86400e3);

  it("postsToEnrichRecent returns only URN posts within the window", async () => {
    const targets = await postsToEnrichRecent(accountId, since);
    const urns = targets.map((t) => t.externalId).sort();
    expect(urns).toEqual(["urn:li:share:1", "urn:li:share:2"]);
  });

  it("accountsWithRecentPublished includes an active account with a recent URN post", async () => {
    const accts = await accountsWithRecentPublished(since);
    expect(accts.find((a) => a.id === accountId)).toBeTruthy();
  });

  it("enrichAccountMetrics enriches each recent post via the injected client (no network) and tolerates a failure", async () => {
    const forPost = vi.fn(async (urn: string) => {
      if (urn === "urn:li:share:2") throw new Error("rate limited");
      return { impressions: 100, membersReached: 80, reactions: 9, comments: 2, reshares: 1 };
    });
    const res = await enrichAccountMetrics(accountId, userId, {
      since,
      deps: { makeClient: () => ({ forPost }) },
    });
    expect(res.total).toBe(2);
    expect(res.enriched).toBe(1);
    expect(res.failed).toBe(1);
    expect(forPost).toHaveBeenCalledTimes(2);

    const stored = await metricsForExternalId(accountId, "urn:li:share:1");
    expect(stored).toMatchObject({ impressions: 100, reactions: 9 });
  });
});
