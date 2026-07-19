# LinkedIn Publishing (v1) — Design

**Status:** approved (brainstorm)
**Date:** 2026-07-19

## Goal

Actually publish a draft to LinkedIn — text + optional image + an optional
source-link first comment — both on demand ("publish now") and automatically at
its scheduled time. Keep the account's token healthy (proactive + just-in-time
refresh) and fail gracefully (mark expired → reconnect) when it can't.

## Scope

**In this build (v1):**
- A LinkedIn publish client (Posts + Images + Comments API) in `@outreach/linkedin`.
- A `publishDraft` orchestration service (token → image upload → post → first comment → persist result).
- "Publish now" endpoint + a studio button with a confirm dialog.
- A pg-boss `publish-due` worker (1-minute sweep) that publishes due scheduled drafts.
- A pg-boss `refresh-tokens` worker (periodic) that refreshes near-expiry tokens.
- Just-in-time token refresh inside `publishDraft`; mark account `expired` on refresh failure.
- UI: published state (link to the live post), failed state (error + retry), reconnect CTA for expired accounts, and honest "will auto-publish" scheduling copy.

**Out of scope (later):** editing/deleting a published post from here; analytics of the freshly-published post; multi-image / video / document posts; per-post visibility controls (always PUBLIC in v1).

## Global constraints

- **Publishing is irreversible + outward-facing.** "Publish now" requires an explicit click **and** a confirm dialog. The scheduled worker publishes without a per-post prompt — the user's act of *scheduling* is the consent — so the schedule UI must state plainly that a scheduled post auto-publishes at its time.
- Never post to LinkedIn from tests or automated runs — the client is exercised with a mocked `fetch`. A real live post is done by the user with a test draft.
- Tokens are AES-GCM encrypted at rest (`@outreach/core` encrypt/decrypt via `getDecryptedAccount`); decrypted only in-memory for a request/job.
- Ownership: the publish endpoint verifies the account+draft belong to the user, like the other studio routes.
- Reuse existing infra: `LINKEDIN_API_VERSION` env (default `202601`); `LinkedInOAuthClient.refresh(refreshToken)` (already implemented) for token refresh; `getObject` for image bytes; pg-boss (`queue.ts`/`server.ts`) for workers.

## LinkedIn API shapes

> These are from current LinkedIn REST API knowledge and MUST be verified against the live API during implementation (header casing, field names, and the URN response header can drift). The client isolates them so a fix is one-file.

All calls: base `https://api.linkedin.com/rest`, headers `Authorization: Bearer <token>`, `LinkedIn-Version: <LINKEDIN_API_VERSION>`, `X-Restli-Protocol-Version: 2.0.0`.

- **Image upload** (only if the draft has an image):
  1. `POST /images?action=initializeUpload` body `{ "initializeUploadRequest": { "owner": "<memberUrn>" } }` → `{ value: { uploadUrl, image } }` (`image` is the image URN).
  2. `PUT <uploadUrl>` with `Authorization: Bearer` + the raw image bytes (content-type from storage) → 201.
- **Create post:** `POST /posts` body:
  ```json
  {
    "author": "<memberUrn>",
    "commentary": "<draft text>",
    "visibility": "PUBLIC",
    "distribution": { "feedDistribution": "MAIN_FEED", "targetEntities": [], "thirdPartyDistributionChannels": [] },
    "lifecycleState": "PUBLISHED",
    "isReshareDisabledByAuthor": false
  }
  ```
  plus `"content": { "media": { "id": "<imageUrn>" } }` when there's an image. The created post URN comes back in the `x-restli-id` response header (also `x-linkedin-id`) — capture it as `externalId`.
- **First comment:** `POST /socialActions/<url-encoded postUrn>/comments` body `{ "actor": "<memberUrn>", "object": "<postUrn>", "message": { "text": "Quelle: <feed item url>" } }`.

`memberUrn` is `LinkedInAccount.memberUrn`; the implementer must confirm it is the full `urn:li:person:...` (prefix it if only the id is stored).

## Publish client (`packages/linkedin`)

`LinkedInPublishClient` (mirrors `MemberAnalyticsClient`'s config/fetch-injection shape so it's unit-testable with a mock `fetch`):
- `constructor({ accessToken, apiVersion?, fetchImpl? })`
- `uploadImage(ownerUrn: string, bytes: Uint8Array, contentType: string): Promise<string>` → image URN
- `createPost(input: { authorUrn: string; text: string; imageUrn?: string }): Promise<string>` → post URN
- `addComment(postUrn: string, actorUrn: string, text: string): Promise<void>`
- Throws a typed `LinkedInPublishError` (carrying HTTP status) on non-2xx so the orchestrator can distinguish auth (401) from other failures.

Exported from `@outreach/linkedin`.

## Publish orchestration (`apps/api`)

`publishDraft(draftId: string, accountId: string, userId: string): Promise<Draft>` in a new `apps/api/src/publish/publish-draft.ts`:
1. Load the draft (must belong to `accountId`) and `getDecryptedAccount(accountId, userId)` (token, refreshToken, memberUrn, tokenExpiresAt, status).
2. **Ensure a valid token:** if `tokenExpiresAt` is missing/within a small skew of now, call `LinkedInOAuthClient.refresh(refreshToken)`, persist the new access/refresh token + `tokenExpiresAt` (re-encrypted), and use the fresh token. If there is no refresh token or refresh fails → set account `status = "expired"`, set the draft `status = "failed"` + `publishError`, and stop.
3. If `draft.imageUrl`: derive the storage key (`imageUrl` `/generated/<name>` → `generated/<name>`), `getObject` the bytes, `uploadImage` → image URN. (No image → skip.)
4. `createPost({ authorUrn: memberUrn, text: draft.text, imageUrn })` → post URN.
5. If `draft.sourceFeedItemId`: look up the feed item's URL and `addComment(postUrn, memberUrn, "Quelle: <url>")`. A failed comment does NOT fail the post (log + continue) — the post is already live.
6. On success: `status = "published"`, `publishedAt = now`, `externalId = postUrn`, `publishError = null`.
7. On any publish failure (after the token is valid): `status = "failed"`, `publishError = <message>` (leave `scheduledAt` so the user can see what was due). A 401 mid-flight also flips the account to `expired`.

The result is idempotent-ish: never publish a draft already `published` (guard on entry) to avoid double-posting on a worker retry.

## Entry points

- **Publish now:** `POST /studio/:accountId/drafts/:id/publish` (studio route, ownership-checked) → `publishDraft`, returns `{ draft }` (200) or the failed draft with its error. Studio toolbar gets a **"Veröffentlichen"** button that opens a confirm `Dialog` ("This posts publicly to LinkedIn now") before calling it. Disabled while a publish is in flight and when there is no text.
- **Scheduled publishing:** pg-boss queue `publish-due`, `schedule("publish-due", "* * * * *")` (every minute). The worker: find drafts `status = "scheduled"` AND `scheduledAt <= now`, and `publishDraft` each (best-effort, one failure doesn't stop the batch). Because `publishDraft` flips status away from `scheduled`, a post is only ever picked up once; failures become `failed` (surfaced to the user, retryable), not re-attempted every minute.

## Token refresh worker

pg-boss queue `refresh-tokens`, `schedule("refresh-tokens", "0 */6 * * *")` (every 6h). The worker: find accounts with a refresh token, `status = "active"`, and `tokenExpiresAt < now + 7 days`; refresh each via `LinkedInOAuthClient.refresh`, persist new tokens + expiry; on failure set `status = "expired"`. This keeps tokens fresh ahead of scheduled posts so publishing rarely hits the just-in-time path.

## Data model

- Add `Draft.publishError String?` (nullable). `status` values now: `draft | scheduled | published | failed`.
- `LinkedInAccount` already has `status` (`active | expired | revoked`), `tokenExpiresAt`, `refreshToken` — no change.
- Small migration for the new column (follow the repo's manual-migration discipline; the pgvector HNSW index must not be dropped — use `--create-only` and strip any spurious index DROP, or a hand-written ALTER).

## UI

- **Studio:** a "Veröffentlichen" button (confirm dialog). After success, the status badge shows `published` and a link opens the live post (`https://www.linkedin.com/feed/update/<externalId>`). On `failed`, show `publishError` with a "Retry" (re-call publish). Update the schedule/"Plan" copy to state a scheduled post auto-publishes at its time.
- **Accounts:** when `status = "expired"`, show a clear "LinkedIn neu verbinden" CTA (re-run the OAuth connect flow).
- **Calendar:** the "not published yet" marker stays for `scheduled`; `published` events read as published, `failed` events flagged (so a missed post is visible).

## Testing

- `packages/linkedin`: `LinkedInPublishClient` unit tests with a mocked `fetch` — image upload (init + PUT), create post (captures the URN header), add comment, and error mapping (401 → auth error). No network.
- `apps/api`: `publishDraft` tests with mocked publish client + storage + oauth refresh — success path (published + externalId), image path, first-comment path, token-refresh path, refresh-failure → account expired + draft failed, and the already-published guard. Repo/route ownership tests for the publish endpoint (404 for foreign account/draft).
- Worker logic (`publish-due` selection, `refresh-tokens` selection) unit-tested at the query/selection level.
- **No live LinkedIn calls in the suite.** The end-to-end live post is a manual step the user performs with a throwaway draft.

## Rollout note

Once this ships, scheduling becomes a real commitment (auto-publish). The schedule dialog and the calendar copy must be updated in lockstep so the user is never surprised by an automatic post.
