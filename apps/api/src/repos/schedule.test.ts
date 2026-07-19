// apps/api/src/repos/schedule.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@outreach/db";
import { scheduleDraft, unscheduleDraft, listScheduledDrafts } from "./schedule.js";

const userId = `u_sched_${Date.now()}`;
const otherUserId = `u_sched_other_${Date.now()}`;
let accountId = "";
let otherAccountId = "";
let draftId = "";

beforeAll(async () => {
  await prisma.user.create({ data: { id: userId, email: `${userId}@ex.com` } });
  const a = await prisma.linkedInAccount.create({
    data: { userId, memberUrn: `urn:${userId}`, displayName: "Sched Acct", accessToken: "x", scopes: [] },
  });
  accountId = a.id;
  await prisma.user.create({ data: { id: otherUserId, email: `${otherUserId}@ex.com` } });
  const o = await prisma.linkedInAccount.create({
    data: { userId: otherUserId, memberUrn: `urn:${otherUserId}`, displayName: "Other", accessToken: "x", scopes: [] },
  });
  otherAccountId = o.id;
  const d = await prisma.draft.create({ data: { linkedinAccountId: accountId, text: "Hello world\nsecond line" } });
  draftId = d.id;
});

afterAll(async () => {
  await prisma.user.delete({ where: { id: userId } });
  await prisma.user.delete({ where: { id: otherUserId } });
  await prisma.$disconnect();
});

describe("schedule repo", () => {
  const when = new Date(Date.now() + 24 * 3600 * 1000);

  it("scheduleDraft sets scheduledAt + status", async () => {
    const d = await scheduleDraft(draftId, accountId, when);
    expect(d.status).toBe("scheduled");
    expect(d.scheduledAt?.getTime()).toBe(when.getTime());
  });

  it("listScheduledDrafts returns the event in range for the owner, with account info", async () => {
    const events = await listScheduledDrafts(userId, new Date(Date.now() - 3600e3), new Date(Date.now() + 7 * 86400e3));
    const ev = events.find((e) => e.id === draftId);
    expect(ev).toBeTruthy();
    expect(ev!.account.displayName).toBe("Sched Acct");
    expect(ev!.text).toContain("Hello world");
  });

  it("listScheduledDrafts excludes other users and out-of-range", async () => {
    const foreign = await listScheduledDrafts(otherUserId, new Date(Date.now() - 3600e3), new Date(Date.now() + 7 * 86400e3));
    expect(foreign.find((e) => e.id === draftId)).toBeUndefined();
    const outOfRange = await listScheduledDrafts(userId, new Date(Date.now() + 30 * 86400e3), new Date(Date.now() + 40 * 86400e3));
    expect(outOfRange.find((e) => e.id === draftId)).toBeUndefined();
  });

  it("listScheduledDrafts honours the accountId filter", async () => {
    const other = await listScheduledDrafts(userId, new Date(Date.now() - 3600e3), new Date(Date.now() + 7 * 86400e3), otherAccountId);
    expect(other.find((e) => e.id === draftId)).toBeUndefined();
  });

  it("unscheduleDraft resets to draft", async () => {
    const d = await unscheduleDraft(draftId, accountId);
    expect(d.status).toBe("draft");
    expect(d.scheduledAt).toBeNull();
  });
});
