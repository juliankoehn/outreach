import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@outreach/db";
import {
  listProfiles,
  createProfile,
  getProfileById,
  updateProfileById,
  assignProfileToAccount,
  getAccountProfile,
  getOrCreateInterview,
  appendInterviewMessage,
} from "./profile.js";

let userId = "", accountId = "";
beforeAll(async () => {
  userId = `u_${Date.now() + Math.floor(Math.random() * 1e9)}`;
  await prisma.user.create({ data: { id: userId, email: `${userId}@ex.com` } });
  const a = await prisma.linkedInAccount.create({
    data: {
      userId,
      memberUrn: `urn:li:person:${Date.now() + Math.floor(Math.random() * 1e9)}`,
      displayName: "T",
      accessToken: "enc",
      scopes: [],
    },
  });
  accountId = a.id;
});
afterAll(async () => {
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("profile repo", () => {
  it("creates a profile and lists it with its assigned accounts", async () => {
    const p = await createProfile(userId, "My Voice");
    expect(p.userId).toBe(userId);
    expect(p.name).toBe("My Voice");
    expect(p.status).toBe("draft");

    const assigned = await assignProfileToAccount(p.id, accountId, userId);
    expect(assigned).toBe(true);

    const profiles = await listProfiles(userId);
    const found = profiles.find((x) => x.id === p.id);
    expect(found).toBeDefined();
    expect(found?.accounts).toEqual([{ id: accountId, displayName: "T" }]);
  });

  it("creates + appends an interview keyed by profile", async () => {
    const p = await createProfile(userId);
    const iv = await getOrCreateInterview(p.id);
    expect(iv.messages).toEqual([]);
    await appendInterviewMessage(iv.id, { role: "assistant", content: "hi" });
    await appendInterviewMessage(iv.id, { role: "user", content: "hello" });
    const again = await getOrCreateInterview(p.id);
    expect(again.id).toBe(iv.id);
    expect(again.messages).toHaveLength(2);
  });

  it("ignores id/userId in updateProfileById and keeps the profile owned by the right user", async () => {
    const p = await createProfile(userId);

    const updated = await updateProfileById(p.id, userId, {
      audience: "trusted-value",
      // @ts-expect-error -- intentionally passing disallowed fields to prove they're stripped
      userId: "attacker",
      id: "hijacked-id",
    });

    expect(updated.id).toBe(p.id);
    expect(updated.userId).toBe(userId);
    expect(updated.audience).toBe("trusted-value");

    const reread = await getProfileById(p.id, userId);
    expect(reread?.audience).toBe("trusted-value");
  });

  it("assignProfileToAccount returns false for a cross-user profile or account", async () => {
    const otherUserId = `u_other_${Date.now() + Math.floor(Math.random() * 1e9)}`;
    await prisma.user.create({ data: { id: otherUserId, email: `${otherUserId}@ex.com` } });
    const otherAccount = await prisma.linkedInAccount.create({
      data: {
        userId: otherUserId,
        memberUrn: `urn:li:person:other:${Date.now() + Math.floor(Math.random() * 1e9)}`,
        displayName: "O",
        accessToken: "enc",
        scopes: [],
      },
    });

    const p = await createProfile(userId);

    // Cross-user account: profile belongs to userId, account belongs to otherUserId.
    expect(await assignProfileToAccount(p.id, otherAccount.id, userId)).toBe(false);

    // Cross-user profile: account belongs to userId, but profile id doesn't
    // belong to userId (it's owned by otherUserId's own profile lookup).
    const otherProfile = await createProfile(otherUserId);
    expect(await assignProfileToAccount(otherProfile.id, accountId, userId)).toBe(false);

    await prisma.user.delete({ where: { id: otherUserId } });
  });

  it("getAccountProfile resolves the account's assigned profile", async () => {
    const p = await createProfile(userId);
    const acc = await prisma.linkedInAccount.create({
      data: {
        userId,
        memberUrn: `urn:li:person:resolve:${Date.now() + Math.floor(Math.random() * 1e9)}`,
        displayName: "R",
        accessToken: "enc",
        scopes: [],
      },
    });
    expect(await getAccountProfile(acc.id)).toBeNull();

    await assignProfileToAccount(p.id, acc.id, userId);
    const resolved = await getAccountProfile(acc.id);
    expect(resolved?.id).toBe(p.id);
  });
});
