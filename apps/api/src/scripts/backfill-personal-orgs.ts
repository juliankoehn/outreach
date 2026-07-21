import { generateId } from "better-auth";
import { prisma } from "@outreach/db";

// Prisma's typed error class is exported as a type-only re-export from
// @outreach/db, so we can't `instanceof` it here without reaching into the
// generated client. Duck-type on the `code` property instead (stable across
// Prisma's error classes).
function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2002"
  );
}

// One-off backfill for users created before personal orgs existed (SP1).
// For every User with no Member row: create an Organization + owner Member,
// then point that user's sessions at it. Idempotent: a second run is a no-op
// for users already backfilled (created: 0), since the existence check and
// the writes happen inside a single transaction per user.
//
// `options.userIds` optionally scopes the scan to a specific set of users
// instead of the whole table. The real backfill (CLI entry point below)
// always calls this with no arguments to process every user; the option
// exists so tests can target just the user they created, independent of
// whatever other member-less scratch users other suites concurrently create
// against the same dev DB.
export async function backfillPersonalOrgs(options?: {
  userIds?: string[];
}): Promise<{ created: number; skipped: number }> {
  const users = await prisma.user.findMany({
    where: options?.userIds ? { id: { in: options.userIds } } : undefined,
    select: { id: true, name: true, email: true },
  });
  let created = 0;
  let skipped = 0;

  for (const u of users) {
    try {
      const didCreate = await prisma.$transaction(async (tx) => {
        const existing = await tx.member.findFirst({ where: { userId: u.id } });
        if (existing) return false;

        const org = await tx.organization.create({
          data: {
            id: generateId(),
            name: u.name || u.email,
            slug: `u-${u.id}`,
            createdAt: new Date(),
          },
        });
        await tx.member.create({
          data: {
            id: generateId(),
            organizationId: org.id,
            userId: u.id,
            role: "owner",
            createdAt: new Date(),
          },
        });
        await tx.session.updateMany({
          where: { userId: u.id },
          data: { activeOrganizationId: org.id },
        });
        return true;
      });

      if (didCreate) created++;
      else skipped++;
    } catch (err) {
      // Concurrent write for the same user (e.g. a live sign-in racing this
      // one-off script and creating the org/member via ensurePersonalOrg
      // first) shows up as a unique-constraint violation on the org slug or
      // member. Treat that as "already handled" rather than aborting the
      // whole backfill for every other user.
      if (isUniqueConstraintError(err)) {
        skipped++;
        continue;
      }
      throw err;
    }
  }

  return { created, skipped };
}

// Allow `pnpm exec tsx src/scripts/backfill-personal-orgs.ts` as a one-off.
if (import.meta.url === `file://${process.argv[1]}`) {
  backfillPersonalOrgs().then((r) => {
    console.log("backfill:", r);
    process.exit(0);
  });
}
