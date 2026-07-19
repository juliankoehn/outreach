import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@outreach/ai", () => ({
  draftPost: vi.fn(async () => "A strong hook.\n\nBody of the post."),
  generateImage: vi.fn(async () => ({ base64: Buffer.from("img").toString("base64"), mediaType: "image/png" })),
}));

import { prisma } from "@outreach/db";
import { createApp } from "../app.js";

let userId = "", accountId = "", cookie = "", draftId = "";
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

const FUTURE = new Date(Date.now() + 5 * 86400e3);

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

  const draftRes = await app.request(`/studio/${accountId}/drafts`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ text: "calendar seed draft" }),
  });
  const { draft } = (await draftRes.json()) as { draft: { id: string } };
  draftId = draft.id;

  const schedRes = await app.request(`/studio/${accountId}/drafts/${draftId}/schedule`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ scheduledAt: FUTURE.toISOString() }),
  });
  expect(schedRes.status).toBe(200);
});

afterAll(async () => { await prisma.user.delete({ where: { id: userId } }); await prisma.$disconnect(); });

describe("schedule calendar route", () => {
  it("returns the scheduled draft within range", async () => {
    const from = new Date(Date.now()).toISOString();
    const to = new Date(Date.now() + 10 * 86400e3).toISOString();
    const res = await app.request(`/schedule/calendar?from=${from}&to=${to}`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const { events } = (await res.json()) as { events: { id: string }[] };
    expect(events.some((e) => e.id === draftId)).toBe(true);
  });

  it("returns no events out of range", async () => {
    const from = new Date(Date.now() + 30 * 86400e3).toISOString();
    const to = new Date(Date.now() + 40 * 86400e3).toISOString();
    const res = await app.request(`/schedule/calendar?from=${from}&to=${to}`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const { events } = (await res.json()) as { events: unknown[] };
    expect(events).toEqual([]);
  });

  it("filters by accountId", async () => {
    const from = new Date(Date.now()).toISOString();
    const to = new Date(Date.now() + 10 * 86400e3).toISOString();
    const res = await app.request(`/schedule/calendar?from=${from}&to=${to}&accountId=${accountId}`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const { events } = (await res.json()) as { events: { id: string }[] };
    expect(events.some((e) => e.id === draftId)).toBe(true);

    const otherRes = await app.request(`/schedule/calendar?from=${from}&to=${to}&accountId=nonexistent-account`, {
      headers: { Cookie: cookie },
    });
    expect(otherRes.status).toBe(200);
    const { events: otherEvents } = (await otherRes.json()) as { events: unknown[] };
    expect(otherEvents).toEqual([]);
  });

  it("400s when from/to are missing", async () => {
    const res = await app.request(`/schedule/calendar`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(400);
  });
});
