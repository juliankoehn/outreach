// apps/api/src/routes/linkedin.ts
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { randomBytes } from "node:crypto";
import {
  LinkedInOAuthClient,
  LinkedInApiIngestor,
  CsvShareIngestor,
  LinkedInReadUnavailableError,
} from "@outreach/linkedin";
import type { AppEnv } from "../app.js";
import { env } from "../env.js";
import { signState, verifyState } from "../oauth-state.js";
import { saveLinkedInAccount, getDecryptedAccount, listAccounts } from "../repos/linkedin-account.js";
import { upsertPosts } from "../repos/post.js";

const SCOPES = ["openid", "profile", "email", "w_member_social"];

function client() {
  return new LinkedInOAuthClient({
    clientId: env.LINKEDIN_CLIENT_ID,
    clientSecret: env.LINKEDIN_CLIENT_SECRET,
    redirectUri: env.LINKEDIN_REDIRECT_URI,
  });
}

export function linkedinRoutes() {
  const r = new Hono<AppEnv>();

  r.get("/connect", (c) => {
    const user = c.get("user")!;
    const nonce = randomBytes(8).toString("hex");
    const state = signState(user.id, nonce);
    const { url } = client().createAuthorization(SCOPES);
    const withState = url.replace(/state=[^&]+/, `state=${encodeURIComponent(state)}`);
    setCookie(c, "li_oauth_state", state, { httpOnly: true, sameSite: "Lax", path: "/", maxAge: 600 });
    return c.redirect(withState);
  });

  r.get("/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const cookieState = getCookie(c, "li_oauth_state");
    if (!code || !state || state !== cookieState) {
      return c.json({ error: "invalid_oauth_state" }, 400);
    }
    const verified = verifyState(state);
    if (!verified) return c.json({ error: "invalid_oauth_state" }, 400);

    const oauth = client();
    const tokens = await oauth.exchangeCode(code);
    const profile = await oauth.fetchProfile(tokens.accessToken);
    await saveLinkedInAccount({ userId: verified.userId, profile, tokens });
    return c.redirect(`${env.WEB_ORIGIN}/accounts?connected=1`);
  });

  r.get("/accounts", async (c) => {
    const user = c.get("user")!;
    return c.json({ accounts: await listAccounts(user.id) });
  });

  r.post("/accounts/:id/ingest", async (c) => {
    const user = c.get("user")!;
    const acct = await getDecryptedAccount(c.req.param("id"));
    if (!acct || acct.userId !== user.id) return c.json({ error: "not_found" }, 404);
    const ingestor = new LinkedInApiIngestor({ accessToken: acct.accessToken, memberUrn: acct.memberUrn });
    try {
      const posts = await ingestor.fetch();
      return c.json(await upsertPosts(acct.id, "linkedin_api", posts));
    } catch (e) {
      if (e instanceof LinkedInReadUnavailableError) {
        return c.json({ error: "read_unavailable", hint: "Import your Shares.csv export instead." }, 409);
      }
      throw e;
    }
  });

  r.post("/accounts/:id/import", async (c) => {
    const user = c.get("user")!;
    const acct = await getDecryptedAccount(c.req.param("id"));
    if (!acct || acct.userId !== user.id) return c.json({ error: "not_found" }, 404);
    const csv = await c.req.text();
    const ingestor = new CsvShareIngestor(csv);
    const posts = await ingestor.fetch();
    const result = await upsertPosts(acct.id, "csv_import", posts);
    return c.json({ ...result, malformed: ingestor.skipped });
  });

  return r;
}
