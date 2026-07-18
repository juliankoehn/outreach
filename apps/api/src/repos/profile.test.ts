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

  it("ignores a linkedinAccountId in the body and never writes/reassigns another account's profile", async () => {
    const otherUserId = `u_other_${Date.now()}`;
    await prisma.user.create({ data: { id: otherUserId, email: `${otherUserId}@ex.com` } });
    const other = await prisma.linkedInAccount.create({
      data: {
        userId: otherUserId,
        memberUrn: `urn:li:person:other:${Date.now()}`,
        displayName: "O",
        accessToken: "enc",
        scopes: [],
      },
    });

    await upsertProfile(accountId, {
      audience: "trusted-account-value",
      // @ts-expect-error -- intentionally passing disallowed fields to prove they're stripped
      linkedinAccountId: other.id,
      id: "hijacked-id",
    });

    const otherProfile = await getProfile(other.id);
    expect(otherProfile).toBeNull();

    const ownProfile = await getProfile(accountId);
    expect(ownProfile?.linkedinAccountId).toBe(accountId);
    expect(ownProfile?.audience).toBe("trusted-account-value");

    await prisma.user.delete({ where: { id: otherUserId } });
  });
});
