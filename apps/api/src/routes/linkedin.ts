// apps/api/src/routes/linkedin.ts
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import {
  LinkedInOAuthClient,
  LinkedInApiIngestor,
  CsvShareIngestor,
  LinkedInReadUnavailableError,
  MemberAnalyticsClient,
  extractEmbedUrl,
  parseEmbedHtml,
} from "@outreach/linkedin";
import type { AppEnv } from "../app.js";
import type { RawPost, MediaType } from "@outreach/core";
import { env } from "../env.js";
import { signState, verifyState } from "../oauth-state.js";
import {
  saveLinkedInAccount,
  getDecryptedAccount,
  listAccounts,
  getAccountSummary,
  setAccountImageProvider,
  getAnalyticsCache,
  setAnalyticsCache,
} from "../repos/linkedin-account.js";
import { upsertPosts, listPosts, getPostDetail, setPostAnalysis } from "../repos/post.js";
import { enrichAccountMetrics } from "../analytics/enrich.js";
import { getOrCreateAccountProfile, getAccountProfile, updateProfileById } from "../repos/profile.js";
import { isPrivateOrLoopbackIp } from "../net.js";
import { isImageProviderEnabled, analyzePost, engagementRate, type PostMetrics } from "@outreach/ai";
import type { DerivedInsights } from "@outreach/ai";

export { isPrivateOrLoopbackIp };

// Aggregate metrics are lifetime totals that barely move; refresh at most every
// 6 hours to stay well under LinkedIn's per-day analytics throttle.
const ANALYTICS_TTL_MS = 6 * 60 * 60 * 1000;

// Scopes granted by the Community Management API product:
//  r_basicprofile        — identity (name, headline, photo) for /v2/me
//  r_member_postAnalytics — read the member's own posts + reporting data
//  w_member_social        — create/modify/delete posts (used by the scheduler later)
// NOTE: reading social actions (comments/reactions on the member's posts) needs
// r_member_social, which is a Community Management API *upgrade* this app does not
// have. Until then, post analysis is grounded in text + metrics + profile only.
const SCOPES = ["r_basicprofile", "r_member_postAnalytics", "w_member_social"];

const LINKEDIN_HOST_RE = /(^|\.)linkedin\.com$/;

/** The single host allowlist check reused for the initial URL and every redirect hop. */
export function isLinkedInHost(hostname: string): boolean {
  return LINKEDIN_HOST_RE.test(hostname);
}

const MAX_EMBED_REDIRECTS = 5;

async function assertSafeLinkedInUrl(url: URL): Promise<void> {
  if (!isLinkedInHost(url.hostname)) throw new Error(`Host not on linkedin.com allowlist: ${url.hostname}`);
  const addresses = await lookup(url.hostname, { all: true });
  if (addresses.length === 0) throw new Error(`Could not resolve host: ${url.hostname}`);
  for (const { address } of addresses) {
    if (isPrivateOrLoopbackIp(address)) {
      throw new Error(`Host resolves to a private/loopback address: ${url.hostname} -> ${address}`);
    }
  }
}

/**
 * Fetch an embed URL with redirects handled manually so that every hop —
 * not just the initial URL — is re-checked against the linkedin.com host
 * allowlist AND has its resolved IP checked against private/loopback ranges.
 * `fetch(..., { redirect: "follow" })` would otherwise let a redirect (e.g.
 * to an internal address, or DNS-rebound to one) bypass both checks.
 */
async function fetchEmbedSafely(startUrl: string): Promise<Response> {
  let current = new URL(startUrl);
  for (let hop = 0; hop <= MAX_EMBED_REDIRECTS; hop++) {
    await assertSafeLinkedInUrl(current);
    const res = await fetch(current, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; OutreachBot/1.0)" },
      signal: AbortSignal.timeout(12_000),
      redirect: "manual",
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new Error("Redirect response missing Location header");
      current = new URL(location, current);
      continue;
    }
    return res;
  }
  throw new Error("Too many redirects");
}

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

    const force = c.req.query("refresh") === "1";
    const cache = await getAnalyticsCache(acct.id);
    const cachedAt = cache?.analyticsAt ?? null;
    const isFresh = cachedAt && Date.now() - cachedAt.getTime() < ANALYTICS_TTL_MS;

    // Serve a fresh cache without touching LinkedIn.
    if (cache?.analytics && isFresh && !force) {
      return c.json({ metrics: cache.analytics, cachedAt, stale: false });
    }

    const client = new MemberAnalyticsClient({
      accessToken: acct.accessToken,
      apiVersion: env.LINKEDIN_API_VERSION,
    });
    try {
      const metrics = await client.aggregate();
      await setAnalyticsCache(acct.id, metrics);
      return c.json({ metrics, cachedAt: new Date(), stale: false });
    } catch {
      // On failure (e.g. 429 rate limit) fall back to any cached value.
      if (cache?.analytics) return c.json({ metrics: cache.analytics, cachedAt, stale: true });
      return c.json({ error: "analytics_unavailable" }, 502);
    }
  });

  r.get("/accounts/:id/posts", async (c) => {
    const user = c.get("user")!;
    const acct = await getDecryptedAccount(c.req.param("id"), user.id);
    if (!acct || acct.userId !== user.id) return c.json({ error: "not_found" }, 404);
    return c.json({ posts: await listPosts(acct.id) });
  });

  // Force a fresh analysis for one post, grounded in metrics + profile + baseline.
  async function analyzeOne(accountId: string, userId: string, postId: string) {
    const detail = await getPostDetail(accountId, postId);
    if (!detail) return null;
    const metrics = (detail.metrics ?? null) as PostMetrics | null;
    const baseline = ((await getAnalyticsCache(accountId))?.analytics ?? null) as PostMetrics | null;
    const profile = await getAccountProfile(accountId);
    const analysis = await analyzePost({
      text: detail.text,
      mediaType: detail.mediaType,
      publishedAt: detail.publishedAt.toISOString(),
      metrics,
      engagementRate: engagementRate(metrics),
      baseline,
      profile: profile
        ? { goals: profile.goals, audience: profile.audience, pillars: profile.pillars, toneWords: profile.toneWords, noGos: profile.noGos, brandBrief: profile.brandBrief }
        : null,
    });
    await setPostAnalysis(postId, { ...analysis, basis: { impressions: metrics?.impressions ?? 0 } });
    return getPostDetail(accountId, postId);
  }

  r.get("/accounts/:id/posts/:postId", async (c) => {
    const user = c.get("user")!;
    const accountId = c.req.param("id");
    if (!(await getAccountSummary(accountId, user.id))) return c.json({ error: "not_found" }, 404);
    const detail = await getPostDetail(accountId, c.req.param("postId"));
    if (!detail) return c.json({ error: "not_found" }, 404);
    const metrics = (detail.metrics ?? null) as PostMetrics | null;
    const baseline = (await getAnalyticsCache(accountId))?.analytics ?? null;
    return c.json({ post: { ...detail, engagementRate: engagementRate(metrics) }, baseline });
  });

  r.post("/accounts/:id/posts/:postId/analyze", async (c) => {
    const user = c.get("user")!;
    const accountId = c.req.param("id");
    if (!(await getAccountSummary(accountId, user.id))) return c.json({ error: "not_found" }, 404);
    const post = await analyzeOne(accountId, user.id, c.req.param("postId"));
    if (!post) return c.json({ error: "not_found" }, 404);
    const metrics = (post.metrics ?? null) as PostMetrics | null;
    return c.json({ post: { ...post, engagementRate: engagementRate(metrics) } });
  });

  r.post("/accounts/:id/posts/:postId/learnings", async (c) => {
    const user = c.get("user")!;
    const accountId = c.req.param("id");
    if (!(await getAccountSummary(accountId, user.id))) return c.json({ error: "not_found" }, 404);
    const body = await c.req.json<{ accepted?: string[] }>().catch(() => ({ accepted: [] as string[] }));
    const accepted = (body.accepted ?? []).map((s) => s.trim()).filter(Boolean);

    const profile = await getAccountProfile(accountId);
    if (!profile) return c.json({ error: "no_profile" }, 400);
    const derived = (profile.derived as unknown as DerivedInsights | null) ?? {
      voiceSummary: "", visualStyle: "", themes: [], styleTraits: [], cadence: "", topPatterns: [],
    };
    const topPatterns = [...derived.topPatterns];
    for (const v of accepted) {
      if (!topPatterns.some((x) => x.toLowerCase() === v.toLowerCase())) topPatterns.push(v);
    }
    await updateProfileById(profile.id, user.id, { derived: { ...derived, topPatterns } });
    return c.json({ topPatterns });
  });

  r.post("/accounts/:id/enrich", async (c) => {
    const user = c.get("user")!;
    if (!(await getAccountSummary(c.req.param("id"), user.id))) return c.json({ error: "not_found" }, 404);
    return c.json(await enrichAccountMetrics(c.req.param("id"), user.id, { force: true }));
  });

  r.get("/accounts/:id", async (c) => {
    const user = c.get("user")!;
    const acct = await getAccountSummary(c.req.param("id"), user.id);
    if (!acct) return c.json({ error: "not_found" }, 404);
    return c.json({ account: acct });
  });

  // Update account settings. Currently just the default image provider: accepts
  // an enabled provider id, or null to fall back to the environment default.
  r.patch("/accounts/:id/settings", async (c) => {
    const user = c.get("user")!;
    const body = await c.req
      .json<{ imageProvider?: string | null }>()
      .catch(() => ({}) as { imageProvider?: string | null });
    if (!("imageProvider" in body)) return c.json({ error: "invalid_body" }, 400);
    const raw = body.imageProvider;
    // null clears the override; otherwise the provider must be enabled here.
    if (raw !== null && !isImageProviderEnabled(raw)) {
      return c.json({ error: "provider_not_enabled" }, 400);
    }
    const updated = await setAccountImageProvider(c.req.param("id"), user.id, raw ?? null);
    if (!updated) return c.json({ error: "not_found" }, 404);
    return c.json({ imageProvider: updated.imageProvider });
  });

  // The account's creator profile (created + linked on first access).
  r.get("/accounts/:id/profile", async (c) => {
    const user = c.get("user")!;
    const profile = await getOrCreateAccountProfile(c.req.param("id"), user.id);
    if (!profile) return c.json({ error: "not_found" }, 404);
    return c.json({ profile });
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

  // Parse a pasted "Embed this post" snippet: fetch the public embed HTML and
  // pull out the text, social counts, image and media type — a preview the
  // creator reviews before saving. Nothing is stored here.
  r.post("/accounts/:id/posts/parse", async (c) => {
    const user = c.get("user")!;
    const acct = await getAccountSummary(c.req.param("id"), user.id);
    if (!acct) return c.json({ error: "not_found" }, 404);

    const { embed } = await c.req.json<{ embed?: string }>().catch(() => ({}) as { embed?: string });
    const embedUrl = extractEmbedUrl(embed ?? "");
    if (!embedUrl) return c.json({ error: "no_embed" }, 400);
    // Defence in depth: only ever fetch LinkedIn embed URLs (extractEmbedUrl
    // already guarantees this, but re-check the host before making the request).
    let host = "";
    try {
      host = new URL(embedUrl).hostname;
    } catch {
      return c.json({ error: "no_embed" }, 400);
    }
    if (!isLinkedInHost(host)) return c.json({ error: "no_embed" }, 400);

    let html: string;
    try {
      // fetchEmbedSafely re-checks the same host allowlist (and a resolved-IP
      // private/loopback check) on every redirect hop, not just this first URL.
      const res = await fetchEmbedSafely(embedUrl);
      if (!res.ok) return c.json({ error: "fetch_failed", status: res.status }, 502);
      html = await res.text();
    } catch {
      return c.json({ error: "fetch_failed" }, 502);
    }

    const parsed = parseEmbedHtml(html);
    if (!parsed.text) return c.json({ error: "no_content" }, 422);
    return c.json({ urn: parsePostUrn(embedUrl), embedUrl, ...parsed });
  });

  // Save pasted posts. Each entry carries its own source ("manual" typed in, or
  // "embed" auto-filled from the parser) so the UI can tell them apart later.
  r.post("/accounts/:id/posts/manual", async (c) => {
    const user = c.get("user")!;
    // Ownership only — this never calls LinkedIn, so don't decrypt the token.
    const acct = await getAccountSummary(c.req.param("id"), user.id);
    if (!acct) return c.json({ error: "not_found" }, 404);

    type ManualEntry = {
      text?: string;
      url?: string;
      publishedAt?: string;
      source?: string;
      mediaType?: string;
      imageUrl?: string;
      metrics?: { impressions?: unknown; reactions?: unknown; comments?: unknown };
    };
    const body = await c.req
      .json<{ posts?: ManualEntry[] }>()
      .catch(() => ({}) as { posts?: ManualEntry[] });

    const entries = (body.posts ?? [])
      .map((p) => ({
        text: (p.text ?? "").trim(),
        url: p.url?.trim() || undefined,
        publishedAt: p.publishedAt,
        source: p.source === "embed" ? ("embed" as const) : ("manual" as const),
        mediaType: MEDIA_TYPES.has(p.mediaType ?? "") ? (p.mediaType as MediaType) : ("none" as MediaType),
        imageUrl: p.imageUrl?.trim() || undefined,
        metrics: cleanMetrics(p.metrics),
      }))
      .filter((p) => p.text.length > 0);
    if (entries.length === 0) return c.json({ error: "invalid_body" }, 400);

    // upsertPosts stamps one source per call, so batch entries by their source.
    const bySource = new Map<"manual" | "embed", RawPost[]>();
    for (const p of entries) {
      const raw: RawPost = {
        externalId: parsePostUrn(p.url),
        text: p.text,
        mediaType: p.mediaType,
        publishedAt: safeDate(p.publishedAt),
        // Stored in the analyze/enrich shape ({impressions,reactions,comments}),
        // which differs from RawPost's PostMetrics — hence the cast.
        metrics: p.metrics as unknown as RawPost["metrics"],
        raw: { source: p.source, url: p.url ?? null, imageUrl: p.imageUrl ?? null },
      };
      (bySource.get(p.source) ?? bySource.set(p.source, []).get(p.source)!).push(raw);
    }

    let inserted = 0;
    let skipped = 0;
    for (const [source, raws] of bySource) {
      const r = await upsertPosts(acct.id, source, raws);
      inserted += r.inserted;
      skipped += r.skipped;
    }
    return c.json({ inserted, skipped });
  });

  return r;
}

const MEDIA_TYPES = new Set<string>(["none", "image", "video", "article", "carousel"]);

/**
 * Pull a LinkedIn post URN out of a pasted share/post URL, preserving its type.
 * The analytics API keys on `share`/`ugcPost` URNs; a feed link usually carries
 * an `activity` URN (which wraps a share) — we keep whatever type is present so
 * enrichment can use it where LinkedIn allows.
 */
export function parsePostUrn(url?: string): string | null {
  if (!url) return null;
  const explicit = url.match(/urn:li:(activity|ugcPost|share):(\d+)/);
  if (explicit) return `urn:li:${explicit[1]}:${explicit[2]}`;
  const slug = url.match(/activity[:-](\d{6,})/);
  return slug ? `urn:li:activity:${slug[1]}` : null;
}

/** Parse an ISO date string, falling back to now for empty/invalid input. */
function safeDate(iso?: string): Date {
  if (!iso) return new Date();
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

/**
 * Coerce user-entered engagement numbers into the analyze/enrich metric shape.
 * Returns undefined if nothing usable was provided, so posts without stats
 * stay metric-less rather than storing zeros.
 */
export function cleanMetrics(m?: {
  impressions?: unknown;
  reactions?: unknown;
  comments?: unknown;
}): { impressions?: number; reactions?: number; comments?: number } | undefined {
  if (!m) return undefined;
  const num = (v: unknown): number | undefined => {
    let n: number;
    if (typeof v === "string") {
      const s = v.replace(/[,\s]/g, "");
      if (s === "") return undefined; // empty input, not zero
      n = Number(s);
    } else if (typeof v === "number") {
      n = v;
    } else {
      return undefined;
    }
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
  };
  const out: { impressions?: number; reactions?: number; comments?: number } = {};
  const impressions = num(m.impressions);
  const reactions = num(m.reactions);
  const comments = num(m.comments);
  if (impressions !== undefined) out.impressions = impressions;
  if (reactions !== undefined) out.reactions = reactions;
  if (comments !== undefined) out.comments = comments;
  return Object.keys(out).length > 0 ? out : undefined;
}
