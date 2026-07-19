import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { ProfileStudioHandlers } from "@outreach/ai";

let capturedHandlers: ProfileStudioHandlers | undefined;

vi.mock("@outreach/ai", () => ({
  nextTurn: vi.fn(async () => "text"),
  streamInterview: vi.fn(async () => new Response(null, { status: 200 })),
  synthesizeProfile: vi.fn(async () => ({})),
  refineProfile: vi.fn(async () => ({})),
  analyzePosts: vi.fn(async () => ({})),
  suggestFacets: vi.fn(async () => []),
  generateImage: vi.fn(async () => ({ base64: "aGVsbG8=", mediaType: "image/png" })),
  streamProfileStudio: vi.fn(async (opts: { handlers: ProfileStudioHandlers }) => {
    capturedHandlers = opts.handlers;
    return new Response(null, { status: 200 });
  }),
}));

vi.mock("../repos/knowledge.js", () => ({
  retrieveKnowledge: vi.fn(async (_accountId: string, query: string) => [
    { id: "c1", resourceId: "r1", resourceName: "guidelines.md", section: "2", content: `passage for ${query}`, score: 0.9 },
  ]),
}));

import { prisma } from "@outreach/db";
import { createApp } from "../app.js";

let userId = "", profileWithAccountId = "", profileNoAccountId = "", cookie = "";
const app = createApp();

async function authedCookie(): Promise<{ cookie: string; email: string }> {
  const email = `pk${Date.now()}${Math.floor(Math.random() * 1e6)}@ex.com`;
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
  const u = await prisma.user.findFirstOrThrow({ where: { email: signup.email } });
  userId = u.id;

  const profWithAcct = await prisma.creatorProfile.create({ data: { userId } });
  profileWithAccountId = profWithAcct.id;
  await prisma.linkedInAccount.create({
    data: {
      userId,
      memberUrn: `urn:li:person:${Date.now()}${Math.floor(Math.random() * 1e9)}`,
      displayName: "T",
      accessToken: "enc",
      scopes: [],
      creatorProfileId: profileWithAccountId,
    },
  });

  const profNoAcct = await prisma.creatorProfile.create({ data: { userId } });
  profileNoAccountId = profNoAcct.id;
});
afterAll(async () => {
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("profile studio agent searchKnowledge handler", () => {
  it("maps retrieveKnowledge hits to {content, section, resourceName} for the profile's account", async () => {
    const res = await app.request(`/profiles/${profileWithAccountId}/studio`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ messages: [] }),
    });
    expect(res.status).toBe(200);
    expect(capturedHandlers).toBeDefined();

    const result = await capturedHandlers!.searchKnowledge("data retention");
    expect(result).toEqual([{ content: "passage for data retention", section: "2", resourceName: "guidelines.md" }]);
  });

  it("returns [] when the profile has no linked account", async () => {
    const res = await app.request(`/profiles/${profileNoAccountId}/studio`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ messages: [] }),
    });
    expect(res.status).toBe(200);
    expect(capturedHandlers).toBeDefined();

    const result = await capturedHandlers!.searchKnowledge("data retention");
    expect(result).toEqual([]);
  });
});
