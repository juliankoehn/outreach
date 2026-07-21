# Post Detail: AI Analysis + Comment Tree — Design

**Date:** 2026-07-21
**Status:** approved (brainstorm)

## Problem

The account posts list (`accounts/[id]/posts`) is a flat, non-clickable list.
There is no way to open a single post, see its full metrics, read its LinkedIn
comments, or learn *why* it performed the way it did. The platform's loop
(learn → draft → publish → measure → **learn again**) is missing the last step:
turning a published post's real outcome into reusable guidance for future posts.

## Goal

A per-post detail page that shows the full post, its metrics, its LinkedIn
comment tree, and an AI analysis that extracts concrete, reusable learnings —
and feeds the confirmed learnings back into the profile so the studio writer is
automatically grounded in what actually worked.

## Decisions (locked in brainstorm)

- **Detail page** (not accordion): `/accounts/[id]/posts/[postId]`; the list rows
  become links.
- **Comments** are real (the account has the LinkedIn Community Management API).
  They are **synced into a dedicated table**, not only fetched live.
- **Analysis runs automatically on enrich** (manual button + daily worker), which
  becomes a full refresh: metrics + comment sync + AI analysis. To bound cost, the
  stored analysis records the `basis` it was computed from —
  `{ impressions, commentCount }`. The daily worker (re)analyses a post only when
  `analyzedAt` is null **or** the current impressions or comment count differ from
  that `basis`; a **manual** enrich forces re-analysis regardless. Any per-run cap
  is `log()`-ed, never silent.
- **Feedback loop:** each learning gets accept/reject; **accepted** learnings merge
  into the profile's `derived.topPatterns`, which the studio writer already
  consumes — closing the loop automatically.

## Data model

- **`PostComment`** (new table): the synced LinkedIn comment tree.
  - `id` (cuid), `postId` (FK → Post, cascade), `externalId` (comment URN,
    unique per post), `parentId String?` (parent comment URN for replies; null =
    top-level — the tree is built from this), `authorName`, `authorUrn String?`,
    `text`, `likeCount Int @default(0)`, `commentedAt DateTime` (LinkedIn time),
    `fetchedAt DateTime @default(now())`.
  - `@@unique([postId, externalId])`, `@@index([postId])`.
- **`Post`** gains: `analysis Json?` and `analyzedAt DateTime?`.
- Migration hand-crafted + `prisma migrate deploy` (repo has pre-existing
  checksum drift that makes `migrate dev` want to reset — avoid; keep the
  `resource_chunk_embedding_hnsw` index intact).

## LinkedIn comments read client (`packages/linkedin`)

`LinkedInCommentsClient` (mirrors `MemberAnalyticsClient`'s config: `accessToken`,
`apiVersion`, `fetchImpl`).
- `forPost(postUrn): Promise<CommentNode[]>` — `GET /rest/socialActions/{encoded
  Urn}/comments` (headers: Bearer, `LinkedIn-Version`, `X-Restli-Protocol-Version:
  2.0.0`), paginated; for each top-level comment fetch its replies (one level;
  deeper levels flattened under their nearest synced parent), with page-count and
  total caps.
- Returns a normalized `CommentNode { externalId, parentId, authorName, authorUrn,
  text, likeCount, commentedAt }[]` (flat list; the tree is rebuilt from
  `parentId` in the UI/repo).
- **The exact LinkedIn response shape is verified live against the user's account
  during implementation** (Task: comments client) before the parser is finalized.
- Failure/empty (or missing API access) degrades gracefully: the sync records
  nothing and the UI shows a "no comments / not available" hint.

## AI analysis (`packages/ai`: `analyzePost`)

`analyzePost(input, opts?)` → a validated object via `generateObject`.
- **Input:** post text, media type, `publishedAt`, metrics (impressions, members
  reached, reactions, comments, reshares) + computed engagement rate, the
  account's aggregate baseline (from `LinkedInAccount.analytics`), the profile
  (goals, audience, pillars, toneWords, noGos, brandBrief), and the comment tree.
- **Output (`POST_ANALYSIS_SCHEMA`):**
  - `performance`: one-paragraph read + `engagementRate` (number) +
    `verdict` ("over" | "on-par" | "under" vs. the account baseline).
  - `teardown`: hook, structure/format, matched pillar, length, media, CTA,
    tone-match — short strings.
  - `audienceSignals`: from comments — sentiment summary, recurring
    questions/themes, what resonated (empty when no comments).
  - `goalFit`: did it serve the profile's goals (short).
  - `learnings`: 3–5 concrete, reusable, forward-looking takeaways (each a short
    string suitable to append to `derived.topPatterns`).
- Grounded strictly in the provided data; no invented metrics.
- The server stamps a `basis: { impressions, commentCount }` onto the stored
  `analysis` JSON (not model output) for the skip-if-fresh rule above.

## Enrich flow (full refresh)

`enrichAccountMetrics` extends its per-post step to: (1) refresh metrics
(existing), (2) sync comments into `PostComment` (upsert by `[postId,
externalId]`), (3) run `analyzePost` and store `analysis` + `analyzedAt` — subject
to the cost rule above (`force` on manual enrich; skip-if-fresh on the worker).
Injectable deps stay test-friendly (`makeClient` gains a comments client;
`analyzePost` is injectable/mocked in tests). Caps are `log`-ed.

## Feedback loop (learnings → profile)

- The detail page renders each `learnings[]` item with accept/reject controls
  (same interaction as the profile fine-tune facets).
- **Accept** → `POST /api/linkedin/accounts/:id/posts/:postId/learnings` with the
  accepted items → merged (dedupe, case-insensitive) into the profile's
  `derived.topPatterns` via `updateProfileById`. The studio writer already folds
  `derived.topPatterns` into its `insights` context, so future drafts are grounded
  in confirmed learnings with no extra wiring.
- Reject just dismisses locally (not persisted).

## Web (UI)

- `PostRow` becomes a link to `/accounts/[id]/posts/[postId]`.
- New detail page:
  - The post in the shared `FeedPostShell` look + "View on LinkedIn" (built from
    `externalId`).
  - **Metrics grid**: impressions, members reached, reactions, comments,
    reshares, engagement rate, and the vs-baseline verdict.
  - **Comment tree**: nested comments → replies (from `PostComment`), with author,
    text, like count, relative time; empty-state hint when none.
  - **Analysis** section: performance / teardown / audience signals / goal fit,
    and the learnings list with accept/reject. "Analyze now" button (manual
    trigger) when no analysis exists yet or to re-run.
- i18n en/de throughout.

## Testing

- **unit (ai):** `analyzePost` output schema + grounding (uses provided metrics,
  no fabrication); engagement-rate computation.
- **unit (linkedin):** comment-tree normalization/parsing against a captured
  real response fixture; pagination/depth caps.
- **api:** enrich runs metrics + comment sync + analysis (mocked clients), respects
  skip-if-fresh vs. force; learnings-accept merges into `derived.topPatterns`.
- **live:** load a real published post's comments (verify the API shape), run a
  real analysis, accept a learning and confirm it lands in the profile insights.

## Out of scope

- Replying to / moderating comments from the app (read + analyze only).
- Cross-post aggregate dashboards (the per-post learnings feeding the profile is
  the aggregate mechanism for now).
- Backfilling analysis for historical posts beyond the enrich window.
