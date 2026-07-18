# LinkedIn Outreach Platform — Design

**Date:** 2026-07-18
**Status:** Approved (design), Sub-project 1 ready for planning

## 1. Vision

A multi-tenant platform that connects a user's LinkedIn account(s), ingests their
existing posts, analyzes them with AI, and — on a schedule — generates and publishes
new posts (text + images, including personalized "content selfies"). The AI's core job
is to evaluate the user's post history and drive future content from those insights.

The system is delivered as a **Turborepo monorepo** with a web client (Next.js) and a
desktop client (Electron), both talking to a single central backend service.

## 2. Roadmap (decomposition)

The full product is too large for one spec. It is decomposed into sequential
sub-projects. **This document specifies Sub-project 1 in detail**; the rest are listed
so the foundation (data model, API) accommodates them.

1. **Foundation + LinkedIn Connect + Post Ingestion** ← *this spec*
   Monorepo scaffold, DB, app auth, LinkedIn OAuth, read existing posts into the DB.
2. **AI Post Analysis**
   Gemini agent (Vercel AI SDK) evaluates ingested posts → `AnalysisReport`
   (themes, tone, cadence, performance patterns).
3. **Content Generation (text)**
   Generate new post drafts from analysis insights → `Draft`.
4. **Image Generation**
   Text→image (Imagen) + reference-conditioned "content selfies"
   (Gemini 2.5 Flash Image from user-provided `ReferenceImage`s).
5. **Scheduler + Publishing**
   pg-boss driven scheduling per account with a **configurable autonomy mode**
   (approval / hybrid veto-window / fully autonomous), publishing via LinkedIn.
6. **External content sources (RSS)**
   Subscribe to RSS feeds (e.g. news portals) as an additional **content trigger**:
   new feed items flow into the generation pipeline (Sub-project 3) to auto-produce
   posts. Modeled as a `ContentSource` (kind: `rss`) with `FeedItem`s, so the generator
   treats analysis insights and external feeds as interchangeable inputs.
7. **Reports & Settings** *(cross-cutting, kept in the plan intentionally)*
   User-facing analytics/reports over posts and generated content, plus a settings
   surface (`AccountSettings`) that owns the autonomy mode, cadence, provider keys,
   feed subscriptions, and per-account preferences. Data model reserves space for these
   from the start.

**Build order:** 1 → 2 → 3/4 → 5 → 6/7. Sub-project 1 first because nothing can be
analyzed or generated until post data exists. RSS (6) plugs into the Sub-project 3
generation pipeline as an alternative input source.

## 3. Architecture (monorepo-wide)

```
apps/
  api/        Hono HTTP service — THE backend. Business logic + auth.
              Only place that touches the DB and LinkedIn tokens. Standalone deployable.
  web/        Next.js (App Router) — UI only. Server route handlers act as a thin
              BFF proxy to apps/api; browser tokens stay as httpOnly cookies.
  desktop/    Electron — thin client, talks to apps/api directly (token auth).
  worker/     Node service — 24/7 pg-boss job runner (scheduler, ingestion, generation).
packages/
  db/         Prisma schema + client (PostgreSQL).
  api-client/ Typed client for apps/api (Hono RPC) — shared by web + desktop.
  linkedin/   LinkedIn OAuth, API client, CSV import.
  ai/         Vercel AI SDK flows (Gemini text, Imagen + Gemini 2.5 Flash Image).
  core/       Shared domain types, config, utilities.
```

**Key technology decisions:**

- **DB:** PostgreSQL + **Prisma**.
- **API framework:** **Hono** (lightweight, standalone, strong TS DX, RPC for a typed client).
- **App auth:** **Better Auth** (lives in `apps/api`, issues session tokens usable by both
  web and desktop — deliberately not NextAuth, which is awkward for an Electron client).
- **Job queue / scheduler:** **pg-boss** (Postgres-based, no separate Redis infra).
- **AI framework:** **Vercel AI SDK**, provider-agnostic, defaulting to Gemini for text and
  Gemini 2.5 Flash Image + Imagen for images.

**Two auth layers:** (1) App login (Better Auth — the user of *our* app);
(2) LinkedIn OAuth (the connected LinkedIn account(s), stored as encrypted OAuth tokens).

## 4. Data model (multi-tenant; Sub-project 1 focus)

```
User                    (app login, managed by Better Auth)
  id, email, name, createdAt
  └─ has many LinkedInAccount

LinkedInAccount         (one connected LinkedIn account)
  id, userId → User
  memberUrn             (LinkedIn person URN, e.g. "urn:li:person:xxxx")
  displayName, avatarUrl
  accessToken           (AES-GCM encrypted at rest)
  refreshToken          (encrypted)
  tokenExpiresAt, scopes[]
  status                (active | expired | revoked)
  createdAt
  └─ has many Post

Post                    (one ingested / historical LinkedIn post)
  id, linkedinAccountId → LinkedInAccount
  source                (linkedin_api | csv_import)
  externalId            (LinkedIn post URN; unique per account; nullable)
  text
  mediaType             (none | image | video | article | ...)
  publishedAt
  metrics               (JSON: likes, comments, shares, impressions — if available)
  raw                   (JSON: full raw record for later analysis)
  createdAt, ingestedAt
```

**Design points:**

1. **Token encryption at rest:** OAuth tokens are never stored in plaintext — AES-GCM with
   a key from env (`ENCRYPTION_KEY`). `apps/api` is the only component that en/decrypts.
2. **`source` + nullable `externalId`:** supports both API import (with URN) and the CSV
   fallback (possibly without URN). Dedupe uses `(linkedinAccountId, externalId)`, or a
   hash of `(text, publishedAt)` for CSV rows lacking a URN.

**Reserved for later sub-projects** (not built in Sub-project 1, but the model leaves room):
`Draft` / `ScheduledPost`, `ReferenceImage` (user selfies), `AnalysisReport`,
`AccountSettings` (autonomy mode, cadence, preferences),
`ContentSource` + `FeedItem` (RSS feeds).

## 5. Sub-project 1 — detailed design

**Goal:** The user can log in, connect one or more LinkedIn accounts, and their existing
posts land in the DB as data — ready for later analysis. No AI, no scheduler, no images.

### Components & responsibilities

- `packages/db` — Prisma schema (User + Better Auth tables + LinkedInAccount + Post) + migrations.
- `apps/api` (Hono) — Better Auth (email/password), LinkedIn OAuth endpoints, ingestion
  endpoints, AES-GCM token crypto.
- `packages/linkedin` — three isolated units:
  - `OAuthClient` — build authorize URL (state + PKCE), exchange code→token, refresh token.
  - `ApiIngestor` — read posts via the Community Management API *(risky; see Spike)*.
  - `CsvIngestor` — parse `Shares.csv` from the LinkedIn data export (fallback).
  - Both ingestors satisfy one interface `PostIngestor { fetch(): Promise<RawPost[]> }`
    → interchangeable, independently testable.
- `apps/web` (Next.js) — minimal UI: login, "Connect LinkedIn" button, list of connected
  accounts, post list, CSV upload. All via BFF proxy to `apps/api`.
- `apps/worker` + `apps/desktop` — **scaffolded only** in this sub-project (empty run),
  no logic yet.

### Flow A — Connect LinkedIn (3-legged OAuth)

```
Web "Connect" → api /linkedin/connect → redirect to LinkedIn (scopes, state, PKCE)
→ user consents → LinkedIn → api /linkedin/callback?code&state
→ api exchanges code→token, fetches profile (name/avatar/URN)
→ stores LinkedInAccount (tokens encrypted) → back to web UI
```

### Flow B — Ingest posts (two paths, same target)

```
API path:  api /linkedin/accounts/:id/ingest → ApiIngestor → RawPost[] → dedupe-upsert → Post rows
CSV path:  Web upload Shares.csv → api /linkedin/accounts/:id/import → CsvIngestor → dedupe-upsert
```

### Error handling (the cases that matter)

- OAuth: state mismatch / denied consent / token-exchange failure → clear error, no half-created account.
- Token expired → refresh; if refresh fails → account `expired`, UI prompts reconnect.
- **API read not permitted (403 / unsupported)** → explicit path: "API read for personal posts
  unavailable → please import CSV" (no silent failure).
- CSV: malformed rows skipped and count reported.
- `ENCRYPTION_KEY` missing → `apps/api` refuses to boot (fail fast).

### Testing (TDD)

- Unit: encryption round-trip, CSV parser (fixtures), dedupe logic, OAuth state/PKCE
  (LinkedIn mocked), token refresh.
- Integration: api endpoints against a test Postgres with mocked LinkedIn HTTP.
- Ingestor interface tested against a fake ingestor.

### First spike (de-risking, at the very start of implementation)

With real credentials, verify whether the Community Management API returns the user's
**personal** post reads — *before* building the full `ApiIngestor`. The result decides
whether the API path or the CSV path is primary.

## 6. Key risks

- **LinkedIn API read scope** is the top risk (Community Management API is org-centric).
  Mitigated by the CSV data-export fallback and the up-front spike.
- **Content-selfie fidelity** (later sub-project) depends on Gemini 2.5 Flash Image
  reference conditioning — to be validated when that sub-project starts.
- **Autonomous publishing** (later) carries account-safety/ToS risk — mitigated by the
  configurable autonomy mode defaulting to human-in-the-loop.
