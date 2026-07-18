import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@outreach/db";
import { getOrCreateInterview, appendInterviewMessage, upsertProfile, getProfile } from "./profile.js";

let userId = "", accountId = "";
beforeAll(async () => {
  userId = `u_${Date.now()}`;
  await prisma.user.create({ data: { id: userId, email: `${userId}@ex.com` } });
  const a = await prisma.linkedInAccount.create({
    data: { userId, memberUrn: `urn:li:person:${Date.now()}`, displayName: "T", accessToken: "enc", scopes: [] },
  });
  accountId = a.id;
});
afterAll(async () => { await prisma.user.delete({ where: { id: userId } }); await prisma.$disconnect(); });

describe("profile repo", () => {
  it("creates + appends an interview", async () => {
    const iv = await getOrCreateInterview(accountId);
    expect(iv.messages).toEqual([]);
    await appendInterviewMessage(iv.id, { role: "assistant", content: "hi" });
    await appendInterviewMessage(iv.id, { role: "user", content: "hello" });
    const again = await getOrCreateInterview(accountId);
    expect(again.id).toBe(iv.id);
    expect(again.messages).toHaveLength(2);
  });

  it("upserts + reads a profile", async () => {
    await upsertProfile(accountId, { goals: ["g"], audience: "a", brandBrief: "b", status: "ready" });
    const p = await getProfile(accountId);
    expect(p?.status).toBe("ready");
    expect(p?.brandBrief).toBe("b");
  });
});
