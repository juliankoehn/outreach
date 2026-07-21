import { betterAuth, generateId } from "better-auth";
import { organization } from "better-auth/plugins";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "@outreach/db";
import { env } from "./env.js";

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
          const org = await prisma.organization.create({
            data: {
              id: generateId(),
              name: user.name || user.email,
              slug: `u-${user.id}`,
              createdAt: new Date(),
            },
          });
          await prisma.member.create({
            data: {
              id: generateId(),
              organizationId: org.id,
              userId: user.id,
              role: "owner",
              createdAt: new Date(),
            },
          });
        },
      },
    },
    session: {
      create: {
        // Set the freshly created personal org as the session's active
        // organization. Runs synchronously after user.create's "after" hook
        // within the same sign-up request, so the owner Member row already
        // exists by the time a session is created for this user.
        before: async (session) => {
          if (session.activeOrganizationId) return;
          const member = await prisma.member.findFirst({
            where: { userId: session.userId },
            orderBy: { createdAt: "asc" },
          });
          if (member) return { data: { activeOrganizationId: member.organizationId } };
        },
      },
    },
  },
});

export type AuthUser = typeof auth.$Infer.Session.user;
