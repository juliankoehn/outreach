// apps/api/src/routes/profile.test.ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@outreach/ai", () => ({
  nextTurn: vi.fn(async () => "What's your unique point of view?"),
  synthesizeProfile: vi.fn(async () => ({
    goals: ["g"], audience: "a", pillars: ["p"], noGos: [], toneWords: ["direct"],
    languages: ["en"], positioning: "pos", brandBrief: "Write as...",
  })),
  analyzePosts: vi.fn(async () => ({ voiceSummary: "v", themes: ["t"], styleTraits: [], cadence: "weekly", topPatterns: ["x"] })),
}));

import { prisma } from "@outreach/db";
import { createApp } from "../app.js";

let userId = "", accountId = "", cookie = "";
const app = createApp();

async function authedCookie(): Promise<{ cookie: string; email: string }> {
  const email = `p${(Date.now()+Math.floor(Math.random()*1e9))}-${Math.random().toString(36).slice(2)}@ex.com`;
  const res = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: process.env.WEB_ORIGIN! },
    body: JSON.stringify({ email, password: "password-1234", name: "P" }),
  });
  return { cookie: res.headers.get("set-cookie")!.split(";")[0]!, email };
}

beforeAll(async () => {
  const signup = await authedCookie();
  cookie = signup.cookie;
  // Look up the user by the exact sign-up email rather than "most recent",
  // so parallel/concurrent test runs can't race us onto the wrong user.
  const u = await prisma.user.findFirstOrThrow({ where: { email: signup.email } });
  userId = u.id;
  const a = await prisma.linkedInAccount.create({
    data: { userId, memberUrn: `urn:li:person:${(Date.now()+Math.floor(Math.random()*1e9))}`, displayName: "T", accessToken: "enc", scopes: [] },
  });
  accountId = a.id;
});
afterAll(async () => { await prisma.user.delete({ where: { id: userId } }); await prisma.$disconnect(); });

describe("profile routes", () => {
  it("creates a profile, lists it, runs the interview to finalize, and assigns it to an account", async () => {
    const create = await app.request("/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ name: "My Voice" }),
    });
    expect(create.status).toBe(200);
    const { profile } = (await create.json()) as { profile: { id: string; name: string } };
    expect(profile.name).toBe("My Voice");

    const list = await app.request("/profiles", { headers: { Cookie: cookie } });
    expect(list.status).toBe(200);
    const { profiles } = (await list.json()) as { profiles: Array<{ id: string }> };
    expect(profiles.some((p) => p.id === profile.id)).toBe(true);

    // The interview is streaming now; /start seeds the opener as a UI message.
    const start = await app.request(`/profiles/${profile.id}/interview/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ locale: "en" }),
    });
    expect(start.status).toBe(200);
    const startBody = (await start.json()) as {
      messages: Array<{ role: string; parts: Array<{ text?: string }> }>;
    };
    expect(startBody.messages[0]?.parts?.[0]?.text).toMatch(/point of view/i);

    const fin = await app.request(`/profiles/${profile.id}/interview/finalize`, {
      method: "POST", headers: { Cookie: cookie },
    });
    expect(fin.status).toBe(200);
    const finBody = (await fin.json()) as { profile: { status: string } };
    expect(finBody.profile.status).toBe("ready");

    const assign = await app.request(`/profiles/${profile.id}/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ accountId }),
    });
    expect(assign.status).toBe(200);
    expect((await assign.json()) as { ok: boolean }).toEqual({ ok: true });

    const unassign = await app.request(`/profiles/${profile.id}/unassign`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ accountId }),
    });
    expect(unassign.status).toBe(200);
    expect((await unassign.json()) as { ok: boolean }).toEqual({ ok: true });
  });

  it("rejects a cross-user profile", async () => {
    const create = await app.request("/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({}),
    });
    const { profile } = (await create.json()) as { profile: { id: string } };

    const other = await authedCookie();
    const res = await app.request(`/profiles/${profile.id}`, { headers: { Cookie: other.cookie } });
    expect(res.status).toBe(404);
  });
});
