// apps/api/src/publish/due.ts
import { prisma } from "@outreach/db";

// Atomically claims due scheduled drafts by flipping them to "publishing" in
// a single UPDATE ... RETURNING. This prevents two overlapping worker runs
// from both picking up the same draft and double-posting it publicly.
// publishDraft's only "already handled" guard is status==="published", so a
// claimed "publishing" draft proceeds normally through publishDraft and ends
// up "published" or "failed".
export async function claimDuePublishDrafts(): Promise<
  Array<{ id: string; linkedinAccountId: string; userId: string }>
> {
  return prisma.$queryRaw`
    UPDATE "Draft" d SET status = 'publishing'
    FROM "LinkedInAccount" a
    WHERE d."linkedinAccountId" = a.id
      AND d.status = 'scheduled'
      AND d."scheduledAt" <= now()
    RETURNING d.id, d."linkedinAccountId" AS "linkedinAccountId", a."userId" AS "userId"`;
}

export function listAccountsNeedingRefresh() {
  const soon = new Date(Date.now() + 7 * 86400e3);
  return prisma.linkedInAccount.findMany({
    where: { status: "active", refreshToken: { not: null }, tokenExpiresAt: { lt: soon } },
    select: { id: true, userId: true },
    take: 100,
  });
}
