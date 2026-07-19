# Profile Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the profile interview/editor/fine-tuning with one agentic "Profile Studio" — streaming chat (AI leads) + a live canvas that IS the profile (chips + brand brief + example posts).

**Architecture:** Backend `streamText` agent with tools (`updateProfile`, `proposeConfirm`, `proposeOptions`, `writeExamplePost`); the AI is the single writer via `updateProfile` (server-authoritative). Frontend: full-height split (chat left, live canvas right) using `useChat` + AI Elements; the canvas mirrors tool inputs live. Mounted in the account Profile tab (`profile-workspace.tsx`).

**Tech Stack:** ai@7 (streamText, tool, convertToModelMessages, toUIMessageStreamResponse), @ai-sdk/react useChat, AI Elements, Hono, Prisma 7, zod 4, next-intl.

## Global Constraints
- The AI is the ONLY writer of profile fields — always via the `updateProfile` tool (persisted server-side). Proposals (`proposeConfirm`/`proposeOptions`) are UI-only (no-op execute); the user's ✓/✕/pick is sent back as a chat message, and the AI then calls `updateProfile` to commit.
- Mirror `updateProfile` and `writeExamplePost` tool inputs onto the canvas live (like the studio's updatePost→canvas mirroring), guarded by refs to avoid loops.
- Return a `Response` from the backend agent function (keep AI-SDK types out of the api package's inferred signature), as `studio-agent.ts` does.
- Conversation persists to the InterviewSession as UI messages (`setInterviewMessages`); profile fields persist via the `updateProfile` handler.
- i18n: every user-facing string via next-intl, en + de. No `<` / `{` in plain (non-rich) message strings (ICU).
- Keep it snappy: example posts text-only (no image gen); `updateProfile` patches are cheap.
- Per-account, 1:1 profile (unchanged). Reuse `linkedin-preview.tsx` look for example posts.

---

## Task 1: Backend — Profile Studio agent + tools

**Files:**
- Create: `packages/ai/src/profile-studio.ts`
- Modify: `packages/ai/src/index.ts` (exports)
- Modify: `apps/api/src/routes/profile.ts` (add `POST /:id/studio` route)

**Interfaces:**
- Produces: `streamProfileStudio(opts): Promise<Response>` where
  ```ts
  interface ProfilePatch {
    voice?: string; toneWords?: string[]; pillars?: string[]; audience?: string;
    positioning?: string; visualStyle?: string; noGos?: string[]; brandBrief?: string;
  }
  interface ProfileStudioHandlers { updateProfile(patch: ProfilePatch): Promise<void> | void; }
  interface StreamProfileStudioOptions {
    messages: UIMessage[]; current: ProfilePatch; insights?: string; language?: string;
    handlers: ProfileStudioHandlers; onFinish?: (m: UIMessage[]) => void; model?: LanguageModel;
  }
  ```
- Tools (zod inputSchema):
  - `updateProfile` — input `ProfilePatch` (all optional). execute: `await handlers.updateProfile(patch); return { ok: true }`. THE writer.
  - `proposeConfirm` — input `{ summary: string }`. execute: `return { ok: true }` (UI-only).
  - `proposeOptions` — input `{ question: string, options: string[], multi?: boolean }`. execute: `return { ok: true }` (UI-only).
  - `writeExamplePost` — input `{ text: string }`. execute: `return { ok: true }` (UI-only; canvas mirrors).
- System prompt: AI leads a warm, sharp profile-building conversation; per moment agentically choose the best interaction — a `proposeConfirm` claim, a `proposeOptions` set (2–4), or an open question — defaulting to guided over open. After the user accepts/picks (their reply arrives as a message), call `updateProfile` to commit the confirmed values and advance. Write/refresh the `brandBrief` via `updateProfile` once enough is known, and call `writeExamplePost` at milestones (or when asked) with a short LinkedIn post in their voice. Match the user's language (`language` param). Ground in `insights` (past-post analysis) if present. `current` shows what's already on the canvas — don't re-ask it.
- `stopWhen: stepCountIs(6)`; `toUIMessageStreamResponse({ originalMessages, onFinish })`.

- [ ] **Step 1: Write `profile-studio.ts`** — the `streamProfileStudio` function + tools + system prompt, mirroring `studio-agent.ts` structure. Export types.
- [ ] **Step 2: Export** from `packages/ai/src/index.ts`: `streamProfileStudio`, `type ProfilePatch`, `ProfileStudioHandlers`, `StreamProfileStudioOptions`.
- [ ] **Step 3: Add route** `POST /:id/studio` in `apps/api/src/routes/profile.ts`: requireProfile; parse `{messages, locale}`; build `current` from profile fields (map voice←voiceSummary? no — `voice` is a free field; use existing toneWords/pillars/audience/positioning/brandBrief and `visualStyle` from derived); `insights` from derived (reuse the studio's insights string); `handlers.updateProfile(patch)` maps patch→`updateProfileById` (whitelist: toneWords/pillars/audience/positioning/brandBrief/noGos + store `voice`/`visualStyle`? `voice` maps to toneWords or a note — keep `voice` folded into brandBrief or add to toneWords; `visualStyle` is part of derived — for studio store it into brandBrief or a profile field). Persist conversation via `setInterviewMessages` in `onFinish`. Return the Response.
  - NOTE for implementer: the profile has no `voice`/`visualStyle` column. Map `patch.voice` → prepend/merge into `toneWords` or brandBrief; `patch.visualStyle` → append to brandBrief as "Visual: …". Keep `updateProfileById` whitelist intact. Decide and document the mapping in the handler.
- [ ] **Step 4: Typecheck** `@outreach/ai` and `@outreach/api` (`tsc --noEmit`) — expect clean.
- [ ] **Step 5: Live E2E** (scratchpad tsx, real OpenAI): sign up, seed profile, POST `/studio` with a user message; assert 200 `text/event-stream`, text-deltas > 0, at least one tool event, and — after a confirming exchange — the profile fields changed in the DB. Print tool names called.

**Test criteria:** stream works; `updateProfile` persists; proposals stream as tool parts; conversation persisted.

---

## Task 2: Frontend — Profile Studio shell + agentic chat

**Files:**
- Create: `apps/web/src/app/(app)/profile/[id]/profile-studio.tsx` (the split shell + chat pane)
- Create/modify: i18n `messages/en.json` + `de.json` (studio strings)

**Interfaces:**
- Consumes: `useChat` from `@ai-sdk/react`, `DefaultChatTransport` from `ai`, AI Elements (Conversation/Message/PromptInput), the Task 1 route.
- Produces: `<ProfileStudio profileId embedded? onProfilePatch onExamplePost initialMessages current />` OR self-contained (fetches interview/start opener + current profile). Component owns `useChat({ transport: DefaultChatTransport({ api: `/api/profiles/:id/studio`, credentials:"include", body:{locale} }), messages: initial })`.
- Renders the chat left; exposes canvas updates to the parent via callbacks (or lifts canvas state to a shared parent — see Task 4). For this task: chat pane + a placeholder canvas on the right.
- Proposal rendering: scan `message.parts` for tool parts:
  - `tool-proposeConfirm` (input `{summary}`, state output-available) → render a card with the summary + **[das bin ich ✓]/[eher nicht ✕]**. ✓ → `sendMessage({text: t("...accept", {x:summary})})`; ✕ → `sendMessage({text: t("...reject", {x:summary})})`. Disable once the next assistant turn starts (track decided proposal ids).
  - `tool-proposeOptions` (input `{question, options, multi}`) → render option chips; on pick → `sendMessage({text: picked.join(", ")})`. Support multi.
  - `tool-updateProfile` / `tool-writeExamplePost` → not shown as chat cards (they drive the canvas); optionally a tiny "aktualisiert"/"Beispiel geschrieben" chip.
- Text parts → `MessageResponse` (markdown). PromptInput for free text. `PromptInputSubmit status`.

- [ ] **Step 1: Build the split shell** — full-height `flex h-full`: chat `<aside>` left (lg:w-[40%]), canvas region right (placeholder). Match the studio workspace's height handling.
- [ ] **Step 2: Wire `useChat`** with the transport (locale in body, credentials include). Load opener/initial via `POST /interview/start` (reuse; returns UI messages) OR a new `/studio/start` — reuse interview/start.
- [ ] **Step 3: Render messages** — text via MessageResponse; proposeConfirm/proposeOptions as interactive cards (accept/reject/pick → sendMessage). Track decided ids to disable stale proposals.
- [ ] **Step 4: i18n** en+de for all strings (accept/reject copy, "aktualisiert", placeholders, titles).
- [ ] **Step 5: Typecheck web** (`tsc --noEmit`) clean; compile-check the page loads 200.

**Test criteria:** chat streams; proposal cards render and their ✓/✕/pick send the right messages; typecheck + page-load clean.

---

## Task 3: Frontend — the live canvas (3 zones)

**Files:**
- Create: `apps/web/src/app/(app)/profile/[id]/profile-canvas.tsx`

**Interfaces:**
- Consumes: `current` profile state + live tool-input mirroring from Task 2's chat (`updateProfile` patches, `writeExamplePost` text). Author name/avatar from the account (for the example-post preview).
- Produces: `<ProfileCanvas profile examplePosts onEditField />`.
- Zone 1 — **Identity chips**: Voice/tone, pillars, audience, positioning, visual style, no-gos as compact chips/cards; the just-updated one briefly highlights (track last-changed key). Click a chip → inline edit (writes via `PATCH /api/profiles/:id`, existing endpoint) → but per Global Constraints the AI is the writer; inline edit is a manual override that PATCHes directly. Keep it, small.
- Zone 2 — **Brand brief**: prose (`profile.brandBrief`), styled readable; muted placeholder when empty.
- Zone 3 — **Example posts**: 1–2 posts via the `linkedin-preview.tsx` look (read-only variant), author = account.

- [ ] **Step 1: Build `ProfileCanvas`** with the three stacked, scrollable zones + empty states.
- [ ] **Step 2: Highlight-on-change** for chips (last-changed key ref + a brief ring/pulse).
- [ ] **Step 3: Example-post preview** reusing the LinkedIn preview styling (extract a read-only sub-view of `linkedin-preview.tsx` if needed).
- [ ] **Step 4: i18n** en+de for zone labels/empty states.
- [ ] **Step 5: Typecheck web** clean.

**Test criteria:** canvas renders all zones with live data; typecheck clean.

---

## Task 4: Integrate — replace interview/editor/fine-tune with the Studio; verify

**Files:**
- Modify: `apps/web/src/app/(app)/profile/[id]/profile-workspace.tsx`
- Modify: `apps/web/src/app/(app)/profile/[id]/profile-studio.tsx` + `profile-canvas.tsx` (lift shared canvas state into the studio shell; chat drives the canvas)
- Remove/retire: the old interview chat card, structured editor Card, FineTune card usages in the workspace editor state (keep the components/routes for now; just stop rendering them). Keep the "Analyze posts" affordance (feeds insights).

**Interfaces:**
- The Studio shell (`profile-studio.tsx`) owns the canvas profile state; the chat's tool mirroring updates it and passes it to `<ProfileCanvas>`. On `updateProfile` mirror → update local canvas profile; also the server persisted it, so a light refetch on turn finish reconciles.
- `profile-workspace.tsx`: when `state !== "loading"/"not-found"`, render `<ProfileStudio profileId embedded={embedded} />` full-height instead of the interview/editor/fine-tune stack. Drop the name-header/assignment/delete only as already handled by `embedded`. The Studio replaces both interview and editor states (one experience).

- [ ] **Step 1: Lift canvas state** into `profile-studio.tsx`; chat mirrors `updateProfile`/`writeExamplePost` → canvas; render `<ProfileCanvas>` on the right.
- [ ] **Step 2: Mount in workspace** — replace the interview + editor + FineTune rendering with `<ProfileStudio>`. Keep analyze wired (button feeds insights; or an in-chat "analyze" affordance). Keep account Profile tab + standalone route working.
- [ ] **Step 3: Refetch-on-finish** reconcile (like studio drafts) so canvas matches persisted profile.
- [ ] **Step 4: Typecheck all packages + web** clean; run ai/api tests.
- [ ] **Step 5: Live E2E + page loads** — the full flow: open profile tab → agent leads → confirm a few proposals → canvas fills → example post appears → profile persisted. All pages 200, no console errors.

**Test criteria:** the unified Profile Studio works end-to-end; profile persists; all green.
