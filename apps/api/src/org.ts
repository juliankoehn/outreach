import { generateId } from "better-auth";
import { prisma } from "@outreach/db";

// Ensure the user has a personal org (owner membership). Idempotent + atomic:
// returns the existing org's id if a membership already exists, else creates
// Organization + owner Member in one transaction and returns the new id.
export async function ensurePersonalOrg(userId: string): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.member.findFirst({ where: { userId } });
    if (existing) return existing.organizationId;

    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const org = await tx.organization.create({
      data: {
        id: generateId(),
        name: user.name || user.email,
        slug: `u-${user.id}`,
        createdAt: new Date(),
      },
    });
    await tx.member.create({
      data: {
        id: generateId(),
        organizationId: org.id,
        userId: user.id,
        role: "owner",
        createdAt: new Date(),
      },
    });
    return org.id;
  });
}
