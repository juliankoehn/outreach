# Performance Loop (v1) — Design

**Status:** approved (brainstorm)
**Date:** 2026-07-20

## Goal

Close the learn-from-what-works flywheel: a post we published gets its real
LinkedIn engagement pulled automatically over the days after it goes live, and
that performance is surfaced on the post and already feeds the profile learning.

## Context — most machinery already exists (reuse, don't rebuild)

- `MemberAnalyticsClient.forPost(urn)` (`@outreach/linkedin`) → per-post
  `{ impressions, membersReached, reactions, comments, reshares }`.
- `repos/post.ts`: `postsToEnrich(accountId, limit)` (posts with an `externalId`),
  `setPostMetrics(postId, metrics)`.
- `POST /linkedin/accounts/:id/enrich` (routes/linkedin.ts) — the manual "Load
  per-post metrics" flow: fetch `forPost` for recent posts + `setPostMetrics`,
  with 429/rate-limit handling.
- Published drafts already create a `Post` row (with `externalId`) — so they are
  already eligible for the exact same enrichment.
- `analyzePosts` (`@outreach/ai`) already grounds `topPatterns` on the metrics —
  the learning loop already uses performance data.

## The delta (what's actually new)

**1. Auto-enrich worker (the "loop").** A pg-boss `enrich-metrics` queue on a
**daily** cron. For each `active` LinkedIn account, enrich the metrics of posts
published in the **last 30 days** (LinkedIn counts keep growing for days, so a
daily re-pull of the recent window keeps them fresh without hammering the API;
older posts barely change). Reuses the enrichment logic, extracted so both the
route and the worker share it. Rate-limit (429) → stop that account's run
gracefully (as the existing route does); an expired token → skip (the existing
`refresh-tokens` worker handles expiry).

- Extract `enrichAccountMetrics(accountId, userId, { sinceDays }): Promise<{ enriched: number; failed: number; total: number }>` into `apps/api/src/analytics/enrich.ts`; the existing `/enrich` route calls it (window = all recent, its current `ENRICH_LIMIT` behaviour preserved), the worker calls it windowed to 30 days.
- New repo query `postsToEnrichRecent(accountId, since: Date)` (or a `since?` param on `postsToEnrich`) selecting posts with `externalId` and `publishedAt >= since`.

**2. Surface performance on the published post.**
- **Studio published-state:** show the post's `{ impressions, reactions, comments }` when available. The draft GET response (`GET /studio/:accountId/drafts/:id`) gains a `metrics` field (join the account's `Post` by `externalId` when the draft is published).
- **Calendar published-event hovercard:** the calendar feed (`listScheduledDrafts`) includes `metrics` for published events (same `Draft.externalId → Post.metrics` join); the hovercard renders a compact metrics line.

**3. Learning — unchanged.** `analyzePosts` already uses metrics; the user still
triggers "Analyze my posts", but now it grounds on real published-post data.

## Out of scope (later)

- Per-post historical time-series / charts (we store the latest aggregate only).
- Automatic re-analysis of the profile on new metrics (still user-triggered).
- Enriching posts older than 30 days on a schedule (manual enrich still can).

## Constraints

- Never a real LinkedIn call in tests — the analytics client is injected/mocked;
  the worker's selection query is DB-only.
- The worker uses the account's decrypted token in-memory only; on 401 it skips
  the account (does not crash the batch) — per-account try/catch.
- No schema change (`Post.metrics` JSON already exists).

## Testing

- `postsToEnrichRecent` selection (DB): includes externalId posts within the
  window, excludes older / no-externalId ones.
- `enrichAccountMetrics` with an injected fake analytics client + fake token:
  enriches each recent post, tolerates a per-post failure, reports counts. No
  network.
- Calendar feed includes `metrics` for a published draft that has a matching
  `Post`. Draft GET returns `metrics` for a published draft.
- Live check: trigger enrichment for the user's actually-published post and
  confirm real metrics appear (the one place a real LinkedIn call is fine — it's
  the user's own account, run by the user/controller, not the test suite).
