// apps/api/src/repos/draft.ts
import { prisma } from "@outreach/db";

export function createDraft(
  accountId: string,
  data: { text: string; imageUrl?: string; imagePrompt?: string; source?: string; sourceFeedItemId?: string },
) {
  return prisma.draft.create({
    data: {
      linkedinAccountId: accountId,
      text: data.text,
      imageUrl: data.imageUrl,
      imagePrompt: data.imagePrompt,
      source: data.source,
      sourceFeedItemId: data.sourceFeedItemId,
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
  data: { text?: string; imageUrl?: string | null; imagePrompt?: string | null; chat?: unknown },
) {
  // Whitelist mutable fields only -- never trust the caller for id/linkedinAccountId/status.
  const payload: { text?: string; imageUrl?: string | null; imagePrompt?: string | null; chat?: object } = {};
  if (data.text !== undefined) payload.text = data.text;
  if (data.imageUrl !== undefined) payload.imageUrl = data.imageUrl;
  if (data.imagePrompt !== undefined) payload.imagePrompt = data.imagePrompt;
  if (data.chat !== undefined) payload.chat = data.chat as object;

  // scope the update to the owning account via updateMany, then return the row
  await prisma.draft.updateMany({ where: { id, linkedinAccountId: accountId }, data: payload });
  return prisma.draft.findFirstOrThrow({ where: { id, linkedinAccountId: accountId } });
}

export async function deleteDraft(id: string, accountId: string): Promise<void> {
  await prisma.draft.deleteMany({ where: { id, linkedinAccountId: accountId } });
}

// Dedicated writer for publish-result fields (status/externalId/publishError/publishedAt).
// updateDraft() deliberately whitelists those out -- callers must never set them
// via the generic mutation path, only via the publish orchestration.
export async function setPublishResult(
  id: string,
  accountId: string,
  data: { status: string; publishedAt?: Date | null; externalId?: string | null; publishError?: string | null },
): Promise<void> {
  await prisma.draft.updateMany({ where: { id, linkedinAccountId: accountId }, data });
}
