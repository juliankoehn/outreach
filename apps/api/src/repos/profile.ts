import { prisma } from "@outreach/db";
import type { ChatMessage, SynthesizedProfile, DerivedInsights } from "@outreach/ai";
import { getAccountSummary } from "./linkedin-account.js";

export async function listProfiles(userId: string) {
  return prisma.creatorProfile.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    include: { accounts: { select: { id: true, displayName: true } } },
  });
}

export async function createProfile(userId: string, name?: string) {
  return prisma.creatorProfile.create({ data: { userId, name: name ?? "", status: "draft" } });
}

export async function getProfileById(id: string, userId: string) {
  return prisma.creatorProfile.findFirst({ where: { id, userId } });
}

export async function updateProfileById(
  id: string,
  userId: string,
  data: Partial<SynthesizedProfile> & {
    name?: string;
    status?: string;
    derived?: DerivedInsights;
    derivedAt?: Date;
  },
) {
  // Whitelist mutable fields only -- never trust the caller for
  // id/userId/createdAt. This is the authoritative boundary that protects
  // the PATCH /profiles/:id route (which forwards an arbitrary body).
  const payload: Partial<SynthesizedProfile> & { name?: string; status?: string; derived?: object; derivedAt?: Date } =
    {};
  if (data.name !== undefined) payload.name = data.name;
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

  await prisma.creatorProfile.updateMany({ where: { id, userId }, data: payload });
  return prisma.creatorProfile.findFirstOrThrow({ where: { id, userId } });
}

export async function deleteProfileById(id: string, userId: string): Promise<void> {
  await prisma.creatorProfile.deleteMany({ where: { id, userId } });
}

export async function assignProfileToAccount(
  profileId: string,
  accountId: string,
  userId: string,
): Promise<boolean> {
  const [profile, account] = await Promise.all([
    getProfileById(profileId, userId),
    getAccountSummary(accountId, userId),
  ]);
  if (!profile || !account) return false;
  await prisma.linkedInAccount.update({ where: { id: accountId }, data: { creatorProfileId: profileId } });
  return true;
}

export async function unassignProfileFromAccount(accountId: string, userId: string): Promise<boolean> {
  const account = await getAccountSummary(accountId, userId);
  if (!account) return false;
  await prisma.linkedInAccount.update({ where: { id: accountId }, data: { creatorProfileId: null } });
  return true;
}

// Resolve an account's assigned profile (if any). Used by studio + interview
// seed, which operate on the account's currently-assigned profile.
export async function getAccountProfile(accountId: string) {
  const acct = await prisma.linkedInAccount.findUnique({
    where: { id: accountId },
    select: { creatorProfileId: true },
  });
  if (!acct?.creatorProfileId) return null;
  return prisma.creatorProfile.findUnique({ where: { id: acct.creatorProfileId } });
}

export async function getOrCreateInterview(profileId: string) {
  const existing = await prisma.interviewSession.findFirst({
    where: { creatorProfileId: profileId, status: "in_progress" },
    orderBy: { createdAt: "desc" },
  });
  const row = existing ?? (await prisma.interviewSession.create({ data: { creatorProfileId: profileId } }));
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
