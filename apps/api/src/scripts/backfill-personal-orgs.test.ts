import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@outreach/db";
import { backfillPersonalOrgs } from "./backfill-personal-orgs.js";

const userId = `u_backfill_${Date.now() + Math.floor(Math.random() * 1e9)}`;

afterAll(async () => {
  await prisma.member.deleteMany({ where: { userId } });
  await prisma.organization.deleteMany({ where: { slug: `u-${userId}` } });
  await prisma.session.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } }).catch(() => {});
});

describe("backfillPersonalOrgs", () => {
  it("creates a personal org + owner member for a pre-existing user with no membership, and is idempotent on a second run", async () => {
    await prisma.user.create({ data: { id: userId, email: `${userId}@ex.com`, name: "Backfill Person" } });
    const session = await prisma.session.create({
      data: {
        id: `${userId}_sess`,
        userId,
        token: `${userId}_token`,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    const result = await backfillPersonalOrgs({ userIds: [userId] });
    expect(result.created).toBe(1);

    const members = await prisma.member.findMany({ where: { userId } });
    expect(members.length).toBe(1);
    expect(members[0]!.role).toBe("owner");

    const org = await prisma.organization.findFirst({ where: { slug: `u-${userId}` } });
    expect(org).toBeTruthy();
    expect(members[0]!.organizationId).toBe(org!.id);

    const updatedSession = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(updatedSession.activeOrganizationId).toBe(org!.id);

    // Idempotency: run again, scoped to this same user, and assert created
    // is 0. Scoping (rather than scanning the whole User table) keeps this
    // deterministic: other test files in this suite concurrently create and
    // delete their own member-less scratch users against the same dev DB,
    // which would otherwise make a global count flaky. The unscoped
    // (default, no-args) path is exercised by the one-off CLI run against
    // the real dev DB, see task report.
    const secondResult = await backfillPersonalOrgs({ userIds: [userId] });
    expect(secondResult.created).toBe(0);
    expect(secondResult.skipped).toBe(1);

    const membersAfter = await prisma.member.findMany({ where: { userId } });
    expect(membersAfter.length).toBe(1);
    expect(membersAfter[0]!.id).toBe(members[0]!.id);
    expect(membersAfter[0]!.organizationId).toBe(org!.id);

    const orgsAfter = await prisma.organization.findMany({ where: { slug: `u-${userId}` } });
    expect(orgsAfter.length).toBe(1);
  });
});
