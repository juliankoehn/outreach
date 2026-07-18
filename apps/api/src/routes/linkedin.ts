// apps/api/src/routes/linkedin.ts
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { randomBytes } from "node:crypto";
import {
  LinkedInOAuthClient,
  LinkedInApiIngestor,
  CsvShareIngestor,
  LinkedInReadUnavailableError,
  MemberAnalyticsClient,
} from "@outreach/linkedin";
import type { AppEnv } from "../app.js";
import { env } from "../env.js";
import { signState, verifyState } from "../oauth-state.js";
import {
  saveLinkedInAccount,
  getDecryptedAccount,
  listAccounts,
  getAccountSummary,
} from "../repos/linkedin-account.js";
import { upsertPosts, listPosts, postsToEnrich, setPostMetrics } from "../repos/post.js";

/** Run `fn` over `items` with at most `limit` concurrent executions. */
async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]!);
    }
  });
  await Promise.all(workers);
}

const ENRICH_LIMIT = 25;

// Scopes granted by the Community Management API product:
//  r_basicprofile        — identity (name, headline, photo) for /v2/me
//  r_member_postAnalytics — read the member's own posts + reporting data
//  w_member_social        — create/modify/delete posts (used by the scheduler later)
const SCOPES = ["r_basicprofile", "r_member_postAnalytics", "w_member_social"];

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
    setCookie(c, "li_oauth_state", state, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: 600,
      secure: process.env.NODE_ENV === "production",
    });
    return c.redirect(withState);
  });

  r.get("/callback", async (c) => {
    // LinkedIn returns ?error=...&error_description=... when the member denies
    // consent or a scope is not authorized. Surface it in the UI rather than
    // masking it as an opaque state error.
    const oauthError = c.req.query("error");
    if (oauthError) {
      const desc = c.req.query("error_description") ?? oauthError;
      return c.redirect(`${env.WEB_ORIGIN}/accounts?error=${encodeURIComponent(desc)}`);
    }

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

  r.get("/accounts/:id/analytics", async (c) => {
    const user = c.get("user")!;
    const acct = await getDecryptedAccount(c.req.param("id"), user.id);
    if (!acct || acct.userId !== user.id) return c.json({ error: "not_found" }, 404);
    const client = new MemberAnalyticsClient({
      accessToken: acct.accessToken,
      apiVersion: env.LINKEDIN_API_VERSION,
    });
    try {
      return c.json({ metrics: await client.aggregate() });
    } catch {
      return c.json({ error: "analytics_unavailable" }, 502);
    }
  });

  r.get("/accounts/:id/posts", async (c) => {
    const user = c.get("user")!;
    const acct = await getDecryptedAccount(c.req.param("id"), user.id);
    if (!acct || acct.userId !== user.id) return c.json({ error: "not_found" }, 404);
    return c.json({ posts: await listPosts(acct.id) });
  });

  r.post("/accounts/:id/enrich", async (c) => {
    const user = c.get("user")!;
    const acct = await getDecryptedAccount(c.req.param("id"), user.id);
    if (!acct || acct.userId !== user.id) return c.json({ error: "not_found" }, 404);

    const targets = await postsToEnrich(acct.id, ENRICH_LIMIT);
    if (targets.length === 0) return c.json({ enriched: 0, failed: 0, total: 0 });

    const client = new MemberAnalyticsClient({
      accessToken: acct.accessToken,
      apiVersion: env.LINKEDIN_API_VERSION,
    });
    let enriched = 0;
    let failed = 0;
    await mapLimit(targets, 3, async (p) => {
      try {
        const metrics = await client.forPost(p.externalId!);
        await setPostMetrics(p.id, metrics);
        enriched++;
      } catch {
        failed++;
      }
    });
    return c.json({ enriched, failed, total: targets.length });
  });

  r.get("/accounts/:id", async (c) => {
    const user = c.get("user")!;
    const acct = await getAccountSummary(c.req.param("id"), user.id);
    if (!acct) return c.json({ error: "not_found" }, 404);
    return c.json({ account: acct });
  });

  r.get("/accounts", async (c) => {
    const user = c.get("user")!;
    return c.json({ accounts: await listAccounts(user.id) });
  });

  r.post("/accounts/:id/ingest", async (c) => {
    const user = c.get("user")!;
    const acct = await getDecryptedAccount(c.req.param("id"), user.id);
    if (!acct || acct.userId !== user.id) return c.json({ error: "not_found" }, 404);
    const ingestor = new LinkedInApiIngestor({
      accessToken: acct.accessToken,
      memberUrn: acct.memberUrn,
      apiVersion: env.LINKEDIN_API_VERSION,
    });
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
    const acct = await getDecryptedAccount(c.req.param("id"), user.id);
    if (!acct || acct.userId !== user.id) return c.json({ error: "not_found" }, 404);
    const csv = await c.req.text();
    const ingestor = new CsvShareIngestor(csv);
    const posts = await ingestor.fetch();
    const result = await upsertPosts(acct.id, "csv_import", posts);
    return c.json({ ...result, malformed: ingestor.skipped });
  });

  return r;
}
