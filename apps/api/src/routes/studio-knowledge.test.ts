import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { StudioAgentHandlers } from "@outreach/ai";

let capturedHandlers: StudioAgentHandlers | undefined;

vi.mock("@outreach/ai", () => ({
  formatInsights: vi.fn(() => undefined),
  draftPost: vi.fn(async () => "text"),
  refinePost: vi.fn(async () => "text"),
  generateImage: vi.fn(async () => ({ base64: "aGVsbG8=", mediaType: "image/png" })),
  composeVisualLanguage: vi.fn(() => ""),
  isImageProviderEnabled: vi.fn(() => false),
  streamStudioAgent: vi.fn(async (opts: { handlers: StudioAgentHandlers }) => {
    capturedHandlers = opts.handlers;
    return new Response(null, { status: 200 });
  }),
}));

vi.mock("../repos/knowledge.js", () => ({
  retrieveKnowledge: vi.fn(async (_accountId: string, query: string) => [
    { id: "c1", resourceId: "r1", resourceName: "ISO 27001.pdf", section: "3.2", content: `passage for ${query}`, score: 0.9 },
    { id: "c2", resourceId: "r1", resourceName: "ISO 27001.pdf", section: null, content: `second passage for ${query}`, score: 0.8 },
  ]),
}));

import { prisma } from "@outreach/db";
import { createApp } from "../app.js";

let userId = "", accountId = "", draftId = "", cookie = "";
const app = createApp();

async function authed(): Promise<{ cookie: string; email: string }> {
  const email = `sk${Date.now()}${Math.floor(Math.random() * 1e6)}@ex.com`;
  const res = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: process.env.WEB_ORIGIN! },
    body: JSON.stringify({ email, password: "password-1234", name: "S" }),
  });
  return { cookie: res.headers.get("set-cookie")!.split(";")[0]!, email };
}

beforeAll(async () => {
  const a = await authed();
  cookie = a.cookie;
  const u = await prisma.user.findUniqueOrThrow({ where: { email: a.email } });
  userId = u.id;
  const acc = await prisma.linkedInAccount.create({
    data: { userId, memberUrn: `urn:li:person:${Date.now()}${Math.floor(Math.random() * 1e9)}`, displayName: "T", accessToken: "enc", scopes: [] },
  });
  accountId = acc.id;
  const draft = await prisma.draft.create({ data: { linkedinAccountId: accountId, text: "hello" } });
  draftId = draft.id;
});
afterAll(async () => {
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("studio agent searchKnowledge handler", () => {
  it("maps retrieveKnowledge hits to {content, section, resourceName}", async () => {
    const res = await app.request(`/studio/${accountId}/drafts/${draftId}/agent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ messages: [] }),
    });
    expect(res.status).toBe(200);
    expect(capturedHandlers).toBeDefined();

    const result = await capturedHandlers!.searchKnowledge("encryption at rest");
    expect(result).toEqual([
      { content: "passage for encryption at rest", section: "3.2", resourceName: "ISO 27001.pdf" },
      { content: "second passage for encryption at rest", section: null, resourceName: "ISO 27001.pdf" },
    ]);
  });
});
