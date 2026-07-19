// apps/api/src/publish/refresh-tokens.ts
import { LinkedInOAuthClient } from "@outreach/linkedin";
import { env } from "../env.js";
import { getDecryptedAccount, updateAccountTokens, setAccountStatus } from "../repos/linkedin-account.js";

function oauth() {
  return new LinkedInOAuthClient({
    clientId: env.LINKEDIN_CLIENT_ID,
    clientSecret: env.LINKEDIN_CLIENT_SECRET,
    redirectUri: env.LINKEDIN_REDIRECT_URI,
  });
}

export async function refreshAccountToken(accountId: string, userId: string): Promise<void> {
  const acct = await getDecryptedAccount(accountId, userId);
  if (!acct?.refreshToken) return;
  try {
    const t = await oauth().refresh(acct.refreshToken);
    await updateAccountTokens(accountId, t);
  } catch {
    await setAccountStatus(accountId, "expired");
  }
}
