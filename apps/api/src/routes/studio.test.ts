import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@outreach/ai", () => ({
  formatInsights: vi.fn(() => undefined),
  draftPost: vi.fn(async () => "A strong hook.\n\nBody of the post."),
  generateImage: vi.fn(async () => ({ base64: Buffer.from("img").toString("base64"), mediaType: "image/png" })),
  composeVisualLanguage: vi.fn(() => ""),
  isImageProviderEnabled: vi.fn(() => false),
  enabledImageProviders: vi.fn(() => []),
}));

import { prisma } from "@outreach/db";
import { encrypt } from "@outreach/core";
import { createApp } from "../app.js";
import { env } from "../env.js";

let userId = "", accountId = "", cookie = "";
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
  const prof = await prisma.creatorProfile.create({ data: { userId, status: "ready", brandBrief: "Write as X." } });
  await prisma.linkedInAccount.update({ where: { id: accountId }, data: { creatorProfileId: prof.id } });
});
afterAll(async () => { await prisma.user.delete({ where: { id: userId } }); await prisma.$disconnect(); });

describe("studio routes", () => {
  it("drafts text, generates an image, saves + lists a draft", async () => {
    const t = await app.request(`/studio/${accountId}/draft-text`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ topic: "AI governance" }),
    });
    expect(t.status).toBe(200);
    const text = ((await t.json()) as { text: string }).text;

    const img = await app.request(`/studio/${accountId}/draft-image`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ prompt: "poster" }),
    });
    const imageUrl = ((await img.json()) as { imageUrl: string }).imageUrl;
    expect(imageUrl).toMatch(/^\/generated\//);

    const save = await app.request(`/studio/${accountId}/drafts`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ text, imageUrl }),
    });
    expect(save.status).toBe(200);

    const list = await app.request(`/studio/${accountId}/drafts`, { headers: { Cookie: cookie } });
    expect(((await list.json()) as { drafts: unknown[] }).drafts.length).toBe(1);
  });

  it("draft-text 400s without a ready profile", async () => {
    const other = await authed();
    const u = await prisma.user.findUniqueOrThrow({ where: { email: other.email } });
    const acc = await prisma.linkedInAccount.create({
      data: { userId: u.id, memberUrn: `urn:li:person:${(Date.now()+Math.floor(Math.random()*1e9)) + 1}`, displayName: "N", accessToken: "e", scopes: [] },
    });
    const res = await app.request(`/studio/${acc.id}/draft-text`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: other.cookie }, body: "{}",
    });
    expect(res.status).toBe(400);
    await prisma.user.delete({ where: { id: u.id } });
  });
});

describe("schedule endpoints", () => {
  let draftId = "";

  async function req(path: string, body: unknown) {
    return app.request(`/studio/${accountId}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(body),
    });
  }

  beforeAll(async () => {
    const res = await app.request(`/studio/${accountId}/drafts`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ text: "schedulable draft" }),
    });
    const { draft } = (await res.json()) as { draft: { id: string } };
    draftId = draft.id;
  });

  it("schedules a draft in the future", async () => {
    const when = new Date(Date.now() + 86400e3).toISOString();
    const res = await req(`/drafts/${draftId}/schedule`, { scheduledAt: when });
    expect(res.status).toBe(200);
    const { draft } = (await res.json()) as { draft: { status: string } };
    expect(draft.status).toBe("scheduled");
  });

  it("rejects a past schedule with 400", async () => {
    const past = new Date(Date.now() - 86400e3).toISOString();
    const res = await req(`/drafts/${draftId}/schedule`, { scheduledAt: past });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid datetime with 400", async () => {
    const res = await req(`/drafts/${draftId}/schedule`, { scheduledAt: "not-a-date" });
    expect(res.status).toBe(400);
  });

  it("unschedules back to draft", async () => {
    const when = new Date(Date.now() + 86400e3).toISOString();
    await req(`/drafts/${draftId}/schedule`, { scheduledAt: when });
    const res = await req(`/drafts/${draftId}/unschedule`, {});
    expect(res.status).toBe(200);
    const { draft } = (await res.json()) as { draft: { status: string } };
    expect(draft.status).toBe("draft");
  });
});

describe("publish endpoint", () => {
  let draftId = "";

  beforeAll(async () => {
    const res = await app.request(`/studio/${accountId}/drafts`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ text: "publishable draft" }),
    });
    const { draft } = (await res.json()) as { draft: { id: string } };
    draftId = draft.id;
  });

  it("404s when the draft doesn't belong to the account owned by another user", async () => {
    const other = await authed();
    const u = await prisma.user.findUniqueOrThrow({ where: { email: other.email } });
    const acc = await prisma.linkedInAccount.create({
      data: { userId: u.id, memberUrn: `urn:li:person:${(Date.now()+Math.floor(Math.random()*1e9)) + 2}`, displayName: "F", accessToken: "e", scopes: [] },
    });
    const res = await app.request(`/studio/${acc.id}/drafts/${draftId}/publish`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: other.cookie },
    });
    expect(res.status).toBe(404);
    await prisma.user.delete({ where: { id: u.id } });
  });

  it("404s for an unknown draft id", async () => {
    const res = await app.request(`/studio/${accountId}/drafts/does-not-exist/publish`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
    });
    expect(res.status).toBe(404);
  });

  // Proves the route is actually wired (matched, passes both ownership guards,
  // and reaches publishDraft) without making any network call: the seeded
  // account has no tokenExpiresAt and no refreshToken, so publishDraft fails at
  // the token-refresh step and returns a "failed" draft *before* constructing
  // the LinkedIn client or issuing a fetch. If the route were missing or
  // mistyped, Hono would 404 instead of returning 200 here.
  it("reaches publishDraft and returns a failed draft when the account needs token refresh with no refresh token (no network call)", async () => {
    const acc = await prisma.linkedInAccount.create({
      data: {
        userId,
        memberUrn: `urn:li:person:${(Date.now()+Math.floor(Math.random()*1e9)) + 3}`,
        displayName: "NR",
        accessToken: encrypt("dummy-access-token", env.ENCRYPTION_KEY),
        scopes: [],
      },
    });
    const res = await app.request(`/studio/${acc.id}/drafts`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ text: "no-refresh-token draft" }),
    });
    const { draft: created } = (await res.json()) as { draft: { id: string } };

    const pub = await app.request(`/studio/${acc.id}/drafts/${created.id}/publish`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
    });
    expect(pub.status).toBe(200);
    const { draft } = (await pub.json()) as { draft: { status: string } };
    expect(draft.status).toBe("failed");
  });
});
