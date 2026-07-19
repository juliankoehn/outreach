# Feed / Content-Radar — Design

**Status:** Design approved 2026-07-19 (brainstorm: RSS-only start, "article → post" hero, per-user scope).
**Goal:** A per-user Feed page: the user registers RSS sources, a background job pulls articles in, and one click on an item ("Post daraus") lands them in the Studio where the agent drafts their own take on the article, in their voice.

## Decisions (from brainstorm)

- **Sources:** RSS/Atom only to start (extensible to other source types later). User-provided feed URLs.
- **Core flow:** "article → post" is the hero. Items also have lightweight read/dismiss. Not a full reader/curation app.
- **Scope:** per-**user** (`userId`). Industry content isn't persona-specific; the LinkedIn account is chosen only when the user turns an item into a post (reusing the Studio create-dialog account picker).
- **Ingestion:** pg-boss (already running in the API process from Resources Phase 2), with a scheduled poll.

## Context (already built — reuse, don't rebuild)

- **pg-boss** runs in the API process (`apps/api/src/queue.ts` `getBoss`/`enqueue…`, boot wiring in `apps/api/src/server.ts`). Add a new queue + a scheduled poll here.
- **SSRF guard:** `isPrivateOrLoopbackIp(ip)` exists in `apps/api/src/routes/linkedin.ts` (added for the embed-fetch hardening). Extract it to a shared `apps/api/src/net.ts` and reuse for feed fetching.
- **Studio create-dialog + `?prompt=`:** `apps/web/src/app/(app)/studio/page.tsx` has the account-picker dialog; the studio detail page reads `?prompt=` and auto-sends it to the agent (`initialPrompt`). The "article → post" flow reuses this exact path.
- **App shell nav:** `apps/web/src/components/app-shell.tsx` holds the top-level nav (Dashboard / Konten / Studio). Add "Feed".
- Prisma 7, Hono + Better Auth, Next.js 16 + next-intl (en/de), pnpm/TS 7. Trunk-based (commit to `main`, per-task).

---

## Global Constraints

- ESM `.js` import specifiers; TS 7 native (`declaration:false`; pure-node pkgs `"types":["node"]`).
- Prisma 7: client generated to `packages/db/src/generated/prisma` (gitignored); import `{ prisma }` + model types from `@outreach/db`. Migrate: `pnpm --filter @outreach/db exec prisma migrate dev --name <n>`.
- API is user-scoped for feed routes (behind the auth guard; `c.get("user")`). No accountId in the feed URLs.
- pg-boss v12 API (named export `PgBoss`, explicit `createQueue`, `work(name, {batchSize}, handler[])`, `schedule(name, cron, data)`).
- Web ↔ API via `/api/[...proxy]`; app pages full-width `p-6`. i18n en+de, **no literal `<`/`{`/`}` in plain ICU strings**.
- SSRF: server-side feed fetches must reject non-http(s) URLs and any URL whose resolved host is loopback/private/link-local; cap body size + timeout; re-check on redirects.
- Never `next build` while `next dev` runs; restart api after api/db edits. Bare `vitest` loads root `.env`. Trunk-based: commit directly to `main`, per-task.

---

## 1. Data Model (Prisma, user-scoped)

```prisma
model FeedSource {
  id            String   @id @default(cuid())
  userId        String
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  url           String
  title         String
  status        String   @default("active") // "active" | "error"
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
  userId      String   // denormalized so the feed query scopes by user without a join
  guid        String   // stable per-item id from the feed (guid/id/link) for dedupe
  title       String
  url         String
  excerpt     String   // plain-text summary, truncated
  imageUrl    String?
  author      String?
  publishedAt DateTime?
  status      String   @default("new") // "new" | "read" | "dismissed"
  createdAt   DateTime @default(now())

  @@unique([sourceId, guid])
  @@index([userId, status, publishedAt])
}
```
Add back-relations to `User` (`feedSources FeedSource[]`).

**Repos** (`apps/api/src/repos/feed.ts`): `createSource`, `listSources(userId)`, `getSource(id, userId)`, `deleteSource(id, userId)`, `updateSourceFetchState(id, {status, error, lastFetchedAt})`, `insertItems(sourceId, userId, items[])` (dedupe on `(sourceId, guid)` — skip existing), `listItems(userId, status?, limit)`, `setItemStatus(id, userId, status)`, `getItem(id, userId)`.

## 2. RSS Fetch + Parse (`apps/api/src/feed/`)

- **`apps/api/src/net.ts`** (new; extract from linkedin.ts): `isPrivateOrLoopbackIp(ip)` (moved) + `assertPublicHttpUrl(url): URL` (throws if not http/https or resolves to a private/loopback IP). linkedin.ts imports the moved helper.
- **`apps/api/src/feed/fetch.ts`**: `fetchFeed(url): Promise<ParsedFeed>` — SSRF-guarded fetch (`assertPublicHttpUrl`, `redirect: "manual"` re-checking each hop, timeout ~12s, body cap ~5 MB), then parse with **`rss-parser`**. Returns `{ title, items: ParsedItem[] }` where `ParsedItem = { guid, title, url, excerpt, imageUrl?, author?, publishedAt? }`. `guid` falls back to `link` when the feed has no guid; `excerpt` is HTML-stripped + truncated (~500 chars); `imageUrl` from enclosure/media/og.
- `rss-parser` is added to `apps/api`.

## 3. Ingestion (pg-boss)

- `apps/api/src/queue.ts`: add `FEED_QUEUE = "fetch-feed"` + `enqueueFeedFetch(sourceId)`.
- `apps/api/src/jobs/fetch-feed.ts`: `fetchFeedSource(sourceId)` — load source; `fetchFeed(source.url)`; map to `ParsedItem`s; `insertItems` (dedupe); `updateSourceFetchState({status:"active", lastFetchedAt: now})`; on error → `status:"error"` + message (do NOT throw hard for a bad feed — a single broken feed shouldn't spam retries; log + mark error).
- **Boot wiring (`apps/api/src/server.ts`):** register `work(FEED_QUEUE, {batchSize:2}, …)` → `fetchFeedSource`; and `boss.schedule("poll-feeds", "*/30 * * * *")` + `work("poll-feeds", …)` handler that loads all `active` sources and `enqueueFeedFetch` each. All inside the existing guarded boot IIFE.
- **On add:** the `POST /feed/sources` route enqueues an immediate `enqueueFeedFetch(source.id)` (best-effort).

## 4. API Routes (`apps/api/src/routes/feed.ts`, user-scoped, mounted under the auth guard)

- `POST /feed/sources` `{ url }` — validate (`assertPublicHttpUrl`), fetch once to get the feed title (and first items), create `FeedSource`, insert initial items, enqueue a background fetch. Returns `{ source }`. 400 on invalid/unreachable URL.
- `GET /feed/sources` — list the user's sources.
- `DELETE /feed/sources/:id` — delete (cascades items).
- `POST /feed/sources/:id/refresh` — enqueue an immediate fetch; returns `{ ok }`.
- `GET /feed/items?status=new|all|dismissed&limit=` — list the user's items (default `new`, newest first).
- `PATCH /feed/items/:id` `{ status: "read" | "dismissed" | "new" }` — update item status.

Mount in `apps/api/src/app.ts` as `app.route("/feed", feedRoutes())` inside the authenticated group.

## 5. Feed Page UI (`apps/web/src/app/(app)/feed/`)

New top-level nav item **"Feed"** in `app-shell.tsx` (between Studio and the "bald" items), route `/feed`.

`feed/page.tsx` (client):
- **Sources bar:** "RSS-Quelle hinzufügen" opens a small dialog (URL input) → `POST /feed/sources`; a compact list/pills of sources with status + remove; a "Aktualisieren" button (`refresh` all / per source).
- **Stream:** item cards (newest first) — source title badge, item title (links to the article in a new tab), excerpt, published date, optional thumbnail. Actions per card: **[Post daraus]** (primary), **Gelesen**, **Verwerfen**. Filter tabs: Neu / Alle / Verworfen.
- **Empty states:** no sources → invite to add one; no items → "Noch nichts reingekommen".
- **Auto-refresh:** poll `GET /feed/items` every ~30 s while the page is open (light), or a manual refresh button — mirror the Resources tab's polling ergonomics.
- Reuse existing shadcn primitives; full-width `p-6`; restrained Linear-ish styling; softened shadows. i18n en+de.

## 6. "Article → Post" Flow (the hero)

On **[Post daraus]**:
- If the user has **>1 LinkedIn account**, show the account picker (reuse the Studio create-dialog's Select). With exactly 1 account, skip the picker.
- Create a draft for the chosen account (`POST /api/studio/:accountId/drafts`), then redirect to `/studio/:draftId?prompt=<encoded>`.
- The prompt is built from the item, e.g.: `Schreib meinen eigenen LinkedIn-Post inspiriert von diesem Artikel — meine Sicht, kein Nacherzählen. Titel: "<title>". Kern: <excerpt>. Quelle: <url>`. (Localized; the studio agent already respects profile/no-gos/voice.)
- Optionally mark the item `read` on success.

This reuses the create-draft endpoint + the `?prompt=` auto-send already built — no new studio work.

---

## Testing

- **Parse:** `fetchFeed`/parser against a small static RSS + Atom fixture string → correct `{title, items}` mapping, guid fallback to link, HTML-stripped excerpt, dedupe-ready guids. (Parse is unit-testable without network by injecting the XML.)
- **SSRF:** `assertPublicHttpUrl` rejects `file:`/`ftp:`, and hosts resolving to loopback/private/link-local; accepts a normal public URL. (Reuse the `isPrivateOrLoopbackIp` unit tests.)
- **Repos:** create source, insert items with dedupe (re-inserting same guids is a no-op), list by status/user scoping (cross-user sees nothing), setItemStatus.
- **Ingestion job:** `fetchFeedSource` with a stubbed `fetchFeed` → items inserted, source `lastFetchedAt`/`status` set; a throwing `fetchFeed` → source `status:"error"`, no crash.
- **Routes:** add source (mock/stub the fetch) → `{source}`; list; refresh enqueues; items list scoped to user; patch status; cross-user access → 404.
- Web typecheck clean; `/feed` serves 200; the "Post daraus" flow creates a draft and redirects with `?prompt=`.

## Success Criteria

- I can add an RSS URL, and articles appear in the Feed (fetched immediately + polled every ~30 min).
- Items can be marked read/dismissed and filtered.
- "Post daraus" opens the Studio with a draft the agent writes as my own take on the article, in my voice.
- Feeds are per-user; the account is chosen at post time.
- Feed fetches are SSRF-safe (no private-IP access, http/https only, size/time capped).

## Explicitly NOT in this feature

- Non-RSS sources (newsletters, news APIs, keyword watch) — later source types.
- Full reader/curation (folders, favourites, read-later queues) — lightweight read/dismiss only.
- AI-generated "post idea" previews on the cards, per-item summarization by an LLM, or auto-posting.
- Per-account feed scoping.
