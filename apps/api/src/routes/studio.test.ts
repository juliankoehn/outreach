import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@outreach/ai", () => ({
  draftPost: vi.fn(async () => "A strong hook.\n\nBody of the post."),
  generateImage: vi.fn(async () => ({ base64: Buffer.from("img").toString("base64"), mediaType: "image/png" })),
}));

import { prisma } from "@outreach/db";
import { createApp } from "../app.js";

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
    expect(imageUrl).toMatch(/^\/uploads\//);

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
