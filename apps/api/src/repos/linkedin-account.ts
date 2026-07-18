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

export async function getDecryptedAccount(id: string) {
  const a = await prisma.linkedInAccount.findUnique({ where: { id } });
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
    select: { id: true, memberUrn: true, displayName: true, avatarUrl: true, status: true },
  });
  return rows;
}
