// apps/api/src/repos/linkedin-account.ts
import { prisma } from "@outreach/db";
import { encrypt, decrypt } from "@outreach/core";
import type { LinkedInProfile, TokenResponse } from "@outreach/linkedin";
import { env } from "../env.js";

export async function saveLinkedInAccount(input: {
  userId: string;
  profile: LinkedInProfile;
  tokens: TokenResponse;
}): Promise<{ id: string }> {
  const { userId, profile, tokens } = input;
  const expiresAt = tokens.expiresIn ? new Date(Date.now() + tokens.expiresIn * 1000) : null;
  const acct = await prisma.linkedInAccount.upsert({
    where: { userId_memberUrn: { userId, memberUrn: profile.memberUrn } },
    create: {
      userId,
      memberUrn: profile.memberUrn,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      accessToken: encrypt(tokens.accessToken, env.ENCRYPTION_KEY),
      refreshToken: tokens.refreshToken ? encrypt(tokens.refreshToken, env.ENCRYPTION_KEY) : null,
      tokenExpiresAt: expiresAt,
      scopes: tokens.scopes,
      status: "active",
    },
    update: {
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      accessToken: encrypt(tokens.accessToken, env.ENCRYPTION_KEY),
      refreshToken: tokens.refreshToken ? encrypt(tokens.refreshToken, env.ENCRYPTION_KEY) : null,
      tokenExpiresAt: expiresAt,
      scopes: tokens.scopes,
      status: "active",
    },
  });
  return { id: acct.id };
}

export async function getDecryptedAccount(id: string, userId: string) {
  const a = await prisma.linkedInAccount.findFirst({ where: { id, userId } });
  if (!a) return null;
  return {
    id: a.id,
    userId: a.userId,
    memberUrn: a.memberUrn,
    accessToken: decrypt(a.accessToken, env.ENCRYPTION_KEY),
    refreshToken: a.refreshToken ? decrypt(a.refreshToken, env.ENCRYPTION_KEY) : undefined,
    scopes: a.scopes,
  };
}

export async function listAccounts(userId: string) {
  const rows = await prisma.linkedInAccount.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      memberUrn: true,
      displayName: true,
      avatarUrl: true,
      status: true,
      createdAt: true,
      analyticsAt: true,
      creatorProfile: { select: { id: true, name: true } },
      _count: { select: { posts: true, drafts: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    memberUrn: r.memberUrn,
    displayName: r.displayName,
    avatarUrl: r.avatarUrl,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    analyticsAt: r.analyticsAt ? r.analyticsAt.toISOString() : null,
    profile: r.creatorProfile ? { id: r.creatorProfile.id, name: r.creatorProfile.name } : null,
    postCount: r._count.posts,
    draftCount: r._count.drafts,
  }));
}

export async function getAccountSummary(id: string, userId: string) {
  return prisma.linkedInAccount.findFirst({
    where: { id, userId },
    select: { id: true, memberUrn: true, displayName: true, avatarUrl: true, status: true },
  });
}

// Resolve the (single, Phase 1) LinkedIn account bound to a creator profile.
// CreatorProfile↔account is 1:n; Phase 1 assumes one account per profile, so we
// take the first owned match. Returns null when the profile has no account.
export async function getAccountIdForProfile(profileId: string, userId: string): Promise<string | null> {
  const acct = await prisma.linkedInAccount.findFirst({
    where: { creatorProfileId: profileId, userId },
    select: { id: true },
  });
  return acct?.id ?? null;
}

export async function getAnalyticsCache(id: string) {
  return prisma.linkedInAccount.findUnique({
    where: { id },
    select: { analytics: true, analyticsAt: true },
  });
}

export async function setAnalyticsCache(id: string, analytics: object): Promise<void> {
  await prisma.linkedInAccount.update({
    where: { id },
    data: { analytics, analyticsAt: new Date() },
  });
}
