// apps/api/src/publish/due.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@outreach/db";
import { claimDuePublishDrafts, listAccountsNeedingRefresh } from "./due.js";

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

describe("claimDuePublishDrafts", () => {
  it("atomically claims only due scheduled drafts, flipping them to publishing, and leaves others untouched", async () => {
    const due = await prisma.draft.create({
      data: { linkedinAccountId: accountId, text: "due", status: "scheduled", scheduledAt: new Date(Date.now() - 60_000) },
    });
    const future = await prisma.draft.create({
      data: { linkedinAccountId: accountId, text: "future", status: "scheduled", scheduledAt: new Date(Date.now() + 3600_000) },
    });
    const notScheduled = await prisma.draft.create({
      data: { linkedinAccountId: accountId, text: "draft", status: "draft" },
    });

    const claimed = await claimDuePublishDrafts();
    const claimedIds = claimed.map((c) => c.id);

    expect(claimedIds).toContain(due.id);
    expect(claimedIds).not.toContain(future.id);
    expect(claimedIds).not.toContain(notScheduled.id);

    const claimedRow = claimed.find((c) => c.id === due.id)!;
    expect(claimedRow.linkedinAccountId).toBe(accountId);
    expect(claimedRow.userId).toBe(userId);

    const dueAfter = await prisma.draft.findUnique({ where: { id: due.id } });
    expect(dueAfter?.status).toBe("publishing");

    const futureAfter = await prisma.draft.findUnique({ where: { id: future.id } });
    expect(futureAfter?.status).toBe("scheduled");

    const notScheduledAfter = await prisma.draft.findUnique({ where: { id: notScheduled.id } });
    expect(notScheduledAfter?.status).toBe("draft");

    // A second claim run must not pick up the same draft again (no double-post).
    const claimedAgain = await claimDuePublishDrafts();
    expect(claimedAgain.map((c) => c.id)).not.toContain(due.id);
  });
});

describe("listAccountsNeedingRefresh", () => {
  it("returns only active accounts with a refresh token expiring within 7 days", async () => {
    const soonExpiry = await prisma.linkedInAccount.create({
      data: {
        userId,
        memberUrn: `urn:li:person:soon:${Date.now() + Math.floor(Math.random() * 1e9)}`,
        displayName: "Soon",
        accessToken: "enc",
        refreshToken: "enc-refresh",
        tokenExpiresAt: new Date(Date.now() + 3600_000),
        status: "active",
        scopes: [],
      },
    });
    const farExpiry = await prisma.linkedInAccount.create({
      data: {
        userId,
        memberUrn: `urn:li:person:far:${Date.now() + Math.floor(Math.random() * 1e9)}`,
        displayName: "Far",
        accessToken: "enc",
        refreshToken: "enc-refresh",
        tokenExpiresAt: new Date(Date.now() + 30 * 86400_000),
        status: "active",
        scopes: [],
      },
    });
    const noRefreshToken = await prisma.linkedInAccount.create({
      data: {
        userId,
        memberUrn: `urn:li:person:norefresh:${Date.now() + Math.floor(Math.random() * 1e9)}`,
        displayName: "NoRefresh",
        accessToken: "enc",
        tokenExpiresAt: new Date(Date.now() + 3600_000),
        status: "active",
        scopes: [],
      },
    });
    const notActive = await prisma.linkedInAccount.create({
      data: {
        userId,
        memberUrn: `urn:li:person:expired:${Date.now() + Math.floor(Math.random() * 1e9)}`,
        displayName: "Expired",
        accessToken: "enc",
        refreshToken: "enc-refresh",
        tokenExpiresAt: new Date(Date.now() + 3600_000),
        status: "expired",
        scopes: [],
      },
    });

    const result = await listAccountsNeedingRefresh();
    const ids = result.map((r) => r.id);

    expect(ids).toContain(soonExpiry.id);
    expect(ids).not.toContain(farExpiry.id);
    expect(ids).not.toContain(noRefreshToken.id);
    expect(ids).not.toContain(notActive.id);
  });
});
