import { betterAuth, generateId } from "better-auth";
import { organization } from "better-auth/plugins";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "@outreach/db";
import { env } from "./env.js";
import { sendEmail } from "./mailer.js";

// Escapes HTML-significant characters so user-controlled values (names, org
// names, urls) can't inject markup/script when interpolated into email HTML.
const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

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
  plugins: [
    organization({
      // Renders and sends the invitation email via the SMTP mailer. Better
      // Auth doesn't generate invitation URLs itself, so we build the
      // accept link from WEB_ORIGIN + the invitation id (matches the
      // web app's /accept-invitation/[id] route).
      sendInvitationEmail: async (data) => {
        const acceptUrl = `${env.WEB_ORIGIN}/accept-invitation/${data.id}`;
        const inviterName = data.inviter.user.name || data.inviter.user.email;
        await sendEmail({
          to: data.email,
          subject: `${inviterName} invited you to ${data.organization.name}`,
          text: `${inviterName} invited you to join ${data.organization.name} as ${data.role}.\n\nAccept the invitation: ${acceptUrl}`,
          html: `<p>${escapeHtml(inviterName)} invited you to join <b>${escapeHtml(data.organization.name)}</b> as <b>${escapeHtml(data.role)}</b>.</p><p><a href="${escapeHtml(acceptUrl)}">Accept the invitation</a></p>`,
        });
      },
    }),
  ],
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
