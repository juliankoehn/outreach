// apps/api/src/repos/linkedin-account.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@outreach/db";
import { encrypt } from "@outreach/core";
import { getDecryptedAccount, updateAccountTokens, setAccountStatus } from "./linkedin-account.js";
import { env } from "../env.js";

let userId = "", accountId = "";
beforeAll(async () => {
  userId = `u_${(Date.now()+Math.floor(Math.random()*1e9))}`;
  await prisma.user.create({ data: { id: userId, email: `${userId}@ex.com` } });
  const a = await prisma.linkedInAccount.create({
    data: {
      userId,
      memberUrn: `urn:li:person:${(Date.now()+Math.floor(Math.random()*1e9))}`,
      displayName: "T",
      accessToken: encrypt("initial", env.ENCRYPTION_KEY),
      scopes: [],
    },
  });
  accountId = a.id;
});
afterAll(async () => { await prisma.user.delete({ where: { id: userId } }); await prisma.$disconnect(); });

describe("linkedin-account repo", () => {
  it("getDecryptedAccount returns tokenExpiresAt and status", async () => {
    const acct = await getDecryptedAccount(accountId, userId);
    expect(acct).not.toBeNull();
    expect(acct).toHaveProperty("tokenExpiresAt");
    expect(acct?.status).toBe("active");
  });

  it("updateAccountTokens re-encrypts tokens, sets status active, and updates expiry", async () => {
    await updateAccountTokens(accountId, { accessToken: "new", refreshToken: "newr", expiresIn: 3600 });
    const acct = await getDecryptedAccount(accountId, userId);
    expect(acct?.accessToken).toBe("new");
    expect(acct?.refreshToken).toBe("newr");
    expect(acct?.status).toBe("active");
    expect(acct?.tokenExpiresAt).not.toBeNull();
    const expectedMs = Date.now() + 3600 * 1000;
    const actualMs = acct!.tokenExpiresAt!.getTime();
    expect(Math.abs(actualMs - expectedMs)).toBeLessThan(5000);
  });

  it("setAccountStatus updates status", async () => {
    await setAccountStatus(accountId, "expired");
    const acct = await getDecryptedAccount(accountId, userId);
    expect(acct?.status).toBe("expired");
  });
});
