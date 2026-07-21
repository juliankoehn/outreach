import { prisma } from "@outreach/db";
import { ensurePersonalOrg } from "../org.js";

// Prisma's typed error class is exported as a type-only re-export from
// @outreach/db, so we can't `instanceof` it here without reaching into the
// generated client. Duck-type on the `code` property instead (stable across
// Prisma's error classes).
function prismaErrorCode(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "code" in err) {
    return (err as { code?: unknown }).code as string | undefined;
  }
  return undefined;
}

// One-off backfill for users created before personal orgs existed (SP1).
// For every User with no Member row: create an Organization + owner Member
// via the shared `ensurePersonalOrg`, then point that user's sessions at it.
// Idempotent: a second run is a no-op for users already backfilled (their
// membership already exists, so `ensurePersonalOrg` just returns the
// existing org id and this counts them as skipped).
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
      const existingBefore = await prisma.member.findFirst({
        where: { userId: u.id },
      });
      const organizationId = await ensurePersonalOrg(u.id);

      if (existingBefore) {
        skipped++;
      } else {
        await prisma.session.updateMany({
          where: { userId: u.id },
          data: { activeOrganizationId: organizationId },
        });
        created++;
      }
    } catch (err) {
      const code = prismaErrorCode(err);

      // Concurrent write for the same user (e.g. a live sign-in racing this
      // one-off script and creating the org/member via ensurePersonalOrg
      // first) shows up as a unique-constraint violation (P2002) on the org
      // slug or member. Treat that as "already handled" rather than aborting
      // the whole backfill for every other user.
      //
      // A user disappearing between the initial scan and processing it
      // (P2025, "record not found") is the same kind of benign race in the
      // unscoped/whole-table path: another concurrent process deleted that
      // user (e.g. test cleanup against the shared dev DB), so there's
      // nothing left to backfill for them.
      if (code === "P2002" || code === "P2025") {
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
