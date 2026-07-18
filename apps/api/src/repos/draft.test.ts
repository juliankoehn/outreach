// apps/api/src/repos/draft.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@outreach/db";
import { createDraft, listDrafts, getDraft, updateDraft, deleteDraft } from "./draft.js";

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

describe("draft repo", () => {
  it("creates, lists, updates, scopes, and deletes", async () => {
    const d = await createDraft(accountId, { text: "hello", imagePrompt: "poster" });
    expect((await listDrafts(accountId)).length).toBeGreaterThan(0);
    const upd = await updateDraft(d.id, accountId, { text: "edited" });
    expect(upd.text).toBe("edited");
    expect(await getDraft(d.id, "other-account")).toBeNull(); // ownership scoping
    await deleteDraft(d.id, accountId);
    expect(await getDraft(d.id, accountId)).toBeNull();
  });
});
