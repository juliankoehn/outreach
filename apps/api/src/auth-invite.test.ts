import { describe, it, expect, afterAll, vi } from "vitest";
import { prisma } from "@outreach/db";

vi.mock("./mailer.js", () => ({ sendEmail: vi.fn(async () => {}) }));

const { sendEmail } = await import("./mailer.js");
const { auth } = await import("./auth.js");
const { createApp } = await import("./app.js");

const app = createApp();
const created: string[] = [];

async function signUp(name: string) {
  const email = `i${Date.now()}${Math.floor(Math.random() * 1e6)}@ex.com`;
  const password = "password-1234";
  const res = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: process.env.WEB_ORIGIN! },
    body: JSON.stringify({ email, password, name }),
  });
  const cookie = res.headers.get("set-cookie")!.split(";")[0]!;
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  created.push(user.id);
  return { cookie, user, email, password };
}

afterAll(async () => {
  for (const id of created) await prisma.user.delete({ where: { id } }).catch(() => {});
});

describe("organization invitations", () => {
  it("emails the invitee an accept link via the mailer, and lets them accept it", async () => {
    const owner = await signUp("Owner Person");
    const ownerMember = await prisma.member.findFirstOrThrow({ where: { userId: owner.user.id } });
    const organizationId = ownerMember.organizationId;

    const inviteeEmail = "b@ex.com";
    const invitation = await auth.api.createInvitation({
      body: { email: inviteeEmail, role: "member", organizationId },
      headers: new Headers({ cookie: owner.cookie }),
    });

    expect(sendEmail).toHaveBeenCalledOnce();
    const call = vi.mocked(sendEmail).mock.calls[0]![0];
    expect(call.to).toBe(inviteeEmail);
    const acceptUrl = `${process.env.WEB_ORIGIN}/accept-invitation/${invitation.id}`;
    expect(call.text ?? "").toContain(acceptUrl);
    expect(call.html ?? "").toContain(acceptUrl);

    // Sign up user B with the invited email and accept the invitation.
    const passwordB = "password-1234";
    const signUpRes = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: process.env.WEB_ORIGIN! },
      body: JSON.stringify({ email: inviteeEmail, password: passwordB, name: "Invitee Person" }),
    });
    const cookieB = signUpRes.headers.get("set-cookie")!.split(";")[0]!;
    const userB = await prisma.user.findUniqueOrThrow({ where: { email: inviteeEmail } });
    created.push(userB.id);

    await auth.api.acceptInvitation({
      body: { invitationId: invitation.id },
      headers: new Headers({ cookie: cookieB }),
    });

    const memberB = await prisma.member.findFirstOrThrow({
      where: { userId: userB.id, organizationId },
    });
    expect(memberB.role).toBe("member");
  });

  it("HTML-escapes attacker-controlled values (inviter name, org name) in the invitation email", async () => {
    const payload = "<img src=x onerror=alert(1)>";
    const owner = await signUp(payload);
    const ownerMember = await prisma.member.findFirstOrThrow({ where: { userId: owner.user.id } });
    const organizationId = ownerMember.organizationId;

    // The owner's personal org name derives from their (attacker-controlled)
    // display name, so it carries the same payload.
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    expect(org.name).toBe(payload);

    const inviteeEmail = `xss${Date.now()}@ex.com`;
    await auth.api.createInvitation({
      body: { email: inviteeEmail, role: "member", organizationId },
      headers: new Headers({ cookie: owner.cookie }),
    });

    const call = vi.mocked(sendEmail).mock.calls.at(-1)![0];
    const html = call.html ?? "";
    expect(html).not.toContain("<img");
    expect(html).not.toContain(payload);
    expect(html).toContain("&lt;img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");

    // Plain-text body is intentionally left unescaped.
    expect(call.text ?? "").toContain(payload);
  });

  it("rejects an invite from a non-member of the organization", async () => {
    const owner = await signUp("Another Owner");
    const ownerMember = await prisma.member.findFirstOrThrow({ where: { userId: owner.user.id } });

    const outsider = await signUp("Outsider Person");

    await expect(
      auth.api.createInvitation({
        body: { email: "c@ex.com", role: "member", organizationId: ownerMember.organizationId },
        headers: new Headers({ cookie: outsider.cookie }),
      }),
    ).rejects.toThrow();
  });
});
