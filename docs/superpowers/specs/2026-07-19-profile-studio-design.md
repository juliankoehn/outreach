# Profile Studio — agentic chat + live canvas (Design)

**Goal:** Replace the profile interview/editor/fine-tuning with one continuous, agentic "Profile Studio": a streaming chat where the AI leads, and a live canvas that IS the profile (builds, shows the brand brief, and previews example posts as it sharpens).

**Where it lives:** the account's Profile tab (`/accounts/[id]/profile`) — profiles are per-account. Replaces the current interview + structured editor + fine-tune cards in `profile-workspace.tsx`.

## Layout
Full-height split, like the studio draft workspace: **chat left (~40%)**, **canvas right (~60%)**. Responsive: stacks on mobile (canvas above, chat below, or a toggle). One experience — no interview→editor phase switch. New profile → AI leads to fill it; existing profile → AI refines it.

## Chat (left) — agentic, AI-led
- Streaming (`useChat` + `DefaultChatTransport` + AI Elements Conversation/Message/PromptInput), like the studio chat.
- The AI **leads** and, per moment, **agentically chooses the best interaction** (system prompt instructs it to weigh this and default to guided over open):
  - **Confirm** — a concrete claim with **[das bin ich ✓] / [eher nicht ✕]** ("Ton: direkt, kein Bullshit — richtig?").
  - **Options** — 2–4 tappable suggestions to pick from ("Welcher Winkel? [Debunking] [Lektionen] [Hot takes]"), single or multi-select, when several directions are plausible.
  - **Open** — a free-text question, only when it genuinely needs to hear from them.
- Free text is always available. Accept → the AI commits it to the profile (canvas updates live) and advances. Reject → it becomes a no-go and the AI offers an alternative.

## Canvas (right) — live, three stacked zones
1. **Identity chips**: Voice/tone · pillars · audience · positioning · visual style · no-gos. Fill in live; the just-changed chip briefly highlights. A subtle readiness cue. Chips are click-to-edit inline (this replaces the old field editor).
2. **Brand brief**: the ghostwriter prose brief, built up / rewritten as things solidify.
3. **Example posts**: 1–2 real LinkedIn-styled previews (reuse `linkedin-preview.tsx` look) "in your voice", regenerated at meaningful milestones (not every keystroke — cost/latency). Text-only here; real image generation stays in the Studio.

## Agentic mechanism — tools the AI calls (mirrors studio `updatePost`)
Backend `POST /profiles/:id/studio/agent` runs `streamText` with `toUIMessageStreamResponse`, tools:
- `updateProfile(patch)` — patches profile fields (voice/toneWords/pillars/audience/positioning/visualStyle/noGos/brandBrief); persists + the canvas reflects it live from the tool's streamed input.
- `proposeConfirm({ summary, patch })` — renders a ✓/✕ proposal card in the chat. On ✓ the patch is applied (via updateProfile semantics) and the AI is told "confirmed"; on ✕ it's dropped into no-gos and the AI told "rejected".
- `proposeOptions({ question, options[], multi })` — renders selectable chips. The user's pick(s) are sent back; the AI commits the chosen values via updateProfile.
- `writeExamplePost({ text })` — sets/refreshes an example post on the canvas.

Client mirrors tool inputs/outputs onto the canvas live (like the studio's updatePost→canvas mirroring). The conversation persists to the InterviewSession (UI messages), and the profile fields persist via the tool handlers.

## What it replaces / consolidates
- Interview (streaming version just built), structured field editor, and the fine-tune "that's me / that's not" cards all merge into this one studio. The fine-tune accept/reject principle becomes the chat's native `proposeConfirm`/`proposeOptions`.
- "Analyze posts" stays a button that feeds the canvas + lets the AI propose from what it found. "Refine from analysis" becomes AI proposals in the chat.
- The standalone `/profile/[id]` route keeps rendering the same studio (non-embedded) for direct links.

## Non-goals (for this iteration)
- Image generation for example posts (Studio only).
- Publishing/scheduling.
- Multi-profile per account (still 1:1).

## Open implementation notes
- Reuse: AI Elements chat components, `linkedin-preview.tsx`, existing profile fields + `synthesizeProfile`/`analyzePosts`/`suggestFacets` where useful.
- Example-post regeneration cadence: AI-decided milestones + on explicit "zeig mir ein Beispiel".
- Keep responses snappy: example posts text-only; `updateProfile` patches are cheap.
