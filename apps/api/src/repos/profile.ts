import { prisma } from "@outreach/db";
import type { ChatMessage, SynthesizedProfile, DerivedInsights } from "@outreach/ai";

export async function getOrCreateInterview(accountId: string) {
  const existing = await prisma.interviewSession.findFirst({
    where: { linkedinAccountId: accountId, status: "in_progress" },
    orderBy: { createdAt: "desc" },
  });
  const row = existing ?? (await prisma.interviewSession.create({ data: { linkedinAccountId: accountId } }));
  return { id: row.id, status: row.status, messages: (row.messages as unknown as ChatMessage[]) ?? [] };
}

export async function appendInterviewMessage(id: string, msg: ChatMessage): Promise<void> {
  const row = await prisma.interviewSession.findUniqueOrThrow({ where: { id } });
  const messages = [...((row.messages as unknown as ChatMessage[]) ?? []), msg];
  await prisma.interviewSession.update({ where: { id }, data: { messages: messages as object } });
}

export async function completeInterview(id: string): Promise<void> {
  await prisma.interviewSession.update({ where: { id }, data: { status: "complete" } });
}

export async function getProfile(accountId: string) {
  return prisma.creatorProfile.findUnique({ where: { linkedinAccountId: accountId } });
}

export async function upsertProfile(
  accountId: string,
  data: Partial<SynthesizedProfile> & { status?: string; derived?: DerivedInsights; derivedAt?: Date },
) {
  const { derived, ...rest } = data;
  const payload = { ...rest, ...(derived ? { derived: derived as object } : {}) };
  return prisma.creatorProfile.upsert({
    where: { linkedinAccountId: accountId },
    create: { linkedinAccountId: accountId, ...payload },
    update: payload,
  });
}
