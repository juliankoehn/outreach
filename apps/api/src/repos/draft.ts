// apps/api/src/repos/draft.ts
import { prisma } from "@outreach/db";

export function createDraft(
  accountId: string,
  data: { text: string; imageUrl?: string; imagePrompt?: string; source?: string },
) {
  return prisma.draft.create({ data: { linkedinAccountId: accountId, ...data } });
}

export function listDrafts(accountId: string) {
  return prisma.draft.findMany({ where: { linkedinAccountId: accountId }, orderBy: { createdAt: "desc" } });
}

export function getDraft(id: string, accountId: string) {
  return prisma.draft.findFirst({ where: { id, linkedinAccountId: accountId } });
}

export async function updateDraft(
  id: string,
  accountId: string,
  data: { text?: string; imageUrl?: string | null; imagePrompt?: string | null },
) {
  // scope the update to the owning account via updateMany, then return the row
  await prisma.draft.updateMany({ where: { id, linkedinAccountId: accountId }, data });
  return prisma.draft.findFirstOrThrow({ where: { id, linkedinAccountId: accountId } });
}

export async function deleteDraft(id: string, accountId: string): Promise<void> {
  await prisma.draft.deleteMany({ where: { id, linkedinAccountId: accountId } });
}
