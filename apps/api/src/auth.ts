import { betterAuth, generateId } from "better-auth";
import { organization } from "better-auth/plugins";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "@outreach/db";
import { env } from "./env.js";

// Ensure the user has a personal org (owner membership). Idempotent + atomic:
// returns the existing org's id if a membership already exists, else creates
// Organization + owner Member in one transaction and returns the new id.
async function ensurePersonalOrg(userId: string): Promise<string> {
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

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  emailAndPassword: { enabled: true },
  trustedOrigins: [env.WEB_ORIGIN],
  plugins: [organization()],
  databaseHooks: {
    user: {
      create: {
        // Auto-create a personal organization and make the new user its
        // owner. Done via prisma directly (not `auth.api.createOrganization`)
        // because this "after" hook has no request/headers context to
        // authenticate an API call on behalf of the just-created user.
        after: async (user) => {
          await ensurePersonalOrg(user.id);
        },
      },
    },
    session: {
      create: {
        // Set the freshly created personal org as the session's active
        // organization. Runs synchronously after user.create's "after" hook
        // within the same sign-up request, so the owner Member row already
        // exists by the time a session is created for this user. Also acts
        // as a self-healing safety net: if the after-hook ever failed to
        // create the org, this ensures one exists (idempotent) rather than
        // leaving the user permanently stuck without an org.
        before: async (session) => {
          if (session.activeOrganizationId) return;
          const organizationId = await ensurePersonalOrg(session.userId);
          return { data: { activeOrganizationId: organizationId } };
        },
      },
    },
  },
});

export type AuthUser = typeof auth.$Infer.Session.user;
