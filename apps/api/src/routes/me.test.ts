import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@outreach/db";
import { createApp } from "../app.js";

const app = createApp();
const created: string[] = [];

async function signUp() {
  const email = `m${Date.now()}${Math.floor(Math.random() * 1e6)}@ex.com`;
  const password = "password-1234";
  const res = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: process.env.WEB_ORIGIN! },
    body: JSON.stringify({ email, password, name: "Me Person" }),
  });
  const cookie = res.headers.get("set-cookie")!.split(";")[0]!;
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  created.push(user.id);
  return { cookie, user, email, password };
}

afterAll(async () => {
  for (const id of created) await prisma.user.delete({ where: { id } }).catch(() => {});
});

describe("GET /me", () => {
  it("returns the user and their active orgId", async () => {
    const { cookie, user } = await signUp();
    const member = await prisma.member.findFirstOrThrow({ where: { userId: user.id } });

    const res = await app.request("/me", { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { id: string; email: string }; orgId: string | null };
    expect(body.user.id).toBe(user.id);
    expect(body.user.email).toBe(user.email);
    expect(body.orgId).not.toBeNull();
    expect(body.orgId).toBe(member.organizationId);
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await app.request("/me");
    expect(res.status).toBe(401);
  });
});
