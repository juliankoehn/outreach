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
  // Whitelist mutable fields only -- never trust the caller for
  // linkedinAccountId/id/createdAt. This is the authoritative boundary that
  // protects the PATCH /:accountId route (which forwards an arbitrary body).
  const payload: Partial<SynthesizedProfile> & { status?: string; derived?: object; derivedAt?: Date } = {};
  if (data.goals !== undefined) payload.goals = data.goals;
  if (data.audience !== undefined) payload.audience = data.audience;
  if (data.pillars !== undefined) payload.pillars = data.pillars;
  if (data.noGos !== undefined) payload.noGos = data.noGos;
  if (data.toneWords !== undefined) payload.toneWords = data.toneWords;
  if (data.languages !== undefined) payload.languages = data.languages;
  if (data.positioning !== undefined) payload.positioning = data.positioning;
  if (data.brandBrief !== undefined) payload.brandBrief = data.brandBrief;
  if (data.status !== undefined) payload.status = data.status;
  if (data.derived !== undefined) payload.derived = data.derived as object;
  if (data.derivedAt !== undefined) payload.derivedAt = data.derivedAt;

  return prisma.creatorProfile.upsert({
    where: { linkedinAccountId: accountId },
    create: { linkedinAccountId: accountId, ...payload },
    update: payload,
  });
}
