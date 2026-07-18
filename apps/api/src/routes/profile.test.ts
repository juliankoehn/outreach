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
  const email = `p${Date.now()}-${Math.random().toString(36).slice(2)}@ex.com`;
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
    data: { userId, memberUrn: `urn:li:person:${Date.now()}`, displayName: "T", accessToken: "enc", scopes: [] },
  });
  accountId = a.id;
});
afterAll(async () => { await prisma.user.delete({ where: { id: userId } }); await prisma.$disconnect(); });

describe("profile routes", () => {
  it("runs a reply turn and finalizes a profile", async () => {
    const reply = await app.request(`/profile/${accountId}/interview/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ message: "I'm a GRC founder." }),
    });
    expect(reply.status).toBe(200);
    const replyBody = (await reply.json()) as { reply: string };
    expect(replyBody.reply).toMatch(/point of view/i);

    const fin = await app.request(`/profile/${accountId}/interview/finalize`, {
      method: "POST", headers: { Cookie: cookie },
    });
    expect(fin.status).toBe(200);
    const finBody = (await fin.json()) as { profile: { status: string } };
    expect(finBody.profile.status).toBe("ready");
  });

  it("rejects a cross-user account", async () => {
    const other = await authedCookie();
    const res = await app.request(`/profile/${accountId}`, { headers: { Cookie: other.cookie } });
    expect(res.status).toBe(404);
  });
});
