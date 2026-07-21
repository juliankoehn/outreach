import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@outreach/db";
import { createApp } from "./app.js";

const app = createApp();
const created: string[] = [];

async function signUp() {
  const email = `o${Date.now()}${Math.floor(Math.random() * 1e6)}@ex.com`;
  const password = "password-1234";
  const res = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: process.env.WEB_ORIGIN! },
    body: JSON.stringify({ email, password, name: "Owner Person" }),
  });
  const cookie = res.headers.get("set-cookie")!.split(";")[0]!;
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  created.push(user.id);
  return { cookie, user, email, password };
}

afterAll(async () => {
  for (const id of created) await prisma.user.delete({ where: { id } }).catch(() => {});
});

describe("personal org on sign-up", () => {
  it("creates a personal org with the user as owner and sets it active", async () => {
    const { user } = await signUp();
    const members = await prisma.member.findMany({ where: { userId: user.id }, include: { organization: true } });
    expect(members.length).toBe(1);
    expect(members[0]!.role).toBe("owner");
    const session = await prisma.session.findFirstOrThrow({ where: { userId: user.id } });
    expect(session.activeOrganizationId).toBe(members[0]!.organizationId);
  });

  it("is idempotent: a second session for the same user does not create a second org/member", async () => {
    const { user, email, password } = await signUp();

    const sessionsBefore = await prisma.session.count({ where: { userId: user.id } });

    // Trigger a genuine second session.create for the same user by signing in
    // again (sign-in creates a fresh Session row, which re-enters
    // session.create.before -> ensurePersonalOrg as a self-heal check).
    const res = await app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: process.env.WEB_ORIGIN! },
      body: JSON.stringify({ email, password }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeTruthy();

    const sessionsAfter = await prisma.session.count({ where: { userId: user.id } });
    expect(sessionsAfter).toBe(sessionsBefore + 1);

    const members = await prisma.member.findMany({ where: { userId: user.id } });
    expect(members.length).toBe(1);
    expect(members[0]!.role).toBe("owner");
    const orgs = await prisma.organization.findMany({ where: { slug: `u-${user.id}` } });
    expect(orgs.length).toBe(1);
  });
});
