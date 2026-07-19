# LinkedIn Publishing (v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a draft to LinkedIn (text + optional image + optional source-link first comment), on demand and automatically at its scheduled time, with self-healing token refresh.

**Architecture:** A `LinkedInPublishClient` in `@outreach/linkedin` (Posts/Images/Comments REST API). A `publishDraft` orchestration service in `apps/api` (ensure token → upload image → create post → first comment → persist). A "publish now" studio endpoint + button (confirm dialog). Two pg-boss workers: `publish-due` (1-min sweep of due scheduled drafts) and `refresh-tokens` (6-hourly proactive refresh). One new column `Draft.publishError`.

**Tech Stack:** Hono + Prisma 7 (api), `@outreach/linkedin` client (mirrors `MemberAnalyticsClient`), pg-boss workers, Next 16 + shadcn (web), vitest (mocked `fetch`/deps — never a real LinkedIn call).

## Global Constraints

- **Never make a real LinkedIn network call in tests or automated runs.** Every client/orchestration test injects a mock `fetch`/mock client. The one real live post is a manual step the user performs.
- Publishing is irreversible + public: "publish now" needs an explicit click AND a confirm dialog. The scheduled worker publishes without a per-post prompt (scheduling is the consent); the schedule UI must say a scheduled post auto-publishes.
- Tokens are AES-GCM encrypted at rest; decrypt only in memory. Reuse `getDecryptedAccount` and `LinkedInOAuthClient.refresh(refreshToken)` (already implemented). `LINKEDIN_API_VERSION` env default `202601`.
- All REST calls: base `https://api.linkedin.com/rest`, headers `Authorization: Bearer <token>`, `LinkedIn-Version: <apiVersion>`, `X-Restli-Protocol-Version: 2.0.0`.
- **LinkedIn API field names / the post-URN response header / `memberUrn` format are from current API knowledge and MUST be verified against the live API during implementation** — the client isolates them. `memberUrn` = `LinkedInAccount.memberUrn`; confirm it is a full `urn:li:person:...` (prefix if only the id is stored).
- Ownership: the publish endpoint verifies account+draft belong to the user, like the other studio routes.
- `publishDraft` guards on entry: a draft already `published` is never re-posted (prevents double-post on worker overlap).
- Migration discipline: adding `Draft.publishError` must NOT drop the pgvector HNSW index `resource_chunk_embedding_hnsw`. Use `prisma migrate dev --create-only` and delete any spurious `DROP INDEX` from the generated SQL (or hand-write the `ALTER TABLE ... ADD COLUMN`), then apply. Export `DATABASE_URL` for the Prisma CLI (it does not auto-load root `.env`).

---

### Task 1: Data layer — publishError column + account token helpers

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (add `Draft.publishError`)
- Create: `packages/db/prisma/migrations/<ts>_add_draft_publish_error/migration.sql`
- Modify: `apps/api/src/repos/linkedin-account.ts` (extend `getDecryptedAccount`; add `updateAccountTokens`, `setAccountStatus`)
- Test: `apps/api/src/repos/linkedin-account.test.ts` (or a new `publish-repo.test.ts` if that file doesn't exist — match the existing repo-test harness)

**Interfaces (Produces):**
- `getDecryptedAccount` now also returns `tokenExpiresAt: Date | null` and `status: string`.
- `updateAccountTokens(id: string, tokens: { accessToken: string; refreshToken?: string; expiresIn: number }): Promise<void>` — re-encrypts + stores, sets `status = "active"`.
- `setAccountStatus(id: string, status: "active" | "expired" | "revoked"): Promise<void>`.
- `Draft.publishError: string | null`.

- [ ] **Step 1: Add the column to the schema** — in `schema.prisma`, add to `model Draft` next to `publishedAt`:
```prisma
  publishError      String?   // last publish failure message (status = failed)
```

- [ ] **Step 2: Generate the migration --create-only and scrub any HNSW drop**

Run (from repo root, DATABASE_URL exported):
```bash
export DATABASE_URL="$(grep -h '^DATABASE_URL' .env | head -1 | cut -d= -f2- | tr -d '"')"
pnpm --filter @outreach/db exec prisma migrate dev --create-only --name add_draft_publish_error
```
Open the generated `migration.sql`. It must contain ONLY:
```sql
ALTER TABLE "Draft" ADD COLUMN "publishError" TEXT;
```
If it also contains `DROP INDEX ... resource_chunk_embedding_hnsw ...`, DELETE that line (the HNSW index on the `Unsupported("halfvec(3072)")` column is invisible to the schema diff and gets dropped spuriously). Then apply + regenerate:
```bash
pnpm --filter @outreach/db exec prisma migrate deploy
pnpm --filter @outreach/db exec prisma generate
```

- [ ] **Step 3: Write the failing repo test** — following the existing `apps/api/src/repos/*.test.ts` real-DB harness (beforeAll creates a user + account, afterAll deletes the user). Assert:
  - `getDecryptedAccount` returns `tokenExpiresAt` + `status`.
  - `updateAccountTokens(id, {accessToken:"new", refreshToken:"newr", expiresIn: 3600})` → a subsequent `getDecryptedAccount` returns `accessToken === "new"`, `refreshToken === "newr"`, `status === "active"`, and `tokenExpiresAt` roughly `now + 3600s`.
  - `setAccountStatus(id, "expired")` → `getDecryptedAccount().status === "expired"`.

- [ ] **Step 4: Run to verify it fails** — `pnpm --filter @outreach/api exec vitest run src/repos/linkedin-account.test.ts` → FAIL (new functions/fields missing).

- [ ] **Step 5: Implement the repo changes**

Extend `getDecryptedAccount`'s return object with `tokenExpiresAt: a.tokenExpiresAt` and `status: a.status`. Then add:
```ts
export async function updateAccountTokens(
  id: string,
  tokens: { accessToken: string; refreshToken?: string; expiresIn: number },
): Promise<void> {
  const expiresAt = tokens.expiresIn ? new Date(Date.now() + tokens.expiresIn * 1000) : null;
  await prisma.linkedInAccount.update({
    where: { id },
    data: {
      accessToken: encrypt(tokens.accessToken, env.ENCRYPTION_KEY),
      ...(tokens.refreshToken ? { refreshToken: encrypt(tokens.refreshToken, env.ENCRYPTION_KEY) } : {}),
      tokenExpiresAt: expiresAt,
      status: "active",
    },
  });
}

export async function setAccountStatus(id: string, status: "active" | "expired" | "revoked"): Promise<void> {
  await prisma.linkedInAccount.update({ where: { id }, data: { status } });
}
```

- [ ] **Step 6: Run to verify it passes** — same vitest command → PASS. Also `pnpm --filter @outreach/api lint`.

- [ ] **Step 7: Commit**
```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations apps/api/src/repos/linkedin-account.ts apps/api/src/repos/linkedin-account.test.ts
git commit -m "feat(publish): Draft.publishError + account token/status repo helpers"
```

---

### Task 2: LinkedIn publish client

**Files:**
- Create: `packages/linkedin/src/publish.ts`
- Modify: `packages/linkedin/src/index.ts` (export)
- Test: `packages/linkedin/src/publish.test.ts`

**Interfaces (Produces):**
- `class LinkedInPublishClient { constructor(cfg: { accessToken: string; apiVersion?: string; fetchImpl?: typeof fetch }); uploadImage(ownerUrn, bytes, contentType): Promise<string>; createPost({authorUrn, text, imageUrn?}): Promise<string>; addComment(postUrn, actorUrn, text): Promise<void> }`
- `class LinkedInPublishError extends Error { status: number }`

- [ ] **Step 1: Write the failing tests** (mock `fetch`, no network). Cover:
  - `uploadImage`: first call hits `/images?action=initializeUpload` (POST) → returns `{ value: { uploadUrl: "https://up", image: "urn:li:image:1" } }`; second call PUTs to `https://up` with the bytes; the method resolves to `"urn:li:image:1"`.
  - `createPost` with no image: POSTs `/posts`; the mock returns a `Response` with header `x-restli-id: urn:li:share:123`; method resolves to `"urn:li:share:123"`. Assert the request body has `author`, `commentary`, `lifecycleState: "PUBLISHED"`, `visibility: "PUBLIC"`, and NO `content`.
  - `createPost` with `imageUrn`: body includes `content.media.id === imageUrn`.
  - `addComment`: POSTs `/socialActions/<encoded urn>/comments` with `actor`, `object`, `message.text`.
  - A 401 from `/posts` throws `LinkedInPublishError` with `status === 401`.

  Mock shape (mirror how `analytics.test.ts` builds a fake fetch, if present; else a plain `vi.fn()` returning `new Response(...)`).

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @outreach/linkedin exec vitest run src/publish.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `publish.ts`**
```ts
const BASE = "https://api.linkedin.com/rest";

export class LinkedInPublishError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "LinkedInPublishError";
  }
}

interface Config {
  accessToken: string;
  apiVersion?: string;
  fetchImpl?: typeof fetch;
}

export class LinkedInPublishClient {
  private readonly fetch: typeof fetch;
  private readonly apiVersion: string;
  constructor(private readonly cfg: Config) {
    this.fetch = cfg.fetchImpl ?? fetch;
    this.apiVersion = cfg.apiVersion ?? "202601";
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: `Bearer ${this.cfg.accessToken}`,
      "LinkedIn-Version": this.apiVersion,
      "X-Restli-Protocol-Version": "2.0.0",
      ...extra,
    };
  }

  async uploadImage(ownerUrn: string, bytes: Uint8Array, contentType: string): Promise<string> {
    const init = await this.fetch(`${BASE}/images?action=initializeUpload`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ initializeUploadRequest: { owner: ownerUrn } }),
    });
    if (!init.ok) throw new LinkedInPublishError(`image init failed: ${init.status}`, init.status);
    const { value } = (await init.json()) as { value: { uploadUrl: string; image: string } };
    const put = await this.fetch(value.uploadUrl, {
      method: "PUT",
      headers: { Authorization: `Bearer ${this.cfg.accessToken}`, "Content-Type": contentType },
      body: bytes,
    });
    if (!put.ok) throw new LinkedInPublishError(`image upload failed: ${put.status}`, put.status);
    return value.image;
  }

  async createPost(input: { authorUrn: string; text: string; imageUrn?: string }): Promise<string> {
    const body: Record<string, unknown> = {
      author: input.authorUrn,
      commentary: input.text,
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    };
    if (input.imageUrn) body.content = { media: { id: input.imageUrn } };
    const res = await this.fetch(`${BASE}/posts`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new LinkedInPublishError(`create post failed: ${res.status}`, res.status);
    const urn = res.headers.get("x-restli-id") ?? res.headers.get("x-linkedin-id");
    if (!urn) throw new LinkedInPublishError("create post: missing post URN header", res.status);
    return urn;
  }

  async addComment(postUrn: string, actorUrn: string, text: string): Promise<void> {
    const res = await this.fetch(`${BASE}/socialActions/${encodeURIComponent(postUrn)}/comments`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ actor: actorUrn, object: postUrn, message: { text } }),
    });
    if (!res.ok) throw new LinkedInPublishError(`add comment failed: ${res.status}`, res.status);
  }
}
```
Export both from `packages/linkedin/src/index.ts`:
```ts
export { LinkedInPublishClient, LinkedInPublishError } from "./publish.js";
```

- [ ] **Step 4: Run to verify it passes** — vitest → PASS. `pnpm --filter @outreach/linkedin exec tsc -p tsconfig.json --noEmit` (or the package's lint script) clean.

- [ ] **Step 5: Commit**
```bash
git add packages/linkedin/src/publish.ts packages/linkedin/src/index.ts packages/linkedin/src/publish.test.ts
git commit -m "feat(publish): LinkedInPublishClient (images + posts + comments)"
```

---

### Task 3: publishDraft orchestration

**Files:**
- Create: `apps/api/src/publish/publish-draft.ts`
- Test: `apps/api/src/publish/publish-draft.test.ts`

**Interfaces:**
- Consumes: `LinkedInPublishClient`/`LinkedInPublishError` (T2); `LinkedInOAuthClient.refresh` (existing); `getDecryptedAccount`, `updateAccountTokens`, `setAccountStatus` (T1); `getDraft`, `updateDraft` (existing `repos/draft.ts` — note `updateDraft` whitelists fields; you will set publish result fields via a small dedicated writer, see below); `getObject` (`storage.ts`); `getItem` (`repos/feed.ts`) for the source URL.
- Produces: `publishDraft(draftId: string, accountId: string, userId: string, deps?: PublishDeps): Promise<Draft>` where `PublishDeps` allows injecting the client factory + oauth client + fetchers for tests.

- [ ] **Step 1: Add a draft publish-result writer** to `apps/api/src/repos/draft.ts` (the existing `updateDraft` deliberately whitelists out status/externalId):
```ts
export async function setPublishResult(
  id: string,
  accountId: string,
  data: { status: string; publishedAt?: Date | null; externalId?: string | null; publishError?: string | null },
): Promise<void> {
  await prisma.draft.updateMany({ where: { id, linkedinAccountId: accountId }, data });
}
```

- [ ] **Step 2: Write the failing tests** (`publish-draft.test.ts`) — inject fakes via `deps` (a fake publish client whose methods record calls + return canned URNs; a fake oauth client; a fake `getObject`). Use a real DB row for the draft+account (repo harness) OR fully stub the repos — match whatever keeps the test hermetic; prefer stubbing the LinkedIn/storage side and using a real draft/account row so the persisted status is asserted from the DB. Cover:
  1. **text-only success:** draft with text, no image, no source → `createPost` called with the text; draft ends `status="published"`, `externalId` set, `publishError=null`; `uploadImage`/`addComment` NOT called.
  2. **with image:** draft has `imageUrl` → `getObject` + `uploadImage` called, and `createPost` gets the returned image URN.
  3. **with source (first comment):** draft has `sourceFeedItemId` → after post, `addComment` called with `Quelle: <url>`. A throwing `addComment` still leaves the draft `published` (comment failure is swallowed).
  4. **token refresh:** account `tokenExpiresAt` in the past + a refresh token → oauth `refresh` called, `updateAccountTokens` persisted, post uses the new token.
  5. **refresh failure:** expired token + refresh throws → account `status="expired"`, draft `status="failed"` + `publishError`, and `createPost` NOT called.
  6. **already published guard:** draft already `status="published"` → returns without calling the client.

- [ ] **Step 3: Run to verify it fails.**

- [ ] **Step 4: Implement `publish-draft.ts`.** Logic (exact):
  - Guard: load draft via `getDraft(draftId, accountId)`; if missing → throw; if `status === "published"` → return it unchanged.
  - Load `getDecryptedAccount(accountId, userId)`.
  - **ensureToken:** if `tokenExpiresAt == null || tokenExpiresAt.getTime() <= Date.now() + 60_000`: if no `refreshToken` → mark expired + fail; else `const t = await oauth.refresh(refreshToken)` (catch → mark expired + fail), then `await updateAccountTokens(accountId, t)` and use `t.accessToken`; else use the existing `accessToken`.
  - `const client = deps.makeClient(accessToken)` (default: `new LinkedInPublishClient({ accessToken, apiVersion: env.LINKEDIN_API_VERSION })`).
  - If `draft.imageUrl`: `key = draft.imageUrl.replace(/^\//, "")` (i.e. `/generated/x.png` → `generated/x.png`); `const obj = await getObject(key)`; if obj → `imageUrn = await client.uploadImage(memberUrn, obj.body, obj.contentType)`.
  - `const postUrn = await client.createPost({ authorUrn: memberUrn, text: draft.text, imageUrn })`.
  - If `draft.sourceFeedItemId`: `const item = await getItem(draft.sourceFeedItemId, userId)`; if item → `try { await client.addComment(postUrn, memberUrn, \`Quelle: ${item.url}\`) } catch { /* swallow: post is live */ }`.
  - `await setPublishResult(draftId, accountId, { status: "published", publishedAt: new Date(), externalId: postUrn, publishError: null })`.
  - Return the reloaded draft.
  - **Failure handling:** wrap the publish steps (from createPost onward, and the image step) in try/catch: on `LinkedInPublishError` with `status === 401` also `setAccountStatus(accountId, "expired")`; in all failure cases `setPublishResult(..., { status: "failed", publishError: err.message })` and rethrow OR return the failed draft (return the failed draft so the endpoint/worker can surface it without a throw; the worker treats a returned `failed` as handled). Mark-expired + fail from the token step returns early (do not call the client).

  `PublishDeps` (all optional, defaulted): `{ makeClient?(token): LinkedInPublishClient; oauth?: { refresh(rt: string): Promise<TokenResponse> }; getObjectImpl?; getItemImpl? }`.

- [ ] **Step 5: Run to verify it passes.** `pnpm --filter @outreach/api lint`.

- [ ] **Step 6: Commit**
```bash
git add apps/api/src/publish/publish-draft.ts apps/api/src/publish/publish-draft.test.ts apps/api/src/repos/draft.ts
git commit -m "feat(publish): publishDraft orchestration (token refresh, image, post, first comment)"
```

---

### Task 4: Publish-now endpoint

**Files:**
- Modify: `apps/api/src/routes/studio.ts` (add `POST /:accountId/drafts/:id/publish`)
- Test: `apps/api/src/routes/studio.test.ts` (append)

**Interfaces:** Consumes `publishDraft` (T3), existing `requireAccount`/`getDraft`.

- [ ] **Step 1: Write the failing test** — using the existing `studio.test.ts` harness. Because a real `publishDraft` would hit LinkedIn, the endpoint must accept an injected publisher OR the test stubs the network. Simplest: have the route call the module-level `publishDraft` and, in the test, assert the ownership + wiring only via a foreign-account 404 and a not-found 404, PLUS a happy-path where the LinkedIn calls are mocked by injecting a fake `fetch` is out of scope for a route test. So: test (a) foreign account → 404, (b) unknown draft → 404. (Full publish success is covered by Task 3's orchestration test.) Keep the route test to ownership + shape.

- [ ] **Step 2: Run to verify it fails** (endpoint 404s because route missing).

- [ ] **Step 3: Add the endpoint** in `studio.ts` (import `publishDraft` from `../publish/publish-draft.js`):
```ts
r.post("/:accountId/drafts/:id/publish", async (c) => {
  const user = c.get("user")!;
  const accountId = c.req.param("accountId");
  if (!(await requireAccount(accountId, user.id))) return c.json({ error: "not_found" }, 404);
  const draft = await getDraft(c.req.param("id"), accountId);
  if (!draft) return c.json({ error: "not_found" }, 404);
  const updated = await publishDraft(c.req.param("id"), accountId, user.id);
  return c.json({ draft: updated });
});
```

- [ ] **Step 4: Run to verify it passes.** `pnpm --filter @outreach/api lint`.

- [ ] **Step 5: Commit**
```bash
git add apps/api/src/routes/studio.ts apps/api/src/routes/studio.test.ts
git commit -m "feat(publish): POST publish-now endpoint"
```

---

### Task 5: Workers — publish-due + refresh-tokens

**Files:**
- Modify: `apps/api/src/queue.ts` (add queues)
- Modify: `apps/api/src/server.ts` (register work handlers + schedules)
- Create: `apps/api/src/publish/due.ts` (selection queries: `listDuePublishDrafts()`, `listAccountsNeedingRefresh()`)
- Create: `apps/api/src/publish/refresh-tokens.ts` (`refreshAccountToken(accountId)` using oauth.refresh + `updateAccountTokens`/`setAccountStatus`)
- Test: `apps/api/src/publish/due.test.ts`

**Interfaces:** Consumes `publishDraft` (T3), `updateAccountTokens`/`setAccountStatus`/`getDecryptedAccount` (T1), `LinkedInOAuthClient` (existing).

- [ ] **Step 1: Write the failing tests** (`due.test.ts`, real-DB harness):
  - `listDuePublishDrafts()` returns drafts with `status="scheduled"` AND `scheduledAt <= now`, and excludes future-scheduled / non-scheduled ones.
  - `listAccountsNeedingRefresh()` returns accounts with a refresh token, `status="active"`, `tokenExpiresAt < now + 7d`; excludes ones far from expiry / without a refresh token / not active.

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement selection + refresh:**
```ts
// apps/api/src/publish/due.ts
import { prisma } from "@outreach/db";
export function listDuePublishDrafts() {
  return prisma.draft.findMany({
    where: { status: "scheduled", scheduledAt: { lte: new Date() } },
    select: { id: true, linkedinAccountId: true, account: { select: { userId: true } } },
    take: 50,
  });
}
export function listAccountsNeedingRefresh() {
  const soon = new Date(Date.now() + 7 * 86400e3);
  return prisma.linkedInAccount.findMany({
    where: { status: "active", refreshToken: { not: null }, tokenExpiresAt: { lt: soon } },
    select: { id: true, userId: true },
    take: 100,
  });
}
```
```ts
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
```
> Confirm the `LinkedInOAuthClient` constructor arg names against `packages/linkedin/src/oauth.ts` and match them.

- [ ] **Step 4: Add the queues + schedules.** In `queue.ts` add `export const PUBLISH_DUE_QUEUE = "publish-due";` and `export const REFRESH_TOKENS_QUEUE = "refresh-tokens";`, and `createQueue` both in `getBoss` (no special retry needed; `publish-due` should NOT retry aggressively — `retryLimit: 0` — because `publishDraft` already records `failed`). In `server.ts`, register:
```ts
await boss.work(PUBLISH_DUE_QUEUE, async () => {
  const due = await listDuePublishDrafts();
  for (const d of due) {
    try { await publishDraft(d.id, d.linkedinAccountId, d.account.userId); }
    catch (e) { console.error("publish-due failed", d.id, e); }
  }
});
await boss.schedule(PUBLISH_DUE_QUEUE, "* * * * *");

await boss.work(REFRESH_TOKENS_QUEUE, async () => {
  const accts = await listAccountsNeedingRefresh();
  for (const a of accts) await refreshAccountToken(a.id, a.userId);
});
await boss.schedule(REFRESH_TOKENS_QUEUE, "0 */6 * * *");
```
Follow the exact pattern already used for `POLL_FEEDS_QUEUE` in `server.ts`.

- [ ] **Step 5: Run to verify it passes.** `pnpm --filter @outreach/api lint`.

- [ ] **Step 6: Commit**
```bash
git add apps/api/src/queue.ts apps/api/src/server.ts apps/api/src/publish/due.ts apps/api/src/publish/refresh-tokens.ts apps/api/src/publish/due.test.ts
git commit -m "feat(publish): publish-due + refresh-tokens workers"
```

---

### Task 6: Studio publish UI

**Files:**
- Modify: `apps/web/src/app/(app)/studio/[id]/page.tsx`
- Modify: `apps/web/messages/en.json`, `apps/web/messages/de.json`
- Modify: `apps/web/src/lib/studio.ts` if the `Draft` type lacks `externalId`/`publishError` (add them)

- [ ] **Step 1: Implement.** In the studio toolbar next to "Plan"/Save, add a **"Veröffentlichen"** `Button` that opens a shadcn `Dialog` confirming "This posts publicly to LinkedIn right now." On confirm → `POST /api/studio/{accountId}/drafts/{id}/publish` (credentials include); on 200 set local `draft` to the returned draft; 401 → `/login`. While in flight, show a spinner + disable.
  - When `draft.status === "published"`: show a "Published" state — a link to `https://www.linkedin.com/feed/update/${draft.externalId}` (open in new tab), and hide/disable the publish button.
  - When `draft.status === "failed"`: show `draft.publishError` in a destructive-styled note + a "Retry" that re-calls publish.
  - Update the scheduling copy (the `ScheduleDialog` / the "Plan" area and the sidebar note) to state a scheduled post will auto-publish at its time (replace any remaining "coming soon" wording for scheduling).
  - Add i18n keys to BOTH message files under `studio` (+ reuse `schedule.*`): `publish`, `publishConfirmTitle`, `publishConfirmBody`, `publishing`, `published`, `viewOnLinkedin`, `publishFailed`, `retry`, `autoPublishNote`. Keys in sync across en/de.

- [ ] **Step 2: Typecheck** — `pnpm --filter web exec tsc --noEmit` clean; JSON valid.

- [ ] **Step 3: Commit**
```bash
git add apps/web/src/app/\(app\)/studio/\[id\]/page.tsx apps/web/src/lib/studio.ts apps/web/messages/en.json apps/web/messages/de.json
git commit -m "feat(publish): studio publish button + published/failed states"
```

---

### Task 7: Accounts reconnect CTA + honest scheduling copy

**Files:**
- Modify: the accounts UI that shows account status (`apps/web/src/app/(app)/accounts/...` — find where `status` renders) to add a "reconnect LinkedIn" CTA when `status === "expired"` (links to the existing connect/OAuth flow).
- Modify: `apps/web/src/app/(app)/schedule/calendar-view.tsx` + the schedule dialog copy so scheduled posts read as "will auto-publish" rather than "not published yet" (the marker text), now that the worker publishes.

- [ ] **Step 1: Implement.** Explore the accounts pages for where `account.status` is displayed; when `expired`, render a visible CTA (button/link) that starts the LinkedIn connect flow (reuse the existing "Connect LinkedIn" action). Update the calendar event marker + schedule dialog i18n so a scheduled post says it will be auto-published at its time. Add/adjust i18n keys in both message files (in sync).

- [ ] **Step 2: Typecheck** — `pnpm --filter web exec tsc --noEmit` clean; JSON valid.

- [ ] **Step 3: Commit**
```bash
git add apps/web/src/app/\(app\)/accounts apps/web/src/app/\(app\)/schedule apps/web/messages/en.json apps/web/messages/de.json
git commit -m "feat(publish): reconnect CTA for expired accounts + auto-publish scheduling copy"
```

---

## Self-Review

- **Spec coverage:** publish client ✓ T2; orchestration (token/image/post/first-comment/persist) ✓ T3; publish-now endpoint+button ✓ T4/T6; publish-due worker ✓ T5; refresh-tokens worker ✓ T5; just-in-time refresh + mark-expired ✓ T3; schema `publishError` ✓ T1; published/failed UI + reconnect + auto-publish copy ✓ T6/T7; irreversibility confirm dialog ✓ T6; no-live-calls-in-tests ✓ (all tasks inject mocks).
- **Type consistency:** `getDecryptedAccount` gains `tokenExpiresAt`/`status` in T1 and both are consumed in T3/T5. `LinkedInPublishClient`/`LinkedInPublishError` signatures (T2) match their use in T3. `setPublishResult`/`updateAccountTokens`/`setAccountStatus` names are stable across T1→T3→T5. `publishDraft(draftId, accountId, userId)` signature identical in T4 and T5.
- **Placeholder scan:** backend tasks carry full code; UI tasks (T6/T7) specify exact endpoints, states, i18n keys, and point at the existing studio/accounts patterns as the JSX source. LinkedIn API shapes are explicitly flagged as verify-against-live (isolated in the T2 client).
