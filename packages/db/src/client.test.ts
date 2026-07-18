import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "./client.js";

describe("db", () => {
  afterAll(async () => { await prisma.$disconnect(); });

  it("connects and round-trips a user + linkedin account", async () => {
    const user = await prisma.user.create({
      data: { id: `u_${Date.now()}`, email: `t${Date.now()}@ex.com` },
    });
    const acct = await prisma.linkedInAccount.create({
      data: {
        userId: user.id, memberUrn: `urn:li:person:${Date.now()}`,
        displayName: "Test", accessToken: "enc", scopes: ["w_member_social"],
      },
    });
    expect(acct.status).toBe("active");
    await prisma.user.delete({ where: { id: user.id } });
  });
});
