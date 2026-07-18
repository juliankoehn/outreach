# AI Studio — Creator Profile, AI Interview & Composer — Design

**Date:** 2026-07-18
**Status:** Approved (design), ready for planning
**Builds on:** Sub-project 1 (Foundation + LinkedIn connect + ingestion) + analytics/caching, both shipped.

## 1. Vision

Turn the platform from "connect + view metrics" into an AI content studio that
knows the creator and writes in their voice. Two new pillars:

- A **Creator Profile** — the platform's memory of *who the creator is* (voice,
  goals, audience, content pillars, positioning), built primarily through an
  **AI-conducted intake interview** (like a marketing agency), and enriched by
  analysis of the creator's existing posts when available.
- A **Studio / Composer** — where the AI drafts posts (text + image) in the
  creator's voice, using the Creator Profile, and the user edits and **saves
  them as drafts**.

The through-line: *continue the creator's own interests and voice* — never
generic AI content. The Creator Profile's `brandBrief` is the shared context
every generation call uses.

## 2. Scope

**In this phase:**
- `packages/ai` — provider-agnostic AI layer (Vercel AI SDK), OpenAI default, swappable.
- **AI intake interview** — adaptive, multi-turn, agency-style; synthesizes the Creator Profile.
- **Creator Profile** — data model, interview-driven creation, optional post-analysis
  enrichment, editable, `brandBrief` synthesis.
- **Studio / Composer** — AI text draft (from `brandBrief`) + AI image generation →
  **save as Draft**. No publishing yet.

**Explicitly deferred (later phases):**
- Publishing to LinkedIn (`w_member_social` write, LinkedIn Images API upload).
- Scheduler + autonomy modes (pg-boss worker).
- RSS content sources.
- Reference-image "selfies" (face-consistent image personalization).

## 3. Architecture additions

```
packages/ai/          NEW — provider-agnostic AI (Vercel AI SDK)
  src/provider.ts     model registry: AI_PROVIDER = openai | anthropic | google
  src/interview.ts    the intake-interview agent (system prompt + turn handling)
  src/profile.ts      synthesize CreatorProfile + brandBrief (generateObject)
  src/analyze.ts      analyze the Post table → derived voice/themes/patterns
  src/compose.ts      draftPost(brandBrief, topic?) + generateImage(prompt)
  src/index.ts
```

- **Server-only.** `packages/ai` is consumed exclusively by `apps/api`. API keys
  never reach the web/desktop clients. All AI calls go through `apps/api` routes.
- **Provider abstraction:** `getTextModel()` / `getImageModel()` resolve from
  `AI_PROVIDER` (default `openai`). Vercel AI SDK's provider packages
  (`@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`) are swappable behind
  this. Text uses `generateText` / `generateObject` (structured output); images
  use the provider image model (OpenAI `gpt-image-1` to start).
- **New env (apps/api):** `AI_PROVIDER` (default `openai`), `OPENAI_API_KEY`,
  `AI_TEXT_MODEL` (default a current OpenAI text model), `AI_IMAGE_MODEL`
  (default `gpt-image-1`). Optional `ANTHROPIC_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY`
  for switching. Env validation stays fail-fast, but AI keys are validated
  lazily (only required when an AI route is called) so the app still boots
  without them for the already-shipped features.

## 4. Data model

```
CreatorProfile               (1:1 per LinkedInAccount)
  id, linkedinAccountId → LinkedInAccount (unique)
  status                     (draft | ready)   // ready once an interview is synthesized
  -- declared (from the interview / editable) --
  goals            String[]  // e.g. "thought leadership in AI governance"
  audience         String    // who they're writing for
  pillars          String[]  // content pillars / recurring themes to pursue
  noGos            String[]  // topics/styles to avoid
  toneWords        String[]  // voice descriptors
  languages        String[]  // e.g. ["de","en"]
  positioning      String    // unique POV / one-line positioning
  -- derived (from post analysis; nullable when no posts) --
  derived          Json?     // { voiceSummary, themes[], styleTraits[], cadence, topPatterns[] }
  derivedAt        DateTime?
  -- synthesized --
  brandBrief       String    // the system-prompt-grade brief used by all generation
  createdAt, updatedAt

InterviewSession             (the AI intake conversation)
  id, linkedinAccountId → LinkedInAccount
  status                     (in_progress | complete)
  messages         Json      // [{ role: "assistant"|"user", content }]
  createdAt, updatedAt

Draft                        (a composed post, saved not published)
  id, linkedinAccountId → LinkedInAccount
  text             String
  imageUrl         String?   // stored generated image (see §7)
  imagePrompt      String?
  status           String @default("draft")   // draft (published/scheduled reserved for later)
  source           String @default("ai")      // ai | manual
  createdAt, updatedAt
```

All three are scoped to a `LinkedInAccount` and, transitively, the owning `User`.
Every route enforces ownership (as in Sub-project 1).

## 5. The AI intake interview (the star)

A multi-turn, adaptive conversation where the model plays an expert brand
strategist / copy-chief running a client intake — not a fixed questionnaire.

**Behavior:**
- System prompt casts the model as a senior brand strategist for LinkedIn personal
  brands. It asks **one focused question at a time**, listens, and **asks adaptive
  follow-ups** that dig into vague answers ("you said 'help companies' — which
  companies, and what's the transformation you sell?").
- It covers, over the conversation: who the person is and what they do, business &
  audience-growth goals, target audience, unique POV/positioning, content pillars,
  voice/tone, no-gos, admired examples, and typical CTAs.
- It knows when it has enough and offers to wrap up (or the user ends it).
- If the account has posts, the interview is **seeded** with post-analysis insights
  so the model can confirm/challenge observed themes ("your posts lean into X — keep
  it as a pillar?"). With no posts, it runs purely on the conversation.

**Mechanics:**
- `POST /profile/interview` starts (or resumes) an `InterviewSession`; returns the
  assistant's opening message.
- `POST /profile/interview/reply { message }` appends the user turn, calls the model
  with the full transcript + strategist system prompt, returns the next assistant turn.
- `POST /profile/interview/finalize` runs a **synthesis** pass (`generateObject`) over
  the transcript (+ derived post analysis if present) → structured `CreatorProfile`
  fields + `brandBrief`; marks the profile `ready`.
- The transcript is persisted so the interview can be paused/resumed.

**Frontend:** a chat UI on the **Profile page** (lighting up the "Analysis" nav slot,
renamed to "Profile"): message stream, single input, a "Finish & build my profile"
action, then the editable profile view.

## 6. Creator Profile derivation & editing

- **Interview-first:** the profile is created from the interview synthesis. This works
  with zero posts.
- **Post-analysis enrichment (optional, graceful):** when the account has posts,
  `analyze.ts` runs an AI pass over the Post table (text + per-post metrics) to extract
  `voiceSummary`, `themes`, `styleTraits`, `cadence`, `topPatterns` (what performs).
  Stored in `derived`. The "Analyze my posts" action is only offered/enabled when
  posts exist; otherwise the UI shows a hint to import a CSV first (never an error).
- **Editable:** all declared fields and the `brandBrief` are user-editable. A
  "re-synthesize" action regenerates the `brandBrief` from current fields + derived data.
- **`brandBrief`** is the single artifact the composer consumes.

## 7. Studio / Composer

A new **Studio** page (new nav item) for composing posts.

- **Draft text:** "Generate" (optionally with a topic/angle input) → `compose.draftPost`
  calls the text model with the `brandBrief` as system context → a post draft in the
  creator's voice. Editable in a textarea. Regenerate / variations supported.
- **Generate image:** "Generate image" with a prompt (prefilled from the post) →
  `compose.generateImage` → an image. This round is **text-to-image** only (reference
  "selfies" deferred). The generated image is stored (see below) and previewed.
- **Save:** "Save draft" persists a `Draft` (text + image reference). **No publishing
  this round** — a Drafts list shows saved drafts; publish/schedule arrive in a later phase.
- **Image storage:** generated images are returned as binary/base64 from the provider.
  Store them under a local uploads dir served by `apps/api` (e.g. `apps/api` static
  `/uploads/<id>.png`) and keep the URL on the Draft. (Object storage is a later
  concern; local disk is fine for dev/single-node.)
- **Requires a ready profile:** the Studio prompts the user to complete the interview
  first if no `brandBrief` exists.

## 8. UI surfaces (within the existing shadcn app shell)

- **Profile** (nav, replaces the "Analysis" placeholder): the AI interview chat →
  editable Creator Profile (declared fields + derived insights + brandBrief).
- **Studio** (new nav item): composer (generate text + image, save draft) + a
  drafts list.
- Both live inside the `(app)` shell; both are gated on an active LinkedIn account.

## 9. Testing

- `packages/ai`: unit-test the pure pieces — provider resolution from `AI_PROVIDER`,
  prompt/brief assembly, interview transcript handling, and the synthesis
  output shape — with the model layer mocked (inject the AI SDK model, no live calls).
- `apps/api`: route tests with the AI layer mocked (interview turn, finalize →
  profile persisted, compose → draft persisted). Ownership checks tested.
- No live-LLM calls in the automated suite. A manual smoke (with a real
  `OPENAI_API_KEY`) verifies an end-to-end interview + a generated draft.

## 10. Build order (for the plan)

1. **`packages/ai`** — provider layer + typed functions (mockable).
2. **Creator Profile + AI interview** — data model, interview routes, synthesis,
   profile page (chat + editor), optional post-analysis enrichment.
3. **Studio / Composer** — Draft model, compose routes (text + image), image
   storage, composer + drafts UI.

Each is a reviewable slice; the plan may be split accordingly.

## 11. Risks

- **AI output quality** is the core product risk — mitigated by a strong strategist
  system prompt, the `brandBrief` as consistent context, and human editing everywhere
  (nothing is auto-published).
- **Provider swappability**: image APIs differ more than text across providers;
  the `getImageModel()` abstraction starts OpenAI-only and grows as needed — documented,
  not silently assumed portable.
- **Cost/latency** of interviews and generation — acceptable for interactive,
  human-in-the-loop use; no batch fan-out this phase.
- **Local image storage** is a dev-grade choice; object storage is a known later step.
