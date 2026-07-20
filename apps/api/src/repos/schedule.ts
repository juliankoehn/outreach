// apps/api/src/repos/schedule.ts
import { prisma } from "@outreach/db";

export interface ScheduledEvent {
  id: string;
  text: string;
  imageUrl: string | null;
  // The time the event sits at on the calendar: scheduledAt for scheduled/failed,
  // publishedAt for published (its real go-live time).
  scheduledAt: Date;
  status: string;
  externalId: string | null;
  account: { id: string; displayName: string; avatarUrl: string | null };
}

// Set/clear the schedule. updateDraft() deliberately whitelists out status +
// scheduledAt, so scheduling gets its own account-scoped writer.
export async function scheduleDraft(draftId: string, accountId: string, scheduledAt: Date) {
  await prisma.draft.updateMany({
    where: { id: draftId, linkedinAccountId: accountId },
    data: { scheduledAt, status: "scheduled" },
  });
  return prisma.draft.findFirstOrThrow({ where: { id: draftId, linkedinAccountId: accountId } });
}

export async function unscheduleDraft(draftId: string, accountId: string) {
  await prisma.draft.updateMany({
    where: { id: draftId, linkedinAccountId: accountId },
    data: { scheduledAt: null, status: "draft" },
  });
  return prisma.draft.findFirstOrThrow({ where: { id: draftId, linkedinAccountId: accountId } });
}

// Scheduled drafts across the user's accounts (or one) whose scheduledAt ∈ [from, to).
export async function listScheduledDrafts(
  userId: string,
  from: Date,
  to: Date,
  accountId?: string,
): Promise<ScheduledEvent[]> {
  const rows = await prisma.draft.findMany({
    where: {
      account: { userId, ...(accountId ? { id: accountId } : {}) },
      OR: [
        // Scheduled (and failed-while-scheduled) posts sit at their planned time.
        { status: { in: ["scheduled", "failed"] }, scheduledAt: { gte: from, lt: to } },
        // Published posts sit at their real go-live time.
        { status: "published", publishedAt: { gte: from, lt: to } },
      ],
    },
    select: {
      id: true,
      text: true,
      imageUrl: true,
      scheduledAt: true,
      publishedAt: true,
      status: true,
      externalId: true,
      account: { select: { id: true, displayName: true, avatarUrl: true } },
    },
  });
  return rows
    .map((r) => ({
      id: r.id,
      text: r.text,
      imageUrl: r.imageUrl,
      scheduledAt: (r.status === "published" ? r.publishedAt : r.scheduledAt)!,
      status: r.status,
      externalId: r.externalId,
      account: r.account,
    }))
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
}
