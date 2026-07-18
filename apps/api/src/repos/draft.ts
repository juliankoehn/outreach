// apps/api/src/repos/draft.ts
import { prisma } from "@outreach/db";

export function createDraft(
  accountId: string,
  data: { text: string; imageUrl?: string; imagePrompt?: string; source?: string },
) {
  return prisma.draft.create({
    data: {
      linkedinAccountId: accountId,
      text: data.text,
      imageUrl: data.imageUrl,
      imagePrompt: data.imagePrompt,
      source: data.source,
    },
  });
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
  // Whitelist mutable fields only -- never trust the caller for id/linkedinAccountId/status.
  const payload: { text?: string; imageUrl?: string | null; imagePrompt?: string | null } = {};
  if (data.text !== undefined) payload.text = data.text;
  if (data.imageUrl !== undefined) payload.imageUrl = data.imageUrl;
  if (data.imagePrompt !== undefined) payload.imagePrompt = data.imagePrompt;

  // scope the update to the owning account via updateMany, then return the row
  await prisma.draft.updateMany({ where: { id, linkedinAccountId: accountId }, data: payload });
  return prisma.draft.findFirstOrThrow({ where: { id, linkedinAccountId: accountId } });
}

export async function deleteDraft(id: string, accountId: string): Promise<void> {
  await prisma.draft.deleteMany({ where: { id, linkedinAccountId: accountId } });
}
