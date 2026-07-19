# Feed / Content-Radar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A per-user Feed page: register RSS sources → a pg-boss job pulls articles in → one click ("Post daraus") opens the Studio with a draft the agent writes as the user's own take, in their voice.

**Architecture:** `FeedSource`/`FeedItem` (user-scoped) in Postgres. SSRF-guarded RSS fetch (`rss-parser`) runs as a pg-boss job (in the API process) with a scheduled poll. User-scoped API routes. New "Feed" nav page. "Post daraus" reuses the Studio create-draft + `?prompt=` auto-send.

**Tech Stack:** Prisma 7, pg-boss v12, rss-parser, Hono, Next.js 16 + next-intl.

## Global Constraints

- ESM `.js` import specifiers; TS 7 native. Prisma 7 (generated client gitignored; import from `@outreach/db`; migrate via `pnpm --filter @outreach/db exec prisma migrate dev --name <n>`).
- Feed API is **user-scoped** (behind the auth guard, keyed on `c.get("user")`, no accountId in the URL).
- pg-boss v12 (named `PgBoss`, `createQueue`, `work(name,{batchSize},handler[])`, `schedule(name,cron,data)`); boss lives in the API process (`queue.ts`/`server.ts`).
- SSRF: feed fetches reject non-http(s) and any host resolving to loopback/private/link-local; body+timeout caps; re-check on redirects. Reuse `isPrivateOrLoopbackIp` (currently in `apps/api/src/routes/linkedin.ts`).
- Web ↔ API via `/api/[...proxy]`; app pages full-width `p-6`; i18n en+de (no literal `<`/`{`/`}` in ICU); restrained Linear-ish styling, softened shadows.
- **Trunk-based: commit directly to `main`, per-task.** Bare `vitest` loads root `.env`. Never `next build` while `next dev` runs; restart api after api/db edits.

---

## Task 1: `FeedSource` / `FeedItem` model + repo

**Files:** Modify `packages/db/prisma/schema.prisma`; create migration; create `apps/api/src/repos/feed.ts`; test `apps/api/src/repos/feed.test.ts`.

**Produces:** repo functions (see below) + `FeedSource`/`FeedItem` types from `@outreach/db`.

- [ ] **Step 1: Add models**

```prisma
model FeedSource {
  id            String   @id @default(cuid())
  userId        String
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  url           String
  title         String
  status        String   @default("active")
  error         String?
  lastFetchedAt DateTime?
  createdAt     DateTime @default(now())
  items         FeedItem[]
  @@unique([userId, url])
}

model FeedItem {
  id          String   @id @default(cuid())
  sourceId    String
  source      FeedSource @relation(fields: [sourceId], references: [id], onDelete: Cascade)
  userId      String
  guid        String
  title       String
  url         String
  excerpt     String
  imageUrl    String?
  author      String?
  publishedAt DateTime?
  status      String   @default("new")
  createdAt   DateTime @default(now())
  @@unique([sourceId, guid])
  @@index([userId, status, publishedAt])
}
```
Add `feedSources FeedSource[]` to `model User`.

- [ ] **Step 2: Migrate + generate**

`pnpm --filter @outreach/db exec prisma migrate dev --name add_feed` then `prisma generate`. Export `FeedSource`, `FeedItem` from `packages/db/src/index.ts`.

- [ ] **Step 3: Failing repo test**

```ts
// apps/api/src/repos/feed.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@outreach/db";
import {
  createSource, listSources, deleteSource, updateSourceFetchState,
  insertItems, listItems, setItemStatus,
} from "./feed.js";

let userId = "", sourceId = "";
beforeAll(async () => {
  const u = await prisma.user.create({ data: { id: `u${Date.now()}`, email: `f${Date.now()}@ex.com`, name: "F" } });
  userId = u.id;
});
afterAll(async () => { await prisma.user.delete({ where: { id: userId } }); await prisma.$disconnect(); });

describe("feed repo", () => {
  it("creates source, inserts items with dedupe, lists+scopes, sets status", async () => {
    const s = await createSource({ userId, url: "https://ex.com/rss", title: "Ex" });
    sourceId = s.id;
    expect((await listSources(userId)).length).toBe(1);

    const items = [
      { guid: "g1", title: "A", url: "https://ex.com/a", excerpt: "aa", publishedAt: new Date() },
      { guid: "g2", title: "B", url: "https://ex.com/b", excerpt: "bb", publishedAt: new Date() },
    ];
    expect(await insertItems(sourceId, userId, items)).toBe(2);
    expect(await insertItems(sourceId, userId, items)).toBe(0); // dedupe: no new rows

    expect((await listItems(userId, "new")).length).toBe(2);
    const first = (await listItems(userId, "new"))[0]!;
    await setItemStatus(first.id, userId, "dismissed");
    expect((await listItems(userId, "new")).length).toBe(1);
    expect((await listItems(userId, "dismissed")).length).toBe(1);

    await updateSourceFetchState(sourceId, { status: "error", error: "boom" });
    expect((await listSources(userId))[0]!.status).toBe("error");

    await deleteSource(sourceId, userId); // cascades items
    expect((await listItems(userId, "all")).length).toBe(0);
  });
});
```

- [ ] **Step 4: Run it (fail), implement the repo, run it (pass)**

```ts
// apps/api/src/repos/feed.ts
import { prisma } from "@outreach/db";
import type { FeedSource, FeedItem } from "@outreach/db";

export interface ParsedItem {
  guid: string; title: string; url: string; excerpt: string;
  imageUrl?: string | null; author?: string | null; publishedAt?: Date | null;
}

export function createSource(input: { userId: string; url: string; title: string }): Promise<FeedSource> {
  return prisma.feedSource.create({ data: input });
}
export function listSources(userId: string): Promise<FeedSource[]> {
  return prisma.feedSource.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
}
export function getSource(id: string, userId: string): Promise<FeedSource | null> {
  return prisma.feedSource.findFirst({ where: { id, userId } });
}
export async function deleteSource(id: string, userId: string): Promise<boolean> {
  const s = await getSource(id, userId);
  if (!s) return false;
  await prisma.feedSource.delete({ where: { id } });
  return true;
}
export async function updateSourceFetchState(
  id: string, patch: { status?: string; error?: string | null; lastFetchedAt?: Date },
): Promise<void> {
  await prisma.feedSource.update({ where: { id }, data: patch });
}
export async function insertItems(sourceId: string, userId: string, items: ParsedItem[]): Promise<number> {
  if (items.length === 0) return 0;
  const res = await prisma.feedItem.createMany({
    data: items.map((i) => ({
      sourceId, userId, guid: i.guid, title: i.title, url: i.url, excerpt: i.excerpt,
      imageUrl: i.imageUrl ?? null, author: i.author ?? null, publishedAt: i.publishedAt ?? null,
    })),
    skipDuplicates: true, // dedupe on @@unique([sourceId, guid])
  });
  return res.count;
}
export function listItems(userId: string, status?: string, limit = 100): Promise<FeedItem[]> {
  return prisma.feedItem.findMany({
    where: { userId, ...(status && status !== "all" ? { status } : {}) },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take: limit,
  });
}
export function getItem(id: string, userId: string): Promise<FeedItem | null> {
  return prisma.feedItem.findFirst({ where: { id, userId } });
}
export async function setItemStatus(id: string, userId: string, status: string): Promise<FeedItem | null> {
  const it = await getItem(id, userId);
  if (!it) return null;
  return prisma.feedItem.update({ where: { id }, data: { status } });
}
```

- [ ] **Step 5:** `tsc --noEmit` (db+api) clean; test passes. **Commit** — `feat(db): FeedSource/FeedItem + feed repo`. Stage schema, migration dir, index.ts, repo+test (NOT generated client).

---

## Task 2: SSRF-guarded RSS fetch + parse

**Files:** create `apps/api/src/net.ts` (extract `isPrivateOrLoopbackIp` from `routes/linkedin.ts`); modify `routes/linkedin.ts` to import it; create `apps/api/src/feed/fetch.ts`; add `rss-parser` to `apps/api`; tests `apps/api/src/net.test.ts` + `apps/api/src/feed/fetch.test.ts`.

**Produces:** `assertPublicHttpUrl(url)`, `safeFetchText(url, opts)` from `net.ts`; `fetchFeed(url): Promise<{ title: string; items: ParsedItem[] }>` from `feed/fetch.ts`.

- [ ] **Step 1: Add dep** — `pnpm --filter @outreach/api add rss-parser`.

- [ ] **Step 2: Extract `isPrivateOrLoopbackIp` → `net.ts`, add URL guard + safe fetch**

Move the `isPrivateOrLoopbackIp` function verbatim from `routes/linkedin.ts` into a new `apps/api/src/net.ts` and `export` it there; in `linkedin.ts`, delete the local copy and `import { isPrivateOrLoopbackIp } from "../net.js";` (keep its behaviour identical — the existing linkedin tests must still pass).

```ts
// apps/api/src/net.ts  (isPrivateOrLoopbackIp moved here verbatim, plus:)
import { lookup } from "node:dns/promises";

export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("invalid_url"); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("bad_protocol");
  const addrs = await lookup(url.hostname, { all: true });
  for (const a of addrs) if (isPrivateOrLoopbackIp(a.address)) throw new Error("blocked_host");
  return url;
}

export async function safeFetchText(raw: string, opts?: { maxBytes?: number; timeoutMs?: number; maxHops?: number }): Promise<string> {
  const maxBytes = opts?.maxBytes ?? 5_000_000;
  const maxHops = opts?.maxHops ?? 5;
  let current = raw;
  for (let hop = 0; hop <= maxHops; hop++) {
    await assertPublicHttpUrl(current); // re-validate every hop (SSRF via redirect)
    const res = await fetch(current, {
      redirect: "manual",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; OutreachFeed/1.0)", Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" },
      signal: AbortSignal.timeout(opts?.timeoutMs ?? 12_000),
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error("redirect_no_location");
      current = new URL(loc, current).toString();
      continue;
    }
    if (!res.ok) throw new Error(`http_${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) throw new Error("too_large");
    return new TextDecoder().decode(buf.slice(0, maxBytes));
  }
  throw new Error("too_many_redirects");
}
```

- [ ] **Step 3: `fetchFeed` (parse)**

```ts
// apps/api/src/feed/fetch.ts
import Parser from "rss-parser";
import { safeFetchText } from "../net.js";
import type { ParsedItem } from "../repos/feed.js";

const parser = new Parser();
const stripHtml = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const truncate = (s: string, n = 500) => (s.length > n ? s.slice(0, n).trimEnd() + "…" : s);

export async function fetchFeed(url: string): Promise<{ title: string; items: ParsedItem[] }> {
  const xml = await safeFetchText(url);
  const feed = await parser.parseString(xml);
  const items: ParsedItem[] = (feed.items ?? []).map((i) => {
    const link = i.link ?? "";
    const raw = i.contentSnippet ?? i.content ?? (i as { summary?: string }).summary ?? "";
    const enclosure = (i.enclosure as { url?: string } | undefined)?.url;
    return {
      guid: i.guid ?? link ?? i.title ?? cryptoRandom(),
      title: (i.title ?? "Untitled").trim(),
      url: link,
      excerpt: truncate(stripHtml(String(raw))),
      imageUrl: enclosure ?? null,
      author: (i.creator ?? (i as { author?: string }).author) ?? null,
      publishedAt: i.isoDate ? new Date(i.isoDate) : null,
    };
  }).filter((i) => i.url); // an item with no link can't be opened/deduped reliably
  return { title: (feed.title ?? url).trim(), items };
}

function cryptoRandom(): string { return globalThis.crypto.randomUUID(); }
```

- [ ] **Step 4: Tests** — `net.test.ts`: `assertPublicHttpUrl` rejects `file:`/`ftp:` (→ `bad_protocol`) and (with a hosts entry or a `127.0.0.1`-resolving name) a private host (`blocked_host`), accepts a normal `https://` public URL; `isPrivateOrLoopbackIp` unit cases still pass. `fetch.test.ts`: call the parser directly on a static RSS + Atom fixture string (bypass network by testing the mapping: refactor so a `parseFeedXml(xml)` pure helper is testable, or spy `safeFetchText`) → asserts title, item mapping, guid→link fallback, HTML-stripped/truncated excerpt.
- [ ] **Step 5:** `tsc --noEmit` (api) clean; both tests pass; the **existing linkedin tests still pass** (`pnpm --filter @outreach/api exec vitest run src/routes/linkedin.test.ts`). **Commit** — `feat(api): SSRF-guarded RSS fetch + parse`.

---

## Task 3: pg-boss feed ingestion + schedule

**Files:** modify `apps/api/src/queue.ts`, `apps/api/src/server.ts`; create `apps/api/src/jobs/fetch-feed.ts`; test `apps/api/src/jobs/fetch-feed.test.ts`.

**Produces:** `FEED_QUEUE`, `POLL_FEEDS_QUEUE`, `enqueueFeedFetch(sourceId)`; `fetchFeedSource(sourceId)`.

- [ ] **Step 1: queue.ts** — add `export const FEED_QUEUE = "fetch-feed";` and `export const POLL_FEEDS_QUEUE = "poll-feeds";`. In `getBoss`'s init, after the ingest `createQueue`, add `await b.createQueue(FEED_QUEUE, { retryLimit: 3, retryDelay: 60, retryBackoff: true }); await b.createQueue(POLL_FEEDS_QUEUE);`. Add `export async function enqueueFeedFetch(sourceId: string) { const b = await getBoss(); await b.send(FEED_QUEUE, { sourceId }); }`.

- [ ] **Step 2: The job**

```ts
// apps/api/src/jobs/fetch-feed.ts
import { getSource, updateSourceFetchState, insertItems } from "../repos/feed.js";
import { fetchFeed } from "../feed/fetch.js";

// A single broken feed must not crash the worker or retry-storm — mark it
// "error" and return (no throw), so pg-boss treats the job as done.
export async function fetchFeedSource(sourceId: string): Promise<void> {
  const source = await prismaSourceById(sourceId);
  if (!source) return;
  try {
    const feed = await fetchFeed(source.url);
    await insertItems(source.id, source.userId, feed.items);
    await updateSourceFetchState(source.id, { status: "active", error: null, lastFetchedAt: new Date() });
  } catch (e) {
    await updateSourceFetchState(source.id, { status: "error", error: String((e as Error).message ?? e), lastFetchedAt: new Date() });
  }
}

// Loaded without a userId (job context has none) — read the row directly.
import { prisma } from "@outreach/db";
async function prismaSourceById(id: string) {
  return prisma.feedSource.findUnique({ where: { id } });
}
```
(Do not use `getSource` here — the job has no userId; read by id.)

- [ ] **Step 3: server.ts boot** — inside the existing guarded boot IIFE, after the ingest `work(...)`, register:
```ts
await boss.work(FEED_QUEUE, { batchSize: 2 }, async (jobs) => { for (const j of jobs) await fetchFeedSource((j.data as { sourceId: string }).sourceId); });
await boss.work(POLL_FEEDS_QUEUE, async () => {
  const sources = await prisma.feedSource.findMany({ where: { status: "active" }, select: { id: true } });
  for (const s of sources) await enqueueFeedFetch(s.id);
});
await boss.schedule(POLL_FEEDS_QUEUE, "*/30 * * * *"); // poll every 30 min
```
Import `FEED_QUEUE, POLL_FEEDS_QUEUE, enqueueFeedFetch` from `./queue.js` and `fetchFeedSource` from `./jobs/fetch-feed.js`. (Verify the exact pg-boss v12 `schedule` signature against `node_modules/pg-boss/dist/types.d.ts`.)

- [ ] **Step 4: Test** — `fetch-feed.test.ts`: create a user + source, monkey-patch/spy `fetchFeed` (via `vi.mock("../feed/fetch.js")`) to return 2 items → `fetchFeedSource` inserts them + source `status:"active"`, `lastFetchedAt` set; make the mock throw → source `status:"error"`, no throw escapes.
- [ ] **Step 5:** `tsc --noEmit` clean; test passes; full api suite green. **Commit** — `feat(api): pg-boss feed ingestion + 30-min poll`.

---

## Task 4: Feed API routes

**Files:** create `apps/api/src/routes/feed.ts`; modify `apps/api/src/app.ts` (mount); test `apps/api/src/routes/feed.test.ts`.

- [ ] **Step 1: Router** (user-scoped — no accountId)

```ts
// apps/api/src/routes/feed.ts
import { Hono } from "hono";
import type { AppEnv } from "../app.js";
import { createSource, listSources, deleteSource, getSource, listItems, setItemStatus } from "../repos/feed.js";
import { fetchFeed } from "../feed/fetch.js";
import { enqueueFeedFetch } from "../queue.js";
import { insertItems } from "../repos/feed.js";

export function feedRoutes() {
  const r = new Hono<AppEnv>();

  r.get("/sources", async (c) => c.json({ sources: await listSources(c.get("user")!.id) }));

  r.post("/sources", async (c) => {
    const user = c.get("user")!;
    const { url } = await c.req.json<{ url?: string }>().catch(() => ({ url: undefined }));
    if (!url) return c.json({ error: "invalid_body" }, 400);
    let feed;
    try { feed = await fetchFeed(url); } catch { return c.json({ error: "unreachable" }, 400); }
    const source = await createSource({ userId: user.id, url, title: feed.title }).catch(() => null);
    if (!source) return c.json({ error: "duplicate" }, 409); // @@unique([userId, url])
    await insertItems(source.id, user.id, feed.items);
    void enqueueFeedFetch(source.id).catch(() => {});
    return c.json({ source });
  });

  r.delete("/sources/:id", async (c) => {
    const ok = await deleteSource(c.req.param("id"), c.get("user")!.id);
    return ok ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
  });

  r.post("/sources/:id/refresh", async (c) => {
    const s = await getSource(c.req.param("id"), c.get("user")!.id);
    if (!s) return c.json({ error: "not_found" }, 404);
    void enqueueFeedFetch(s.id).catch(() => {});
    return c.json({ ok: true });
  });

  r.get("/items", async (c) => {
    const status = c.req.query("status") ?? "new";
    return c.json({ items: await listItems(c.get("user")!.id, status) });
  });

  r.patch("/items/:id", async (c) => {
    const { status } = await c.req.json<{ status?: string }>().catch(() => ({ status: undefined }));
    if (!status || !["new", "read", "dismissed"].includes(status)) return c.json({ error: "invalid_body" }, 400);
    const updated = await setItemStatus(c.req.param("id"), c.get("user")!.id, status);
    return updated ? c.json({ item: updated }) : c.json({ error: "not_found" }, 404);
  });

  return r;
}
```

- [ ] **Step 2: Mount** — in `apps/api/src/app.ts`, `import { feedRoutes } from "./routes/feed.js";` and add `app.route("/feed", feedRoutes());` inside the authenticated group (next to the other `app.route`s behind the `if (!c.get("user")) 401` guard).

- [ ] **Step 3: Test** — signup (Origin header) → POST /feed/sources with a URL, `vi.mock("../feed/fetch.js")` returning `{title:"Ex", items:[{guid,title,url,excerpt}]}` → `{source}` created + item listed; duplicate url → 409; GET /feed/items scoped to user (other user sees none); PATCH item status → updated; cross-user PATCH → 404; DELETE source → ok.

- [ ] **Step 4:** `tsc --noEmit` clean; test passes; full api suite green. **Commit** — `feat(api): feed sources + items routes`.

---

## Task 5: Feed page UI

**Files:** modify `apps/web/src/components/app-shell.tsx` (nav); create `apps/web/src/app/(app)/feed/page.tsx` + `feed/feed-view.tsx`; create `apps/web/src/lib/feed.ts` (types); modify `apps/web/messages/en.json`+`de.json`.

- [ ] **Step 1: Nav** — add to the `NAV` array in `app-shell.tsx`: `{ href: "/feed", key: "feed", icon: Rss }` (import `Rss` from lucide-react), placed after `content` (Studio). Add i18n `nav.feed` ("Feed"/"Feed").

- [ ] **Step 2: Types** — `apps/web/src/lib/feed.ts`: `FeedSource` (`id, url, title, status, error, lastFetchedAt, createdAt`) and `FeedItem` (`id, sourceId, title, url, excerpt, imageUrl, author, publishedAt, status`).

- [ ] **Step 3: Page + view (client)** — build `feed-view.tsx` (`"use client"`) matching the app's Linear-ish style (full-width `p-6`, softened shadows, reuse shadcn `Button`/`Card`/`Badge`/`Dialog`/`Skeleton`, `useTranslations`). Requirements:
  - On mount, `fetch("/api/feed/sources")` and `fetch("/api/feed/items?status=new")` (credentials include).
  - **Sources bar:** an "Add source" button opening a small `Dialog` with a URL `Input` → `POST /api/feed/sources`; on 400/409 show an inline error; on success refresh. A compact list of sources (title + status badge; a red "error" state showing `source.error` in a tooltip) each with a remove (`DELETE`) and the whole bar has a "Refresh all" (POST refresh per source, then re-poll items).
  - **Stream:** filter tabs Neu / Alle / Verworfen (drives `?status=new|all|dismissed`). Item cards newest-first: source-title badge, item title as an `<a target="_blank" rel="noreferrer">` to `item.url`, excerpt, `publishedAt` (locale date), optional thumbnail (`imageUrl`, guarded, `object-cover`). Per-card actions: **[Post daraus]** (primary — see Task 6), **Gelesen** (`PATCH status:"read"`), **Verwerfen** (`PATCH status:"dismissed"`). All mutations check `res.ok` and re-sync.
  - **Polling:** while the page is open, re-fetch items every ~30 s so freshly-ingested articles appear (mirror the Resources tab's polling).
  - **Empty states:** no sources → invite to add one; no items → "Noch nichts reingekommen — füge eine Quelle hinzu oder aktualisiere."
- [ ] **Step 4: i18n** — add a `feed` block (title, subtitle, addSource, addSourcePlaceholder, sourceAdded, sourceError/duplicate/unreachable, refresh, remove, filterNew/All/Dismissed, actionPost, actionRead, actionDismiss, emptyNoSources, emptyNoItems, sourcesTitle) to en+de. No literal `<`/`{`/`}`.
- [ ] **Step 5:** `pnpm --filter @outreach/web exec tsc --noEmit` clean; `/feed` serves 200. **Commit** — `feat(web): Feed page (RSS sources + article stream)`.

---

## Task 6: "Article → Post" flow

**Files:** modify `apps/web/src/app/(app)/feed/feed-view.tsx`.

- [ ] **Step 1:** The **[Post daraus]** button on an item:
  - Fetch the user's accounts (`GET /api/linkedin/accounts`) on mount (store them). If **>1**, clicking opens a small account-picker `Dialog` (reuse the Studio create-dialog's `Select` pattern); with exactly 1, use it directly.
  - Build the prompt from the item (localized): `Schreib meinen eigenen LinkedIn-Post inspiriert von diesem Artikel — meine Sicht, kein Nacherzählen. Titel: "<title>". Kern: <excerpt>. Quelle: <url>` (i18n key `feed.postPrompt` with `{title}`, `{excerpt}`, `{url}` placeholders).
  - Create a draft: `POST /api/studio/<accountId>/drafts` `{}` → `{draft}`; then `router.push(`/studio/${draft.id}?prompt=${encodeURIComponent(prompt)}`)`. Optionally `PATCH /api/feed/items/<id> {status:"read"}` first (best-effort).
  - This reuses the existing Studio `?prompt=` auto-send + the agent's profile/no-go adherence — no studio-side changes.
- [ ] **Step 2:** i18n `feed.postPrompt` (en+de), `feed.pickAccount` (dialog title). `tsc --noEmit` clean; `/feed` serves 200. **Commit** — `feat(web): turn a feed article into a studio draft`.

---

## Task 7: End-to-end verification

- [ ] **Step 1:** Full typecheck sweep (db/ai/api/web) → 0 errors.
- [ ] **Step 2:** Test sweep: `pnpm --filter @outreach/api exec vitest run` (all green incl. feed repo/routes/job + unchanged linkedin tests).
- [ ] **Step 3:** Manual live smoke: add a real RSS URL (e.g. a public news/blog feed) → items appear (immediate fetch) → mark read/dismiss + filter → "Post daraus" (pick account if >1) → Studio opens and the agent drafts a take on the article in-voice. Confirm feed fetch rejects a `http://127.0.0.1` URL (400).
- [ ] **Step 4:** Report shipped scope, test/typecheck results, and any follow-ups (e.g. per-item LLM summary, more source types — all out of scope). Everything on `main`.
