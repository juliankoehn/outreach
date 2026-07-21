import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@outreach/ai", async (orig) => ({
  ...(await orig<typeof import("@outreach/ai")>()),
  analyzePost: vi.fn(async () => ({
    performance: { summary: "s", verdict: "over" },
    teardown: { hook: "h", structure: "s", pillar: "AI", format: "f", cta: "c", toneMatch: "t" },
    goalFit: "g", learnings: ["Contrarian hooks win", "Keep it short"],
  })),
}));

import { prisma } from "@outreach/db";
import { createApp } from "../app.js";

let userId = "", accountId = "", postId = "", cookie = "";
const app = createApp();

async function authed(): Promise<{ cookie: string; email: string }> {
  const email = `s${(Date.now()+Math.floor(Math.random()*1e9))}${Math.floor(Math.random() * 1e6)}@ex.com`;
  const res = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: process.env.WEB_ORIGIN! },
    body: JSON.stringify({ email, password: "password-1234", name: "S" }),
  });
  return { cookie: res.headers.get("set-cookie")!.split(";")[0]!, email };
}

beforeAll(async () => {
  const a = await authed(); cookie = a.cookie;
  const u = await prisma.user.findUniqueOrThrow({ where: { email: a.email } });
  userId = u.id;
  const acc = await prisma.linkedInAccount.create({
    data: { userId, memberUrn: `urn:li:person:${(Date.now()+Math.floor(Math.random()*1e9))}`, displayName: "T", accessToken: "enc", scopes: [] },
  });
  accountId = acc.id;
  const prof = await prisma.creatorProfile.create({
    data: {
      userId,
      status: "ready",
      brandBrief: "Write as X.",
      derived: { voiceSummary: "", visualStyle: "", themes: [], styleTraits: [], cadence: "", topPatterns: [] },
    },
  });
  await prisma.linkedInAccount.update({ where: { id: accountId }, data: { creatorProfileId: prof.id } });
  const post = await prisma.post.create({
    data: {
      linkedinAccountId: accountId,
      source: "linkedin_api",
      externalId: `urn:li:activity:${Date.now()}`,
      dedupeHash: `hash-${Date.now()}`,
      text: "A post about AI governance.",
      mediaType: "none",
      publishedAt: new Date(),
      metrics: { impressions: 1000, reactions: 30, comments: 10, reshares: 5 },
    },
  });
  postId = post.id;
});
afterAll(async () => { await prisma.user.delete({ where: { id: userId } }); await prisma.$disconnect(); });

describe("post detail + analyze + learnings", () => {
  it("GET detail returns the post + computed engagementRate", async () => {
    const res = await app.request(`/linkedin/accounts/${accountId}/posts/${postId}`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const { post } = (await res.json()) as { post: { engagementRate: number } };
    expect(post.engagementRate).toBeCloseTo(0.045);
  });

  it("POST analyze stores an analysis", async () => {
    const res = await app.request(`/linkedin/accounts/${accountId}/posts/${postId}/analyze`, { method: "POST", headers: { cookie } });
    expect(res.status).toBe(200);
    const { post } = (await res.json()) as { post: { analysis: { learnings: string[] } } };
    expect(post.analysis.learnings).toContain("Contrarian hooks win");
  });

  it("POST learnings merges accepted into the profile's derived.topPatterns", async () => {
    const res = await app.request(`/linkedin/accounts/${accountId}/posts/${postId}/learnings`, {
      method: "POST", headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ accepted: ["Contrarian hooks win", "contrarian hooks win"] }),
    });
    expect(res.status).toBe(200);
    const { topPatterns } = (await res.json()) as { topPatterns: string[] };
    // dedupe (case-insensitive) → one entry
    expect(topPatterns.filter((p: string) => p.toLowerCase() === "contrarian hooks win").length).toBe(1);
  });
});
