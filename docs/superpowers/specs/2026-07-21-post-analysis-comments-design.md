# Post Detail: AI Analysis — Design

**Date:** 2026-07-21
**Status:** approved (brainstorm)

## Problem

The account posts list (`accounts/[id]/posts`) is a flat, non-clickable list.
There is no way to open a single post, see its full metrics, or learn *why* it
performed the way it did. The platform's loop (learn → draft → publish → measure
→ **learn again**) is missing the last step: turning a published post's real
outcome into reusable guidance for future posts.

## Goal

A per-post detail page that shows the full post, its metrics, and an AI analysis
that extracts concrete, reusable learnings — and feeds the confirmed learnings
back into the profile so the studio writer is automatically grounded in what
actually worked.

## Decisions (locked in brainstorm)

- **Detail page** (not accordion): `/accounts/[id]/posts/[postId]`; the list rows
  become links.
- **Comments are out of scope** for now. Reading socialActions (comments/reactions
  on the member's posts) needs the `r_member_social` scope, which is a Community
  Management API upgrade this app does not have (verified live: `GET
  /rest/socialActions/{urn}/comments` → 403 ACCESS_DENIED; the token carries only
  `r_basicprofile, r_member_postAnalytics, w_member_social`). The analysis is
  grounded in post text + metrics + profile. Comments are a clean future add-on
  (see Out of scope).
- **Analysis runs automatically on enrich** (manual button + daily worker). To
  bound cost, the stored analysis records the `basis` it was computed from —
  `{ impressions }`. The daily worker (re)analyses a post only when `analyzedAt`
  is null **or** current impressions differ from that `basis`; a **manual** enrich
  forces re-analysis. A per-post "Analyze now" button also forces it. Any per-run
  cap is `log()`-ed, never silent.
- **Feedback loop:** each learning gets accept/reject; **accepted** learnings merge
  into the profile's `derived.topPatterns`, which the studio writer already
  consumes — closing the loop automatically.

## Data model

- **`Post`** gains: `analysis Json?` and `analyzedAt DateTime?`.
- Migration hand-crafted + `prisma migrate deploy` (repo has pre-existing
  checksum drift that makes `migrate dev` want to reset — avoid; keep the
  `resource_chunk_embedding_hnsw` index intact).

## AI analysis (`packages/ai`: `analyzePost`)

`analyzePost(input, opts?)` → a validated object via `generateObject` (same shape
as `analyzePosts`/`generateObject` usage in `packages/ai/src/analyze.ts`).
- **Input:** post text, media type, `publishedAt`, metrics (impressions, members
  reached, reactions, comments, reshares) + computed engagement rate, the
  account's aggregate baseline (from `LinkedInAccount.analytics`), and the profile
  (goals, audience, pillars, toneWords, noGos, brandBrief).
- **Output (`POST_ANALYSIS_SCHEMA`):**
  - `performance`: one-paragraph read + `engagementRate` (number) +
    `verdict` ("over" | "on-par" | "under" vs. the account baseline).
  - `teardown`: hook, structure/format, matched pillar, length, media, CTA,
    tone-match — short strings.
  - `goalFit`: did it serve the profile's goals (short).
  - `learnings`: 3–5 concrete, reusable, forward-looking takeaways (each a short
    string suitable to append to `derived.topPatterns`).
- Grounded strictly in the provided data; no invented metrics.
- The server stamps a `basis: { impressions }` onto the stored `analysis` JSON
  (not model output) for the skip-if-fresh rule above. Engagement rate =
  (reactions + comments + reshares) / impressions, 0 when impressions is 0.

## Enrich flow (metrics + analysis)

`enrichAccountMetrics` extends its per-post step to also run `analyzePost` and
store `analysis` + `analyzedAt` — subject to the cost rule above (`force` on
manual enrich / the button; skip-if-fresh on the worker, comparing current
impressions to the stored `basis.impressions`). The analytics client stays
injectable; `analyzePost` is injected/mocked in tests. Caps are `log`-ed.

## Feedback loop (learnings → profile)

- The detail page renders each `learnings[]` item with accept/reject controls
  (same interaction as the profile fine-tune facets, `POST /profiles/:id/facets`).
- **Accept** → `POST /api/linkedin/accounts/:id/posts/:postId/learnings` with the
  accepted items → resolve the account's profile (`getAccountProfile`) → append to
  `derived.topPatterns` (dedupe, case-insensitive) via `updateProfileById({
  derived })`. The studio writer already folds `derived.topPatterns` into its
  `insights` context (see `apps/api/src/routes/studio.ts`), so future drafts are
  grounded in confirmed learnings with no extra wiring.
- Reject just dismisses locally (not persisted).

## Web (UI)

- `PostRow` becomes a link to `/accounts/[id]/posts/[postId]`.
- New detail page:
  - The post in the shared `FeedPostShell` look + "View on LinkedIn" (built from
    `externalId`).
  - **Metrics grid**: impressions, members reached, reactions, comments,
    reshares, engagement rate, and the vs-baseline verdict.
  - **Analysis** section: performance / teardown / goal fit, and the learnings
    list with accept/reject. "Analyze now" button when no analysis exists yet or
    to re-run.
- i18n en/de throughout.

## Testing

- **unit (ai):** `analyzePost` output schema + grounding (uses provided metrics,
  no fabrication); engagement-rate computation (incl. 0-impressions guard).
- **api:** enrich runs metrics + analysis (mocked client + `analyzePost`), respects
  skip-if-fresh vs. force; single-post detail read; learnings-accept merges into
  `derived.topPatterns` (dedupe).
- **live:** run a real analysis on a real published post; accept a learning and
  confirm it lands in the profile insights.

## Out of scope

- **Comments** (tree, sentiment, audience signals): blocked on the `r_member_social`
  Community-Management upgrade. When granted, add: the scope + reconnect, a
  `LinkedInCommentsClient.forPost()` read client, a `PostComment` table synced on
  enrich, a comment-tree UI on the detail page, and an `audienceSignals` dimension
  fed from comments into `analyzePost`. The analysis schema leaves room for this.
- Replying to / moderating comments from the app.
- Cross-post aggregate dashboards (the per-post learnings feeding the profile is
  the aggregate mechanism for now).
