// apps/api/src/publish/due.ts
import { prisma } from "@outreach/db";

// Atomically claims due scheduled drafts by flipping them to "publishing" in
// a single UPDATE ... RETURNING. This prevents two overlapping worker runs
// from both picking up the same draft and double-posting it publicly.
// Since this claim already happened here, the worker calls publishDraft with
// { skipClaim: true } so publishDraft's own atomic claim (used to guard the
// draft/scheduled/failed -> publishing transition for any OTHER caller, e.g.
// a "Publish now" click) doesn't see status="publishing" and wrongly refuse.
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
