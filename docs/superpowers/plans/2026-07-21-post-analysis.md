# Post Detail + AI Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-post detail page with an AI analysis whose confirmed learnings feed the profile's `derived.topPatterns`, closing the learn-again loop.

**Architecture:** New `analyzePost` in `@outreach/ai` (generateObject). Enrich runs it (skip-if-fresh/force) and stores `Post.analysis`. New api routes serve the detail, force a single analysis, and merge accepted learnings into the profile. A new web detail page renders the post (shared `FeedPostShell`), a metrics grid, and the analysis with accept/reject.

**Tech Stack:** Prisma 7 (pg adapter), Hono, Vercel AI SDK v7 (`generateObject`), Next.js (App Router), next-intl, vitest.

## Global Constraints

- Comments are OUT OF SCOPE (needs the unavailable `r_member_social` scope). Analysis is grounded in post text + metrics + profile only.
- Engagement rate = `(reactions + comments + reshares) / impressions`, and is `0` when impressions is `0` (never divide by zero / NaN).
- Migrations: hand-craft SQL + `prisma migrate deploy` (never `migrate dev` — checksum drift resets the DB). Keep the `resource_chunk_embedding_hnsw` index intact.
- The studio writer already folds `derived.topPatterns` into its context — learnings merge there, nothing else to wire.
- i18n: every user-facing string via next-intl, keys in BOTH `apps/web/messages/en.json` and `de.json`.
- Money-guard on auto-analysis: the daily worker only (re)analyses when `analyzedAt` is null OR current impressions differ from the stored `analysis.basis.impressions`; manual enrich / the button forces it.

---

### Task 1: Schema — `Post.analysis` + `analyzedAt`

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260721120000_post_analysis/migration.sql`

**Interfaces:**
- Produces: `Post.analysis Json?`, `Post.analyzedAt DateTime?`

- [ ] **Step 1: Add the columns to the schema**

In `model Post`, after `raw   Json?`:

```prisma
  analysis          Json?
  analyzedAt        DateTime?
```

- [ ] **Step 2: Hand-craft the migration**

Create `packages/db/prisma/migrations/20260721120000_post_analysis/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "Post" ADD COLUMN "analysis" JSONB;
ALTER TABLE "Post" ADD COLUMN "analyzedAt" TIMESTAMP(3);
```

- [ ] **Step 3: Apply + regenerate + verify**

Run (from repo root, with `DATABASE_URL="postgresql://outreach:outreach@localhost:5544/outreach"`):

```bash
pnpm --filter @outreach/db exec prisma migrate deploy
pnpm --filter @outreach/db exec prisma generate
psql "$DATABASE_URL" -tAc "SELECT indexname FROM pg_indexes WHERE indexname='resource_chunk_embedding_hnsw';"
psql "$DATABASE_URL" -tAc "SELECT column_name FROM information_schema.columns WHERE table_name='Post' AND column_name IN ('analysis','analyzedAt') ORDER BY 1;"
```
Expected: migration applies; HNSW index printed; both columns printed.

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma
git commit -m "feat(db): Post.analysis + analyzedAt columns"
```

---

### Task 2: AI — `analyzePost` + `engagementRate`

**Files:**
- Create: `packages/ai/src/analyze-post.ts`
- Modify: `packages/ai/src/index.ts`
- Test: `packages/ai/src/analyze-post.test.ts`

**Interfaces:**
- Produces:
  - `engagementRate(m): number`
  - `POST_ANALYSIS_SCHEMA` (zod), `type PostAnalysis`
  - `type AnalyzePostInput`
  - `analyzePost(input: AnalyzePostInput, opts?: { model?: LanguageModel }): Promise<PostAnalysis>`

- [ ] **Step 1: Write the failing test**

Create `packages/ai/src/analyze-post.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { analyzePost, engagementRate, POST_ANALYSIS_SCHEMA } from "./analyze-post.js";
import { textModel } from "./testing.js";

describe("engagementRate", () => {
  it("computes (reactions+comments+reshares)/impressions", () => {
    expect(engagementRate({ impressions: 1000, reactions: 30, comments: 15, reshares: 5 })).toBeCloseTo(0.05);
  });
  it("is 0 when impressions is 0 or missing", () => {
    expect(engagementRate({ impressions: 0, reactions: 5 })).toBe(0);
    expect(engagementRate(null)).toBe(0);
    expect(engagementRate({ reactions: 5 })).toBe(0);
  });
});

const ANALYSIS = {
  performance: { summary: "Strong hook drove above-average reach.", verdict: "over" },
  teardown: { hook: "Contrarian one-liner", structure: "short paras", pillar: "AI governance", format: "text-only, worked", cta: "question", toneMatch: "on-brand" },
  goalFit: "Advances the thought-leadership goal.",
  learnings: ["Contrarian hooks outperform", "Keep it text-only for reach"],
};

describe("analyzePost", () => {
  it("returns a schema-valid analysis grounded in the input", async () => {
    const model = textModel(JSON.stringify(ANALYSIS));
    const out = await analyzePost(
      {
        text: "Unpopular opinion: ...",
        mediaType: "none",
        publishedAt: "2026-06-01",
        metrics: { impressions: 5000, reactions: 120, comments: 20, reshares: 8 },
        engagementRate: 0.0296,
        baseline: { impressions: 3000, reactions: 40, comments: 5 },
        profile: { goals: ["thought leadership"], pillars: ["AI governance"], toneWords: ["direct"] },
      },
      { model },
    );
    expect(POST_ANALYSIS_SCHEMA.safeParse(out).success).toBe(true);
    expect(out.performance.verdict).toBe("over");
    expect(out.learnings.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @outreach/ai exec vitest run src/analyze-post.test.ts`
Expected: FAIL — module `./analyze-post.js` not found.

- [ ] **Step 3: Implement `analyze-post.ts`**

Create `packages/ai/src/analyze-post.ts`:

```ts
import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import { getTextModel } from "./provider.js";

export interface PostMetrics {
  impressions?: number;
  membersReached?: number;
  reactions?: number;
  comments?: number;
  reshares?: number;
}

// (reactions + comments + reshares) / impressions; 0 when impressions is 0/absent.
export function engagementRate(m: PostMetrics | null | undefined): number {
  const impr = m?.impressions ?? 0;
  if (!impr) return 0;
  return ((m?.reactions ?? 0) + (m?.comments ?? 0) + (m?.reshares ?? 0)) / impr;
}

export const POST_ANALYSIS_SCHEMA = z.object({
  performance: z.object({
    summary: z.string().describe("One paragraph: how the post performed and WHY, grounded strictly in the given metrics."),
    verdict: z.enum(["over", "on-par", "under"]).describe("Engagement vs. the account's typical baseline."),
  }),
  teardown: z.object({
    hook: z.string().describe("The opening line's strength/approach."),
    structure: z.string().describe("Structure/format read (length, paragraphing, list, etc.)."),
    pillar: z.string().describe("Which of the creator's content pillars it fits, or 'none'."),
    format: z.string().describe("Media used (text-only/image/…) and whether it helped."),
    cta: z.string().describe("The call to action, or its absence."),
    toneMatch: z.string().describe("How well it matches the creator's tone/brand."),
  }),
  goalFit: z.string().describe("Did it serve the creator's stated goals?"),
  learnings: z
    .array(z.string())
    .min(1)
    .max(5)
    .describe("Concrete, reusable, forward-looking takeaways for FUTURE posts — each short enough to be a rule."),
});
export type PostAnalysis = z.infer<typeof POST_ANALYSIS_SCHEMA>;

export interface AnalyzePostInput {
  text: string;
  mediaType: string;
  publishedAt: string;
  metrics: PostMetrics | null;
  engagementRate: number;
  baseline?: PostMetrics | null;
  profile?: {
    goals?: string[];
    audience?: string;
    pillars?: string[];
    toneWords?: string[];
    noGos?: string[];
    brandBrief?: string;
  } | null;
}

function buildPrompt(i: AnalyzePostInput): string {
  const m = i.metrics ?? {};
  const p = i.profile ?? {};
  const lines = [
    `PUBLISHED POST (${i.publishedAt}, media=${i.mediaType || "none"}):`,
    `"""${i.text}"""`,
    "",
    "METRICS (ground everything in these — never invent numbers):",
    `- impressions: ${m.impressions ?? "?"}`,
    `- members reached: ${m.membersReached ?? "?"}`,
    `- reactions: ${m.reactions ?? "?"}`,
    `- comments: ${m.comments ?? "?"}`,
    `- reshares: ${m.reshares ?? "?"}`,
    `- engagement rate: ${(i.engagementRate * 100).toFixed(2)}%`,
  ];
  if (i.baseline) {
    lines.push(
      "",
      `ACCOUNT BASELINE (typical, for the verdict): impressions ${i.baseline.impressions ?? "?"}, reactions ${i.baseline.reactions ?? "?"}, comments ${i.baseline.comments ?? "?"}.`,
    );
  }
  lines.push(
    "",
    "CREATOR PROFILE:",
    p.goals?.length ? `- goals: ${p.goals.join(", ")}` : "- goals: (none set)",
    p.audience ? `- audience: ${p.audience}` : "",
    p.pillars?.length ? `- pillars: ${p.pillars.join(", ")}` : "",
    p.toneWords?.length ? `- tone: ${p.toneWords.join(", ")}` : "",
    p.noGos?.length ? `- no-gos: ${p.noGos.join(", ")}` : "",
    p.brandBrief ? `- brand brief: ${p.brandBrief}` : "",
  );
  return lines.filter(Boolean).join("\n");
}

export async function analyzePost(input: AnalyzePostInput, opts?: { model?: LanguageModel }): Promise<PostAnalysis> {
  const model = opts?.model ?? getTextModel();
  const { object } = await generateObject({
    model,
    schema: POST_ANALYSIS_SCHEMA,
    system:
      "You are a LinkedIn content strategist. Analyse ONE published post using ONLY the data provided. Judge performance against the account baseline, tear down what worked/didn't, assess fit to the creator's goals, and distil 3–5 concrete, reusable learnings that should shape FUTURE posts. Never fabricate metrics; if data is missing, say so.",
    messages: [{ role: "user", content: buildPrompt(input) }],
  });
  return object;
}
```

- [ ] **Step 4: Export from the package index**

In `packages/ai/src/index.ts`, add:

```ts
export { analyzePost, engagementRate, POST_ANALYSIS_SCHEMA } from "./analyze-post.js";
export type { PostAnalysis, AnalyzePostInput, PostMetrics } from "./analyze-post.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @outreach/ai exec vitest run src/analyze-post.test.ts && pnpm --filter @outreach/ai lint`
Expected: PASS (3 tests) + typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/ai/src/analyze-post.ts packages/ai/src/analyze-post.test.ts packages/ai/src/index.ts
git commit -m "feat(ai): analyzePost + engagementRate"
```

---

### Task 3: Post repo — detail read + analysis write

**Files:**
- Modify: `apps/api/src/repos/post.ts`
- Test: `apps/api/src/repos/post-analysis.test.ts`

**Interfaces:**
- Consumes: `imageUrlFromRaw(raw)` (existing private helper in `post.ts`).
- Produces:
  - `getPostDetail(accountId, postId): Promise<PostDetail | null>` where `PostDetail = { id, text, publishedAt, mediaType, externalId, metrics, source, imageUrl, analysis, analyzedAt }`
  - `setPostAnalysis(postId, analysis): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/repos/post-analysis.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@outreach/db";
import { getPostDetail, setPostAnalysis } from "./post.js";

let accountId = "", postId = "", userId = "";

beforeAll(async () => {
  const user = await prisma.user.create({ data: { email: `pa${Date.now()}@ex.com`, name: "t" } });
  userId = user.id;
  const acct = await prisma.linkedInAccount.create({
    data: { userId, memberUrn: `urn:li:person:${Date.now()}`, displayName: "T", accessToken: "x", scopes: [] },
  });
  accountId = acct.id;
  const post = await prisma.post.create({
    data: {
      linkedinAccountId: accountId, source: "linkedin_api", dedupeHash: `h${Date.now()}`,
      text: "hello", mediaType: "none", publishedAt: new Date(),
      metrics: { impressions: 100, reactions: 5 }, raw: { imageUrl: "/generated/x.jpg" },
    },
  });
  postId = post.id;
});

afterAll(async () => {
  await prisma.user.delete({ where: { id: userId } });
});

describe("getPostDetail / setPostAnalysis", () => {
  it("returns the post with imageUrl flattened and null analysis initially", async () => {
    const d = await getPostDetail(accountId, postId);
    expect(d?.text).toBe("hello");
    expect(d?.imageUrl).toBe("/generated/x.jpg");
    expect(d?.analysis).toBeNull();
  });
  it("stores + reads back an analysis with analyzedAt", async () => {
    await setPostAnalysis(postId, { performance: { verdict: "over" }, basis: { impressions: 100 } });
    const d = await getPostDetail(accountId, postId);
    expect((d?.analysis as { basis?: { impressions?: number } }).basis?.impressions).toBe(100);
    expect(d?.analyzedAt).toBeInstanceOf(Date);
  });
  it("scopes by account (foreign account → null)", async () => {
    expect(await getPostDetail("nope", postId)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @outreach/api exec vitest run src/repos/post-analysis.test.ts`
Expected: FAIL — `getPostDetail`/`setPostAnalysis` not exported.

- [ ] **Step 3: Implement the repo functions**

In `apps/api/src/repos/post.ts`, add (after `listPosts`):

```ts
export interface PostDetail {
  id: string;
  text: string;
  publishedAt: Date;
  mediaType: string;
  externalId: string | null;
  metrics: unknown;
  source: string;
  imageUrl: string | null;
  analysis: unknown;
  analyzedAt: Date | null;
}

export async function getPostDetail(accountId: string, postId: string): Promise<PostDetail | null> {
  const p = await prisma.post.findFirst({
    where: { id: postId, linkedinAccountId: accountId },
    select: {
      id: true, text: true, publishedAt: true, mediaType: true, externalId: true,
      metrics: true, source: true, raw: true, analysis: true, analyzedAt: true,
    },
  });
  if (!p) return null;
  const { raw, ...rest } = p;
  return { ...rest, imageUrl: imageUrlFromRaw(raw) };
}

export async function setPostAnalysis(postId: string, analysis: object): Promise<void> {
  await prisma.post.update({ where: { id: postId }, data: { analysis, analyzedAt: new Date() } });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @outreach/api exec vitest run src/repos/post-analysis.test.ts && pnpm --filter @outreach/api lint`
Expected: PASS (3 tests) + typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/repos/post.ts apps/api/src/repos/post-analysis.test.ts
git commit -m "feat(api): getPostDetail + setPostAnalysis repo fns"
```

---

### Task 4: Enrich — run analyzePost (skip-if-fresh / force)

**Files:**
- Modify: `apps/api/src/analytics/enrich.ts`
- Test: `apps/api/src/analytics/enrich-analysis.test.ts`

**Interfaces:**
- Consumes: `engagementRate`, `analyzePost`, `AnalyzePostInput` (`@outreach/ai`); `getPostDetail`, `setPostAnalysis` (Task 3); `getAccountProfile` (`repos/profile.js`); `getAnalyticsCache` (`repos/linkedin-account.js`).
- Produces: `enrichAccountMetrics(accountId, userId, { force?, deps? })` where `deps.analyzePost?` is injectable; the existing return type gains `analyzed: number`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/analytics/enrich-analysis.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@outreach/db";
import { encrypt } from "@outreach/core";
import { env } from "../env.js";
import { enrichAccountMetrics } from "./enrich.js";

let accountId = "", userId = "", postId = "";

beforeAll(async () => {
  const user = await prisma.user.create({ data: { email: `en${Date.now()}@ex.com`, name: "t" } });
  userId = user.id;
  const acct = await prisma.linkedInAccount.create({
    data: { userId, memberUrn: `urn:li:person:e${Date.now()}`, displayName: "T",
      accessToken: encrypt("tok", env.ENCRYPTION_KEY), scopes: [] },
  });
  accountId = acct.id;
  const post = await prisma.post.create({
    data: { linkedinAccountId: accountId, source: "linkedin_api", dedupeHash: `he${Date.now()}`,
      text: "hi", mediaType: "none", publishedAt: new Date(), externalId: `urn:li:share:${Date.now()}` },
  });
  postId = post.id;
});
afterAll(async () => { await prisma.user.delete({ where: { id: userId } }); });

const deps = (impr: number, analyzeSpy: () => void) => ({
  makeClient: () => ({ forPost: async () => ({ impressions: impr, reactions: 2, comments: 1, reshares: 0 }) }),
  analyzePost: async (input: unknown) => { analyzeSpy(); return {
    performance: { summary: "s", verdict: "on-par" }, teardown: { hook: "h", structure: "s", pillar: "p", format: "f", cta: "c", toneMatch: "t" }, goalFit: "g", learnings: ["l1"],
  }; },
});

describe("enrichAccountMetrics + analysis", () => {
  it("analyses on first enrich and stores basis", async () => {
    const spy = vi.fn();
    const r = await enrichAccountMetrics(accountId, userId, { deps: deps(500, spy) });
    expect(r.analyzed).toBe(1);
    expect(spy).toHaveBeenCalledTimes(1);
    const p = await prisma.post.findUnique({ where: { id: postId } });
    expect((p!.analysis as { basis: { impressions: number } }).basis.impressions).toBe(500);
  });
  it("skips re-analysis when impressions are unchanged", async () => {
    const spy = vi.fn();
    const r = await enrichAccountMetrics(accountId, userId, { deps: deps(500, spy) });
    expect(spy).not.toHaveBeenCalled();
    expect(r.analyzed).toBe(0);
  });
  it("re-analyses when impressions changed", async () => {
    const spy = vi.fn();
    await enrichAccountMetrics(accountId, userId, { deps: deps(900, spy) });
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it("force re-analyses even when unchanged", async () => {
    const spy = vi.fn();
    await enrichAccountMetrics(accountId, userId, { force: true, deps: deps(900, spy) });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @outreach/api exec vitest run src/analytics/enrich-analysis.test.ts`
Expected: FAIL — `r.analyzed` undefined / `force`/`deps.analyzePost` unsupported.

- [ ] **Step 3: Extend `enrich.ts`**

Replace the imports + `EnrichDeps` + the per-post loop in `apps/api/src/analytics/enrich.ts`:

```ts
import { MemberAnalyticsClient } from "@outreach/linkedin";
import { engagementRate, analyzePost as realAnalyzePost, type PostMetrics } from "@outreach/ai";
import { getDecryptedAccount, getAnalyticsCache } from "../repos/linkedin-account.js";
import { getAccountProfile } from "../repos/profile.js";
import { postsToEnrich, postsToEnrichRecent, setPostMetrics, getPostDetail, setPostAnalysis } from "../repos/post.js";
import { env } from "../env.js";
```

Add to `EnrichDeps`:

```ts
export interface EnrichDeps {
  makeClient?(accessToken: string): EnrichClient;
  analyzePost?: typeof realAnalyzePost;
}
```

Change the signature + body. Replace `opts?: { since?: Date; limit?: number; deps?: EnrichDeps }` with `opts?: { since?: Date; limit?: number; force?: boolean; deps?: EnrichDeps }` and the return type with `{ enriched: number; failed: number; analyzed: number; total: number }`. Load the profile + baseline once, then in the per-post step, after `setPostMetrics`, add the analysis:

```ts
  const analyze = opts?.deps?.analyzePost ?? realAnalyzePost;
  const profile = await getAccountProfile(accountId);
  const baseline = ((await getAnalyticsCache(accountId))?.analytics ?? null) as PostMetrics | null;

  let enriched = 0;
  let failed = 0;
  let analyzed = 0;
  await mapLimit(targets, 3, async (p) => {
    try {
      const metrics = (await client.forPost(p.externalId!)) as PostMetrics;
      await setPostMetrics(p.id, metrics);
      enriched++;

      // Money-guard: only (re)analyse on force, first-time, or when impressions moved.
      const detail = await getPostDetail(accountId, p.id);
      const prevBasis = (detail?.analysis as { basis?: { impressions?: number } } | null)?.basis?.impressions;
      const impressions = metrics.impressions ?? 0;
      if (opts?.force || !detail?.analyzedAt || prevBasis !== impressions) {
        const analysis = await analyze({
          text: detail?.text ?? "",
          mediaType: detail?.mediaType ?? "none",
          publishedAt: (detail?.publishedAt ?? new Date()).toISOString(),
          metrics,
          engagementRate: engagementRate(metrics),
          baseline,
          profile: profile
            ? { goals: profile.goals, audience: profile.audience, pillars: profile.pillars, toneWords: profile.toneWords, noGos: profile.noGos, brandBrief: profile.brandBrief }
            : null,
        });
        await setPostAnalysis(p.id, { ...analysis, basis: { impressions } });
        analyzed++;
      }
    } catch {
      failed++;
    }
  });
  return { enriched, failed, analyzed, total: targets.length };
```

(Keep the existing `targets`/`client` resolution above this block unchanged.)

- [ ] **Step 4: Make the manual `/enrich` route force re-analysis**

In `apps/api/src/routes/linkedin.ts`, the manual enrich handler (`r.post("/accounts/:id/enrich", …)`) calls `enrichAccountMetrics(...)`. Add `{ force: true }` so a user-triggered enrich always re-analyses:

```ts
const r = await enrichAccountMetrics(c.req.param("id"), user.id, { force: true });
```
Leave the auto-enrich worker caller (which passes `{ since }`) unchanged — it must keep the default skip-if-fresh behaviour.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @outreach/api exec vitest run src/analytics/enrich-analysis.test.ts src/analytics/enrich.test.ts && pnpm --filter @outreach/api lint`
Expected: PASS (new 4 + existing enrich tests) + typecheck clean. If an existing enrich test asserts the exact return shape, update it to include `analyzed`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/analytics/enrich.ts apps/api/src/analytics/enrich-analysis.test.ts apps/api/src/routes/linkedin.ts
git commit -m "feat(api): enrich runs analyzePost (skip-if-fresh / force)"
```

---

### Task 5: API routes — detail, analyze, learnings

**Files:**
- Modify: `apps/api/src/routes/linkedin.ts`
- Test: `apps/api/src/routes/post-detail.test.ts`

**Interfaces:**
- Consumes: `getPostDetail`, `setPostAnalysis` (Task 3); `getDecryptedAccount`, `getAnalyticsCache` (linkedin-account repo); `getAccountProfile`, `updateProfileById` (profile repo); `analyzePost`, `engagementRate`, `type PostMetrics`, `type DerivedInsights` (`@outreach/ai`).
- Produces (all under the existing `/linkedin` group, owner-checked with `getAccountSummary`):
  - `GET /accounts/:id/posts/:postId` → `{ post: PostDetail & { engagementRate: number }, baseline }`
  - `POST /accounts/:id/posts/:postId/analyze` → `{ post }` (forces one analysis)
  - `POST /accounts/:id/posts/:postId/learnings` body `{ accepted: string[] }` → `{ topPatterns: string[] }`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/routes/post-detail.test.ts` mirroring the auth/setup pattern of `apps/api/src/routes/studio.test.ts` (sign-up → create account + profile + post). Mock `@outreach/ai` so `analyzePost` returns a fixed object and `engagementRate` is the real one:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@outreach/ai", async (orig) => ({
  ...(await orig<typeof import("@outreach/ai")>()),
  analyzePost: vi.fn(async () => ({
    performance: { summary: "s", verdict: "over" },
    teardown: { hook: "h", structure: "s", pillar: "AI", format: "f", cta: "c", toneMatch: "t" },
    goalFit: "g", learnings: ["Contrarian hooks win", "Keep it short"],
  })),
}));

// ...standard app + authed() helpers (copy from studio.test.ts)...
// Create: account (encrypted token), a CreatorProfile assigned to it with derived.topPatterns: [],
//         and a Post with externalId + metrics { impressions: 1000, reactions: 30, comments: 10, reshares: 5 }.

describe("post detail + analyze + learnings", () => {
  it("GET detail returns the post + computed engagementRate", async () => {
    const res = await app.request(`/api/linkedin/accounts/${accountId}/posts/${postId}`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const { post } = await res.json();
    expect(post.engagementRate).toBeCloseTo(0.045);
  });

  it("POST analyze stores an analysis", async () => {
    const res = await app.request(`/api/linkedin/accounts/${accountId}/posts/${postId}/analyze`, { method: "POST", headers: { cookie } });
    expect(res.status).toBe(200);
    const { post } = await res.json();
    expect(post.analysis.learnings).toContain("Contrarian hooks win");
  });

  it("POST learnings merges accepted into the profile's derived.topPatterns", async () => {
    const res = await app.request(`/api/linkedin/accounts/${accountId}/posts/${postId}/learnings`, {
      method: "POST", headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ accepted: ["Contrarian hooks win", "contrarian hooks win"] }),
    });
    expect(res.status).toBe(200);
    const { topPatterns } = await res.json();
    // dedupe (case-insensitive) → one entry
    expect(topPatterns.filter((p: string) => p.toLowerCase() === "contrarian hooks win").length).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @outreach/api exec vitest run src/routes/post-detail.test.ts`
Expected: FAIL — routes return 404.

- [ ] **Step 3: Implement the routes**

In `apps/api/src/routes/linkedin.ts`, import the helpers (extend existing import lines):

```ts
import { getPostDetail, setPostAnalysis } from "../repos/post.js";
import { getAccountProfile, updateProfileById } from "../repos/profile.js";
import { analyzePost, engagementRate, type PostMetrics } from "@outreach/ai";
import type { DerivedInsights } from "@outreach/ai";
```

Add a shared analyze helper + the three routes (near the existing `/accounts/:id/posts` route):

```ts
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
```

(`getAnalyticsCache` is already imported in `linkedin.ts`; add it to the import if not.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @outreach/api exec vitest run src/routes/post-detail.test.ts && pnpm --filter @outreach/api lint`
Expected: PASS (3 tests) + typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/linkedin.ts apps/api/src/routes/post-detail.test.ts
git commit -m "feat(api): post detail + analyze + learnings routes"
```

---

### Task 6: Web — clickable rows + detail page

**Files:**
- Modify: `apps/web/src/app/(app)/accounts/[id]/post-row.tsx`
- Modify: `apps/web/src/lib/accounts.ts` (extend `Post`/add `PostDetail` type)
- Create: `apps/web/src/app/(app)/accounts/[id]/posts/[postId]/page.tsx`
- Modify: `apps/web/messages/en.json`, `apps/web/messages/de.json`

**Interfaces:**
- Consumes: `FeedPostShell`, `FeedPostImage` (`@/components/linkedin-feed-post`); the api routes from Task 5.

- [ ] **Step 1: Make `PostRow` a link**

In `post-row.tsx`, wrap the `<li>`'s content in a link to the detail page. Change the `PostRow` signature to accept `accountId` and render:

```tsx
import Link from "next/link";
// ...
export function PostRow({ post, accountId }: { post: Post; accountId: string }) {
  // ...existing stats computation...
  return (
    <li>
      <Link
        href={`/accounts/${accountId}/posts/${post.id}`}
        className="hover:bg-accent/40 block px-5 py-4 transition-colors"
      >
        {/* existing inner markup (image + text + badges + stats + date) unchanged */}
      </Link>
    </li>
  );
}
```

And in `posts/page.tsx`, pass `accountId={id}` to `<PostRow>`.

- [ ] **Step 2: Add the `PostDetail` web type**

In `apps/web/src/lib/accounts.ts`, add:

```ts
export interface PostAnalysis {
  performance: { summary: string; verdict: "over" | "on-par" | "under" };
  teardown: { hook: string; structure: string; pillar: string; format: string; cta: string; toneMatch: string };
  goalFit: string;
  learnings: string[];
}

export interface PostDetail extends Post {
  analysis: (PostAnalysis & { basis?: { impressions?: number } }) | null;
  analyzedAt: string | null;
  engagementRate: number;
}
```

- [ ] **Step 3: Build the detail page**

Create `apps/web/src/app/(app)/accounts/[id]/posts/[postId]/page.tsx`. It:
- reads `{ id, postId }` from `useParams`,
- fetches `/api/linkedin/accounts/${id}/posts/${postId}`,
- renders the post via `FeedPostShell` + `FeedPostImage` (read-only text as a `<p>`), a "View on LinkedIn" link built from `externalId` (`https://www.linkedin.com/feed/update/${encodeURIComponent(externalId)}`),
- a **metrics grid** (impressions, membersReached, reactions, comments, reshares, engagement rate as `%`, and the verdict badge),
- an **analysis** panel: if `analysis` is null show an "Analyze now" button (`POST …/analyze`, sets loading); else show `performance.summary` + verdict, the `teardown` fields, `goalFit`, and the `learnings` list where each item has ✓/✗ buttons. ✓ posts `{ accepted: [learning] }` to `…/learnings` and marks it locally accepted; ✗ dismisses it locally.
- All copy via `t("posts.*")` keys.

Follow the existing client-page pattern (`"use client"`, `useEffect` fetch, `Skeleton` while loading, `router.push("/login")` on 401). Reuse `Badge`, `Button`, `Card` from `@/components/ui/*`. Keep the file focused; extract a small `MetricsGrid` and `LearningRow` component in the same file.

- [ ] **Step 4: Add i18n keys**

Add a `posts` section (or extend `accounts`) in BOTH `en.json` and `de.json` with keys used by the page, e.g.:

```json
"posts": {
  "back": "Back to posts",
  "viewOnLinkedIn": "View on LinkedIn",
  "engagementRate": "Engagement rate",
  "verdict_over": "Above average",
  "verdict_on-par": "On par",
  "verdict_under": "Below average",
  "analysisTitle": "AI analysis",
  "analyzeNow": "Analyze now",
  "analyzing": "Analyzing…",
  "reanalyze": "Re-analyze",
  "performance": "Performance",
  "teardown": "Teardown",
  "goalFit": "Goal fit",
  "learnings": "Learnings",
  "learningAccept": "Add to profile",
  "learningReject": "Dismiss",
  "learningAdded": "Added to profile",
  "hook": "Hook", "structure": "Structure", "pillar": "Pillar", "format": "Format", "cta": "Call to action", "toneMatch": "Tone match",
  "membersReached": "Members reached", "reshares": "Reshares",
  "notAnalyzed": "This post hasn't been analyzed yet."
}
```
(German equivalents in `de.json`.)

- [ ] **Step 5: Typecheck + verify**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: clean. Then a `python3 -c "import json; json.load(open('apps/web/messages/en.json')); json.load(open('apps/web/messages/de.json'))"` sanity check passes.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/(app)/accounts apps/web/src/lib/accounts.ts apps/web/messages
git commit -m "feat(web): clickable posts + post detail page with AI analysis"
```

---

## Final verification (whole branch)

- `pnpm --filter @outreach/ai test`, `pnpm --filter @outreach/api exec vitest run`, `pnpm --filter web exec tsc --noEmit` — all green.
- **Live:** open a real published post's detail page → "Analyze now" → analysis renders → accept a learning → confirm it appears in the profile's `derived.topPatterns` (via the profile canvas "insights"/topPatterns, or a direct GET `/api/profiles/:id`). Then open the studio and confirm the writer's context includes it (the agent's `insights` string).
