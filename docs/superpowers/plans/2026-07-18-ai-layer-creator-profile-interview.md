# AI Layer + Creator Profile + AI Interview — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user can run an AI-conducted intake interview for a connected LinkedIn account and get a synthesized, editable **Creator Profile** (voice, goals, audience, pillars + a `brandBrief`), built entirely from the conversation and optionally enriched by post analysis.

**Architecture:** New provider-agnostic `packages/ai` (Vercel AI SDK, OpenAI default) is consumed only by `apps/api` (keys never reach clients). New DB models `CreatorProfile` + `InterviewSession`. New `apps/api` profile routes drive the interview and synthesis. A new `apps/web` Profile page hosts the chat + profile editor inside the existing shadcn app shell.

**Tech Stack:** pnpm + Turborepo, TypeScript ESM, Vercel AI SDK (`ai`, `@ai-sdk/openai`), Zod, Prisma/Postgres, Hono, Next.js 15, Vitest. This is Phase 2, sub-project 1 of the AI Studio spec (`docs/superpowers/specs/2026-07-18-ai-studio-creator-profile-design.md`).

## Global Constraints

- **ESM everywhere**, intra-package imports use explicit `.js` extensions, `verbatimModuleSyntax` on.
- **`packages/ai` is server-only** — consumed only by `apps/api`. No AI keys in web/desktop.
- **Provider-agnostic:** `AI_PROVIDER` (default `openai`) selects the provider; text via `@ai-sdk/openai` `openai(env.AI_TEXT_MODEL)`.
- **AI functions are model-injectable:** every AI function accepts an optional `model` param (default resolved from the provider) so tests inject a mock (`MockLanguageModelV2` from `ai/test`). **No live-LLM calls in the automated suite.**
- **Lazy AI-key validation:** the app must still boot for already-shipped features without `OPENAI_API_KEY`; the key is only required when an AI route runs. Do NOT add `OPENAI_API_KEY` to the fail-fast Zod required set — read it lazily.
- **Ownership:** every profile/interview route resolves the account via the authenticated user and 404s otherwise (as in Sub-project 1).
- **Test runner:** Vitest, colocated `*.test.ts`. Whole workspace stays green via `DATABASE_URL=... pnpm test`.
- **DB dev:** Postgres on `localhost:5544`; migrations via `pnpm --filter @outreach/db exec prisma migrate dev`.

---

## File Structure

**packages/ai** (new)
- `package.json`, `tsconfig.json`, `vitest.config.ts`
- `src/provider.ts` — `getTextModel(model?)` resolving `AI_PROVIDER`
- `src/interview.ts` — `INTERVIEW_SYSTEM`, `nextTurn(messages, opts?)`
- `src/profile.ts` — `PROFILE_SCHEMA`, `synthesizeProfile(messages, opts?)`
- `src/analyze.ts` — `DERIVED_SCHEMA`, `analyzePosts(posts, opts?)`
- `src/types.ts` — `ChatMessage`, `SynthesizedProfile`, `DerivedInsights`, `PostForAnalysis`
- `src/index.ts`

**packages/db**
- `prisma/schema.prisma` — add `CreatorProfile`, `InterviewSession` + migration

**apps/api**
- `src/env.ts` — add `AI_PROVIDER`, `AI_TEXT_MODEL` (OPENAI_API_KEY read lazily elsewhere)
- `src/repos/profile.ts` — profile + interview persistence
- `src/routes/profile.ts` — interview + profile routes
- `src/app.ts` — mount `/profile` under the auth guard

**apps/web**
- `src/app/(app)/profile/page.tsx` — interview chat + profile editor
- `src/lib/profile.ts` — shared client types
- `src/components/app-shell.tsx` — rename "Analysis" nav → "Profile" → `/profile`
- `messages/en.json`, `messages/de.json` — profile/interview copy

---

## Task 1: Scaffold `packages/ai` + provider resolution

**Files:**
- Create: `packages/ai/package.json`, `packages/ai/tsconfig.json`, `packages/ai/vitest.config.ts`, `packages/ai/src/types.ts`, `packages/ai/src/provider.ts`, `packages/ai/src/index.ts`
- Test: `packages/ai/src/provider.test.ts`

**Interfaces:**
- Produces:
  - `type ChatMessage = { role: "assistant" | "user"; content: string }`
  - `getTextModel(override?: string): LanguageModel` — resolves `AI_PROVIDER` (default `openai`) + `AI_TEXT_MODEL` (default `"gpt-4o"`).

- [ ] **Step 1: Create package files**

```json
// packages/ai/package.json
{
  "name": "@outreach/ai",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "build": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "lint": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "ai": "^5.0.0",
    "@ai-sdk/openai": "^2.0.0",
    "zod": "^3.24.0"
  },
  "devDependencies": { "@types/node": "^26.1.1", "typescript": "^5.7.0", "vitest": "^3.0.0" }
}
```

```json
// packages/ai/tsconfig.json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "noEmit": true }, "include": ["src"] }
```

```typescript
// packages/ai/vitest.config.ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node" } });
```

- [ ] **Step 2: Create `src/types.ts`**

```typescript
// packages/ai/src/types.ts
export interface ChatMessage {
  role: "assistant" | "user";
  content: string;
}

export interface PostForAnalysis {
  text: string;
  publishedAt: string;
  metrics?: { impressions?: number; reactions?: number; comments?: number } | null;
}

export interface DerivedInsights {
  voiceSummary: string;
  themes: string[];
  styleTraits: string[];
  cadence: string;
  topPatterns: string[];
}

export interface SynthesizedProfile {
  goals: string[];
  audience: string;
  pillars: string[];
  noGos: string[];
  toneWords: string[];
  languages: string[];
  positioning: string;
  brandBrief: string;
}
```

- [ ] **Step 3: Write the failing test**

```typescript
// packages/ai/src/provider.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getTextModel } from "./provider.js";

describe("getTextModel", () => {
  const prev = { ...process.env };
  beforeEach(() => { delete process.env.AI_PROVIDER; delete process.env.AI_TEXT_MODEL; process.env.OPENAI_API_KEY = "sk-test"; });
  afterEach(() => { process.env = { ...prev }; });

  it("defaults to an openai model with a modelId", () => {
    const m = getTextModel();
    expect(m.modelId).toBe("gpt-4o");
    expect(m.provider).toContain("openai");
  });

  it("honors AI_TEXT_MODEL and an explicit override", () => {
    process.env.AI_TEXT_MODEL = "gpt-4o-mini";
    expect(getTextModel().modelId).toBe("gpt-4o-mini");
    expect(getTextModel("gpt-4.1").modelId).toBe("gpt-4.1");
  });

  it("throws on an unknown provider", () => {
    process.env.AI_PROVIDER = "nope";
    expect(() => getTextModel()).toThrow(/unknown ai provider/i);
  });
});
```

- [ ] **Step 4: Run test — expect FAIL**

Run: `pnpm install && pnpm --filter @outreach/ai test`
Expected: FAIL (module not found).

- [ ] **Step 5: Implement `src/provider.ts`**

```typescript
// packages/ai/src/provider.ts
import { openai } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

export function getTextModel(override?: string): LanguageModel {
  const provider = process.env.AI_PROVIDER ?? "openai";
  const modelId = override ?? process.env.AI_TEXT_MODEL ?? "gpt-4o";
  switch (provider) {
    case "openai":
      return openai(modelId);
    default:
      throw new Error(`Unknown AI provider: ${provider}. Supported: openai.`);
  }
}
```

Note: `@ai-sdk/anthropic` / `@ai-sdk/google` cases are added when a second provider is actually wired — do not add unused imports now (YAGNI). The `default` throw keeps the switch honest.

- [ ] **Step 6: Create `src/index.ts`**

```typescript
// packages/ai/src/index.ts
export { getTextModel } from "./provider.js";
export type { ChatMessage, PostForAnalysis, DerivedInsights, SynthesizedProfile } from "./types.js";
```

- [ ] **Step 7: Run test — expect PASS**

Run: `pnpm --filter @outreach/ai test`
Expected: PASS (3 tests). Confirm the installed `ai`/`@ai-sdk/openai` majors match `modelId`/`provider` fields; if the SDK exposes these differently, adjust the test's field access and note it.

- [ ] **Step 8: Commit**

```bash
git add packages/ai
git commit -m "feat(ai): scaffold provider-agnostic AI layer (openai default)"
```

---

## Task 2: Intake interview turn (`packages/ai`)

**Files:**
- Create: `packages/ai/src/interview.ts`
- Test: `packages/ai/src/interview.test.ts`
- Modify: `packages/ai/src/index.ts`

**Interfaces:**
- Consumes: `ChatMessage`, `getTextModel`.
- Produces:
  - `INTERVIEW_SYSTEM: string`
  - `nextTurn(messages: ChatMessage[], opts?: { model?: LanguageModel; seed?: string }): Promise<string>` — returns the assistant's next message. `seed` (optional) is post-analysis context injected into the system prompt.

- [ ] **Step 1: Write the failing test (mock model)**

```typescript
// packages/ai/src/interview.test.ts
import { describe, it, expect, vi } from "vitest";
import { MockLanguageModelV2 } from "ai/test";
import { nextTurn, INTERVIEW_SYSTEM } from "./interview.js";

function mock(text: string) {
  return new MockLanguageModelV2({
    doGenerate: async () => ({
      finishReason: "stop",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      content: [{ type: "text", text }],
      warnings: [],
    }),
  });
}

describe("interview", () => {
  it("returns the assistant's next question", async () => {
    const out = await nextTurn(
      [{ role: "assistant", content: "Hi! What do you do?" }, { role: "user", content: "I'm a GRC founder." }],
      { model: mock("Great — who exactly are you trying to reach on LinkedIn?") },
    );
    expect(out).toMatch(/who exactly/i);
  });

  it("passes the interview system prompt and seed to the model", async () => {
    const spy = vi.fn(async () => ({
      finishReason: "stop" as const,
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      content: [{ type: "text" as const, text: "ok" }],
      warnings: [],
    }));
    const model = new MockLanguageModelV2({ doGenerate: spy });
    await nextTurn([{ role: "user", content: "hi" }], { model, seed: "They post about AI governance." });
    const call = spy.mock.calls[0]![0];
    const system = call.prompt.find((m: { role: string }) => m.role === "system");
    expect(JSON.stringify(system)).toContain("AI governance");
    expect(INTERVIEW_SYSTEM.length).toBeGreaterThan(200);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm --filter @outreach/ai test interview`
Expected: FAIL (module not found). If the `ai/test` `MockLanguageModelV2` import path or `doGenerate` shape differs in the installed SDK version, adjust to the installed API and note it in the report (this is the one place tied to SDK internals).

- [ ] **Step 3: Implement `src/interview.ts`**

```typescript
// packages/ai/src/interview.ts
import { generateText, type LanguageModel } from "ai";
import { getTextModel } from "./provider.js";
import type { ChatMessage } from "./types.js";

export const INTERVIEW_SYSTEM = `You are a senior brand strategist and copy chief at a top LinkedIn ghostwriting agency, running a client intake interview to learn a creator's voice and goals.

Rules:
- Ask ONE focused question at a time. Never dump a list of questions.
- Listen, then ask sharp adaptive follow-ups that dig into vague answers ("you said 'help companies' — which companies, and what transformation do you sell?").
- Over the conversation, cover: who they are and what they do; business and audience-growth goals; target audience; unique point of view / positioning; content pillars; voice and tone; topics or styles to avoid; creators they admire; typical calls to action.
- Be warm, sharp, and concise. Sound like a real strategist, not a form.
- When you have enough to write in their voice, say so and invite them to finish.
- Keep each message short (1-3 sentences). Output only your next message to the client.`;

export async function nextTurn(
  messages: ChatMessage[],
  opts?: { model?: LanguageModel; seed?: string },
): Promise<string> {
  const model = opts?.model ?? getTextModel();
  const system = opts?.seed
    ? `${INTERVIEW_SYSTEM}\n\nContext from the creator's existing posts (use it to confirm or challenge, do not read it back verbatim):\n${opts.seed}`
    : INTERVIEW_SYSTEM;
  const { text } = await generateText({
    model,
    system,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  });
  return text.trim();
}
```

- [ ] **Step 4: Export + run test — expect PASS**

Add to `src/index.ts`: `export { nextTurn, INTERVIEW_SYSTEM } from "./interview.js";`
Run: `pnpm --filter @outreach/ai test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ai
git commit -m "feat(ai): AI intake-interview turn handler"
```

---

## Task 3: Profile synthesis (`packages/ai`)

**Files:**
- Create: `packages/ai/src/profile.ts`
- Test: `packages/ai/src/profile.test.ts`
- Modify: `packages/ai/src/index.ts`

**Interfaces:**
- Produces:
  - `synthesizeProfile(messages: ChatMessage[], opts?: { model?: LanguageModel; derived?: DerivedInsights }): Promise<SynthesizedProfile>` — a `generateObject` pass over the transcript (+ derived) producing the structured profile + `brandBrief`.

- [ ] **Step 1: Write the failing test (mock object model)**

```typescript
// packages/ai/src/profile.test.ts
import { describe, it, expect } from "vitest";
import { MockLanguageModelV2 } from "ai/test";
import { synthesizeProfile } from "./profile.js";

const OBJECT = {
  goals: ["Thought leadership in AI governance"],
  audience: "GRC and compliance leaders at mid-market companies",
  pillars: ["AI governance", "Deterministic compliance", "Founder lessons"],
  noGos: ["Political hot takes"],
  toneWords: ["direct", "technical", "warm"],
  languages: ["de", "en"],
  positioning: "Engineering-driven GRC that replaces paperwork with determinism",
  brandBrief: "Write as Julian, a GRC founder...",
};

describe("synthesizeProfile", () => {
  it("returns the structured profile from the model object", async () => {
    const model = new MockLanguageModelV2({
      doGenerate: async () => ({
        finishReason: "stop",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        content: [{ type: "text", text: JSON.stringify(OBJECT) }],
        warnings: [],
      }),
    });
    const profile = await synthesizeProfile(
      [{ role: "user", content: "I run a GRC startup." }],
      { model },
    );
    expect(profile.pillars).toContain("AI governance");
    expect(profile.brandBrief).toMatch(/GRC founder/);
    expect(profile.languages).toEqual(["de", "en"]);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm --filter @outreach/ai test profile`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/profile.ts`**

```typescript
// packages/ai/src/profile.ts
import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import { getTextModel } from "./provider.js";
import type { ChatMessage, DerivedInsights, SynthesizedProfile } from "./types.js";

export const PROFILE_SCHEMA = z.object({
  goals: z.array(z.string()),
  audience: z.string(),
  pillars: z.array(z.string()),
  noGos: z.array(z.string()),
  toneWords: z.array(z.string()),
  languages: z.array(z.string()),
  positioning: z.string(),
  brandBrief: z.string().describe(
    "A system-prompt-grade brief a ghostwriter can use to write posts in this creator's voice: who they are, audience, goals, pillars, tone, do's and don'ts. 150-300 words, second person.",
  ),
});

export async function synthesizeProfile(
  messages: ChatMessage[],
  opts?: { model?: LanguageModel; derived?: DerivedInsights },
): Promise<SynthesizedProfile> {
  const model = opts?.model ?? getTextModel();
  const transcript = messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n");
  const derivedBlock = opts?.derived
    ? `\n\nObserved from their existing posts:\n${JSON.stringify(opts.derived, null, 2)}`
    : "";
  const { object } = await generateObject({
    model,
    schema: PROFILE_SCHEMA,
    system:
      "You are a brand strategist. From this intake interview, synthesize a precise creator profile and a brandBrief a ghostwriter will use to write in the creator's voice. Be specific and faithful to the interview; do not invent facts.",
    prompt: `Interview transcript:\n${transcript}${derivedBlock}`,
  });
  return object;
}
```

- [ ] **Step 4: Export + run test — expect PASS**

Add to `src/index.ts`: `export { synthesizeProfile, PROFILE_SCHEMA } from "./profile.js";`
Run: `pnpm --filter @outreach/ai test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ai
git commit -m "feat(ai): synthesize Creator Profile + brandBrief from interview"
```

---

## Task 4: Post analysis (`packages/ai`)

**Files:**
- Create: `packages/ai/src/analyze.ts`
- Test: `packages/ai/src/analyze.test.ts`
- Modify: `packages/ai/src/index.ts`

**Interfaces:**
- Produces:
  - `analyzePosts(posts: PostForAnalysis[], opts?: { model?: LanguageModel }): Promise<DerivedInsights>` — `generateObject` extracting voice/themes/patterns from the Post table.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/ai/src/analyze.test.ts
import { describe, it, expect } from "vitest";
import { MockLanguageModelV2 } from "ai/test";
import { analyzePosts } from "./analyze.js";

const DERIVED = {
  voiceSummary: "Direct, technical, opinionated.",
  themes: ["AI governance", "compliance"],
  styleTraits: ["short paragraphs", "contrarian hooks"],
  cadence: "~weekly",
  topPatterns: ["strong first-line hooks drive impressions"],
};

describe("analyzePosts", () => {
  it("returns derived insights", async () => {
    const model = new MockLanguageModelV2({
      doGenerate: async () => ({
        finishReason: "stop",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        content: [{ type: "text", text: JSON.stringify(DERIVED) }],
        warnings: [],
      }),
    });
    const d = await analyzePosts(
      [{ text: "Unpopular opinion: ...", publishedAt: "2025-06-09", metrics: { impressions: 5000, reactions: 40, comments: 3 } }],
      { model },
    );
    expect(d.themes).toContain("AI governance");
    expect(d.topPatterns.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm --filter @outreach/ai test analyze`
Expected: FAIL.

- [ ] **Step 3: Implement `src/analyze.ts`**

```typescript
// packages/ai/src/analyze.ts
import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import { getTextModel } from "./provider.js";
import type { DerivedInsights, PostForAnalysis } from "./types.js";

export const DERIVED_SCHEMA = z.object({
  voiceSummary: z.string(),
  themes: z.array(z.string()),
  styleTraits: z.array(z.string()),
  cadence: z.string(),
  topPatterns: z.array(z.string()).describe("What correlates with higher engagement, grounded in the metrics."),
});

export async function analyzePosts(
  posts: PostForAnalysis[],
  opts?: { model?: LanguageModel },
): Promise<DerivedInsights> {
  const model = opts?.model ?? getTextModel();
  const corpus = posts
    .map((p) => `[${p.publishedAt}] (impr ${p.metrics?.impressions ?? "?"}, react ${p.metrics?.reactions ?? "?"}) ${p.text}`)
    .join("\n---\n");
  const { object } = await generateObject({
    model,
    schema: DERIVED_SCHEMA,
    system:
      "You are a content analyst. Extract the creator's voice, recurring themes, style traits, posting cadence, and the patterns that correlate with higher engagement. Ground topPatterns in the provided metrics.",
    prompt: `Posts:\n${corpus}`,
  });
  return object;
}
```

- [ ] **Step 4: Export + run — expect PASS**

Add to `src/index.ts`: `export { analyzePosts, DERIVED_SCHEMA } from "./analyze.js";`
Run: `pnpm --filter @outreach/ai test`
Expected: PASS (all @outreach/ai tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ai
git commit -m "feat(ai): analyze posts into derived voice/theme/performance insights"
```

---

## Task 5: DB models — `CreatorProfile` + `InterviewSession`

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create migration
- Modify: `packages/db/src/index.ts` (export the new types)

**Interfaces:**
- Produces: `CreatorProfile`, `InterviewSession` Prisma models + types exported from `@outreach/db`.

- [ ] **Step 1: Add models to `schema.prisma`**

Add a `creatorProfile CreatorProfile?` and `interviews InterviewSession[]` relation field to `LinkedInAccount`, then:

```prisma
model CreatorProfile {
  id                String   @id @default(cuid())
  linkedinAccountId String   @unique
  status            String   @default("draft") // draft | ready
  goals             String[]
  audience          String   @default("")
  pillars           String[]
  noGos             String[]
  toneWords         String[]
  languages         String[]
  positioning       String   @default("")
  derived           Json?
  derivedAt         DateTime?
  brandBrief        String   @default("")
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  account           LinkedInAccount @relation(fields: [linkedinAccountId], references: [id], onDelete: Cascade)
}

model InterviewSession {
  id                String   @id @default(cuid())
  linkedinAccountId String
  status            String   @default("in_progress") // in_progress | complete
  messages          Json     @default("[]")
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  account           LinkedInAccount @relation(fields: [linkedinAccountId], references: [id], onDelete: Cascade)

  @@index([linkedinAccountId])
}
```

- [ ] **Step 2: Migrate**

Run: `DATABASE_URL="postgresql://outreach:outreach@localhost:5544/outreach" pnpm --filter @outreach/db exec prisma migrate dev --name creator_profile_interview`
Expected: migration created + applied, client regenerated.

- [ ] **Step 3: Export types**

Add to `packages/db/src/index.ts` type export list: `CreatorProfile, InterviewSession`.

- [ ] **Step 4: Verify build**

Run: `DATABASE_URL="postgresql://outreach:outreach@localhost:5544/outreach" pnpm --filter @outreach/db test`
Expected: existing db test still passes (models compile).

- [ ] **Step 5: Commit**

```bash
git add packages/db
git commit -m "feat(db): CreatorProfile + InterviewSession models"
```

---

## Task 6: API env additions

**Files:**
- Modify: `apps/api/src/env.ts`
- Modify: `.env.example`, `.env`

**Interfaces:**
- Produces: `env.AI_PROVIDER` (default `"openai"`), `env.AI_TEXT_MODEL` (default `"gpt-4o"`). `OPENAI_API_KEY` stays out of the required Zod set (read lazily by the AI SDK via `process.env`).

- [ ] **Step 1: Extend the Zod schema (non-fatal AI vars)**

```typescript
// add to the schema object in apps/api/src/env.ts
  AI_PROVIDER: z.string().default("openai"),
  AI_TEXT_MODEL: z.string().default("gpt-4o"),
```

Do NOT add `OPENAI_API_KEY` here (must not fail-fast). The `@ai-sdk/openai` provider reads `process.env.OPENAI_API_KEY` itself.

- [ ] **Step 2: Document env**

Append to `.env.example`:
```bash
AI_PROVIDER="openai"
AI_TEXT_MODEL="gpt-4o"
OPENAI_API_KEY=""   # required only when AI routes run
```
Ensure the real `.env` has `AI_PROVIDER`, `AI_TEXT_MODEL`, and the user's `OPENAI_API_KEY`.

- [ ] **Step 3: Verify boot**

Run: `pnpm --filter @outreach/api build` (no type errors). The running app must still boot without OPENAI_API_KEY.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/env.ts .env.example
git commit -m "feat(api): AI provider env (openai default, lazy key)"
```

---

## Task 7: Profile + interview repositories (`apps/api`)

**Files:**
- Create: `apps/api/src/repos/profile.ts`
- Test: `apps/api/src/repos/profile.test.ts`

**Interfaces:**
- Consumes: `prisma` (`@outreach/db`), `ChatMessage`, `SynthesizedProfile`, `DerivedInsights` (`@outreach/ai`).
- Produces:
  - `getOrCreateInterview(accountId): Promise<{ id; status; messages: ChatMessage[] }>`
  - `appendInterviewMessage(id, msg: ChatMessage): Promise<void>`
  - `completeInterview(id): Promise<void>`
  - `getProfile(accountId): Promise<CreatorProfileRow | null>`
  - `upsertProfile(accountId, data: Partial<SynthesizedProfile> & { status?: string; derived?: DerivedInsights; derivedAt?: Date }): Promise<CreatorProfileRow>`

- [ ] **Step 1: Write the failing integration test**

```typescript
// apps/api/src/repos/profile.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@outreach/db";
import { getOrCreateInterview, appendInterviewMessage, upsertProfile, getProfile } from "./profile.js";

let userId = "", accountId = "";
beforeAll(async () => {
  userId = `u_${Date.now()}`;
  await prisma.user.create({ data: { id: userId, email: `${userId}@ex.com` } });
  const a = await prisma.linkedInAccount.create({
    data: { userId, memberUrn: `urn:li:person:${Date.now()}`, displayName: "T", accessToken: "enc", scopes: [] },
  });
  accountId = a.id;
});
afterAll(async () => { await prisma.user.delete({ where: { id: userId } }); await prisma.$disconnect(); });

describe("profile repo", () => {
  it("creates + appends an interview", async () => {
    const iv = await getOrCreateInterview(accountId);
    expect(iv.messages).toEqual([]);
    await appendInterviewMessage(iv.id, { role: "assistant", content: "hi" });
    await appendInterviewMessage(iv.id, { role: "user", content: "hello" });
    const again = await getOrCreateInterview(accountId);
    expect(again.id).toBe(iv.id);
    expect(again.messages).toHaveLength(2);
  });

  it("upserts + reads a profile", async () => {
    await upsertProfile(accountId, { goals: ["g"], audience: "a", brandBrief: "b", status: "ready" });
    const p = await getProfile(accountId);
    expect(p?.status).toBe("ready");
    expect(p?.brandBrief).toBe("b");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @outreach/api test profile`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `repos/profile.ts`**

```typescript
// apps/api/src/repos/profile.ts
import { prisma } from "@outreach/db";
import type { ChatMessage, SynthesizedProfile, DerivedInsights } from "@outreach/ai";

export async function getOrCreateInterview(accountId: string) {
  const existing = await prisma.interviewSession.findFirst({
    where: { linkedinAccountId: accountId, status: "in_progress" },
    orderBy: { createdAt: "desc" },
  });
  const row = existing ?? (await prisma.interviewSession.create({ data: { linkedinAccountId: accountId } }));
  return { id: row.id, status: row.status, messages: (row.messages as ChatMessage[]) ?? [] };
}

export async function appendInterviewMessage(id: string, msg: ChatMessage): Promise<void> {
  const row = await prisma.interviewSession.findUniqueOrThrow({ where: { id } });
  const messages = [...((row.messages as ChatMessage[]) ?? []), msg];
  await prisma.interviewSession.update({ where: { id }, data: { messages } });
}

export async function completeInterview(id: string): Promise<void> {
  await prisma.interviewSession.update({ where: { id }, data: { status: "complete" } });
}

export async function getProfile(accountId: string) {
  return prisma.creatorProfile.findUnique({ where: { linkedinAccountId: accountId } });
}

export async function upsertProfile(
  accountId: string,
  data: Partial<SynthesizedProfile> & { status?: string; derived?: DerivedInsights; derivedAt?: Date },
) {
  const { derived, ...rest } = data;
  const payload = { ...rest, ...(derived ? { derived: derived as object } : {}) };
  return prisma.creatorProfile.upsert({
    where: { linkedinAccountId: accountId },
    create: { linkedinAccountId: accountId, ...payload },
    update: payload,
  });
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `docker compose up -d && pnpm --filter @outreach/api test profile`
Expected: PASS. If Prisma's `Json` typing rejects `messages`/`derived`, mirror the existing `metrics as object` cast pattern and note it.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/repos/profile.ts
git commit -m "feat(api): profile + interview repositories"
```

---

## Task 8: Profile routes (`apps/api`)

**Files:**
- Create: `apps/api/src/routes/profile.ts`
- Modify: `apps/api/src/app.ts` (mount under the auth guard)
- Test: `apps/api/src/routes/profile.test.ts`

**Interfaces:**
- Consumes: `@outreach/ai` (`nextTurn`, `synthesizeProfile`, `analyzePosts`), profile repo, `getDecryptedAccount`/`getAccountSummary` for ownership, `listPosts`.
- Produces routes (all under `/profile`, behind the `/profile/*` auth guard, account passed as `?accountId=` or path):
  - `GET  /profile/:accountId` → `{ profile }`
  - `POST /profile/:accountId/interview/start` → creates/opens session, if empty asks the model for an opener → `{ messages }`
  - `POST /profile/:accountId/interview/reply { message }` → append user msg, `nextTurn` (seeded with derived if present) → append assistant msg → `{ reply }`
  - `POST /profile/:accountId/interview/finalize` → `synthesizeProfile(transcript, derived?)` → `upsertProfile(status:"ready")` + `completeInterview` → `{ profile }`
  - `PATCH /profile/:accountId { ...fields }` → edit declared fields, re-save → `{ profile }`
  - `POST /profile/:accountId/analyze` → if posts exist, `analyzePosts(listPosts)` → store `derived` → `{ derived }`; if none → 409 `{ error: "no_posts" }`

Because AI functions are model-injectable, the route tests inject a mock model via a module-level seam. Implement the routes to accept an optional injected `aiOverrides` for tests (or export the AI calls behind a small local wrapper the test can `vi.mock`). Use `vi.mock("@outreach/ai", ...)` in the test.

- [ ] **Step 1: Write the failing test (AI mocked)**

```typescript
// apps/api/src/routes/profile.test.ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@outreach/ai", () => ({
  nextTurn: vi.fn(async () => "What's your unique point of view?"),
  synthesizeProfile: vi.fn(async () => ({
    goals: ["g"], audience: "a", pillars: ["p"], noGos: [], toneWords: ["direct"],
    languages: ["en"], positioning: "pos", brandBrief: "Write as...",
  })),
  analyzePosts: vi.fn(async () => ({ voiceSummary: "v", themes: ["t"], styleTraits: [], cadence: "weekly", topPatterns: ["x"] })),
}));

import { prisma } from "@outreach/db";
import { createApp } from "../app.js";

let userId = "", accountId = "", cookie = "";
const app = createApp();

async function authedCookie(): Promise<string> {
  const email = `p${Date.now()}@ex.com`;
  const res = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: process.env.WEB_ORIGIN! },
    body: JSON.stringify({ email, password: "password-1234", name: "P" }),
  });
  return res.headers.get("set-cookie")!.split(";")[0]!;
}

beforeAll(async () => {
  cookie = await authedCookie();
  // find the user Better Auth created, attach an account
  const u = await prisma.user.findFirstOrThrow({ orderBy: { createdAt: "desc" } });
  userId = u.id;
  const a = await prisma.linkedInAccount.create({
    data: { userId, memberUrn: `urn:li:person:${Date.now()}`, displayName: "T", accessToken: "enc", scopes: [] },
  });
  accountId = a.id;
});
afterAll(async () => { await prisma.user.delete({ where: { id: userId } }); await prisma.$disconnect(); });

describe("profile routes", () => {
  it("runs a reply turn and finalizes a profile", async () => {
    const reply = await app.request(`/profile/${accountId}/interview/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ message: "I'm a GRC founder." }),
    });
    expect(reply.status).toBe(200);
    expect((await reply.json()).reply).toMatch(/point of view/i);

    const fin = await app.request(`/profile/${accountId}/interview/finalize`, {
      method: "POST", headers: { Cookie: cookie },
    });
    expect(fin.status).toBe(200);
    expect((await fin.json()).profile.status).toBe("ready");
  });

  it("rejects a cross-user account", async () => {
    const other = await authedCookie();
    const res = await app.request(`/profile/${accountId}`, { headers: { Cookie: other } });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @outreach/api test routes/profile`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `routes/profile.ts`**

```typescript
// apps/api/src/routes/profile.ts
import { Hono } from "hono";
import { nextTurn, synthesizeProfile, analyzePosts } from "@outreach/ai";
import type { ChatMessage, DerivedInsights } from "@outreach/ai";
import type { AppEnv } from "../app.js";
import { getAccountSummary } from "../repos/linkedin-account.js";
import { listPosts } from "../repos/post.js";
import {
  getOrCreateInterview, appendInterviewMessage, completeInterview, getProfile, upsertProfile,
} from "../repos/profile.js";

export function profileRoutes() {
  const r = new Hono<AppEnv>();

  // ownership guard for every /:accountId route
  r.use("/:accountId/*", ownership);
  r.use("/:accountId", ownership);

  r.get("/:accountId", async (c) => c.json({ profile: await getProfile(c.req.param("accountId")) }));

  r.post("/:accountId/interview/start", async (c) => {
    const accountId = c.req.param("accountId");
    const iv = await getOrCreateInterview(accountId);
    if (iv.messages.length === 0) {
      const derived = (await getProfile(accountId))?.derived as DerivedInsights | undefined;
      const opener = await nextTurn([{ role: "user", content: "(start the interview)" }], { seed: derivedSeed(derived) });
      await appendInterviewMessage(iv.id, { role: "assistant", content: opener });
      return c.json({ messages: [{ role: "assistant", content: opener }] });
    }
    return c.json({ messages: iv.messages });
  });

  r.post("/:accountId/interview/reply", async (c) => {
    const accountId = c.req.param("accountId");
    const { message } = await c.req.json<{ message: string }>();
    const iv = await getOrCreateInterview(accountId);
    await appendInterviewMessage(iv.id, { role: "user", content: message });
    const derived = (await getProfile(accountId))?.derived as DerivedInsights | undefined;
    const reply = await nextTurn(
      [...iv.messages, { role: "user", content: message }],
      { seed: derivedSeed(derived) },
    );
    await appendInterviewMessage(iv.id, { role: "assistant", content: reply });
    return c.json({ reply });
  });

  r.post("/:accountId/interview/finalize", async (c) => {
    const accountId = c.req.param("accountId");
    const iv = await getOrCreateInterview(accountId);
    const derived = (await getProfile(accountId))?.derived as DerivedInsights | undefined;
    const synthesized = await synthesizeProfile(iv.messages as ChatMessage[], { derived });
    const profile = await upsertProfile(accountId, { ...synthesized, status: "ready" });
    await completeInterview(iv.id);
    return c.json({ profile });
  });

  r.patch("/:accountId", async (c) => {
    const accountId = c.req.param("accountId");
    const body = await c.req.json();
    const profile = await upsertProfile(accountId, body);
    return c.json({ profile });
  });

  r.post("/:accountId/analyze", async (c) => {
    const accountId = c.req.param("accountId");
    const posts = await listPosts(accountId);
    if (posts.length === 0) return c.json({ error: "no_posts" }, 409);
    const derived = await analyzePosts(
      posts.map((p) => ({
        text: p.text,
        publishedAt: p.publishedAt.toISOString(),
        metrics: p.metrics as { impressions?: number; reactions?: number; comments?: number } | null,
      })),
    );
    await upsertProfile(accountId, { derived, derivedAt: new Date() });
    return c.json({ derived });
  });

  return r;
}

async function ownership(c: Parameters<Parameters<Hono<AppEnv>["use"]>[1]>[0], next: () => Promise<void>) {
  const user = c.get("user")!;
  const acct = await getAccountSummary(c.req.param("accountId"), user.id);
  if (!acct) return c.json({ error: "not_found" }, 404);
  await next();
}

function derivedSeed(derived?: DerivedInsights): string | undefined {
  if (!derived) return undefined;
  return `Voice: ${derived.voiceSummary}. Themes: ${derived.themes.join(", ")}. What performs: ${derived.topPatterns.join("; ")}.`;
}
```

Note: if the `ownership` middleware typing is awkward with Hono's generics, inline the check at the top of each handler instead (the repo call is cheap) and drop the shared middleware — keep whichever the implementer finds cleaner and type-safe; document the choice.

- [ ] **Step 4: Mount in `app.ts`**

Add import `import { profileRoutes } from "./routes/profile.js";` and, alongside the existing `/linkedin/*` guard+mount, add a `/profile/*` guard (401 when no user) and `app.route("/profile", profileRoutes())`.

- [ ] **Step 5: Run — expect PASS**

Run: `docker compose up -d && pnpm --filter @outreach/api test`
Expected: PASS (existing + new profile route tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/profile.ts apps/api/src/app.ts
git commit -m "feat(api): interview + creator-profile routes"
```

---

## Task 9: Profile page — interview chat + editor (`apps/web`)

**Files:**
- Create: `apps/web/src/lib/profile.ts`, `apps/web/src/app/(app)/profile/page.tsx`
- Modify: `apps/web/src/components/app-shell.tsx` (rename "Analysis" → "Profile", enable it → `/profile`)
- Modify: `apps/web/messages/en.json`, `apps/web/messages/de.json`

**Interfaces:**
- Consumes the `/profile` API via the BFF proxy. Produces the Profile UI.

- [ ] **Step 1: Shared types**

```typescript
// apps/web/src/lib/profile.ts
export interface ChatMessage { role: "assistant" | "user"; content: string }
export interface CreatorProfile {
  status: string;
  goals: string[]; audience: string; pillars: string[]; noGos: string[];
  toneWords: string[]; languages: string[]; positioning: string; brandBrief: string;
  derived?: { voiceSummary: string; themes: string[]; styleTraits: string[]; cadence: string; topPatterns: string[] } | null;
}
```

- [ ] **Step 2: Enable the Profile nav item**

In `app-shell.tsx`, change the `analysis` nav entry to point at `/profile`, drop its `soon: true`, and (optionally) rename the icon to `Sparkles`. Keep the i18n key `nav.analysis` but set its label to "Profile" in messages (Step 5), or add a `nav.profile` key and use it. Choose one and be consistent.

- [ ] **Step 3: Build the Profile page**

Requirements (shadcn components, matching the app shell):
- On mount: pick the account. For now, resolve the **first** connected account (`GET /api/linkedin/accounts` → `accounts[0]`); if none, show an empty state linking to `/accounts`. (Multi-account selection is a later refinement.)
- Fetch `GET /api/profile/:accountId`. If `profile?.status === "ready"`, show the **profile view** (editable fields + brandBrief + a "Re-run interview" button). Otherwise show the **interview**.
- Interview: `POST /api/profile/:accountId/interview/start` → render `messages`; a chat transcript (assistant left, user right), a text input + send (`.../interview/reply`), appending both turns; a "Finish & build my profile" button (`.../interview/finalize`) → on success switch to the profile view.
- Profile view: render goals/audience/pillars/noGos/toneWords/languages/positioning as editable inputs, and `brandBrief` as a textarea; a "Save" button (`PATCH /api/profile/:accountId`). If the account has posts, show an "Analyze my posts" button (`.../analyze`); on 409 `no_posts`, show a hint to import a CSV.

Use `Card`, `Button`, `Input`, `Textarea` (add the shadcn `Textarea` primitive if not present — a trivial wrapper around `<textarea>` styled like `Input`), and `Skeleton` for loading. Keep all copy in i18n. Guard on 401 → `router.push("/login")`.

```tsx
// apps/web/src/components/ui/textarea.tsx  (add if missing)
import * as React from "react";
import { cn } from "@/lib/utils";
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 flex min-h-24 w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px] disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
export { Textarea };
```

Implement the page as a client component following the interfaces above; keep it cohesive with the existing `(app)/accounts` pages (same spacing, `max-w-*`, Card usage). This step's deliverable is a working Profile page; write it in the plan's style but the exact JSX is the implementer's, mirroring the accounts pages.

- [ ] **Step 4: i18n**

Add a `profile` message group to `en.json` and `de.json`: page title/subtitle, `interviewTitle`, `send`, `finish`, `finishing`, `profileReady`, field labels (goals/audience/pillars/noGos/toneWords/languages/positioning/brandBrief), `save`, `saved`, `analyze`, `analyzing`, `analyzeNoPosts`, `rerun`, `emptyNoAccount`, `thinking`. Provide English + German values.

- [ ] **Step 5: Verify (dev server, no `next build` while dev runs)**

Run `pnpm --filter @outreach/web dev` (or reuse the running one); hit `/profile`; confirm 200 and no compile errors in the log. Manual smoke (with a real `OPENAI_API_KEY` in `.env` and the API restarted): open `/profile`, answer a couple of interview turns, click Finish, see a synthesized profile.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): Creator Profile page — AI interview chat + editor"
```

---

## Self-Review

**Spec coverage (Phase-2 sub-project 1):**
- `packages/ai` provider-agnostic layer (OpenAI default, swappable, model-injectable) → Tasks 1-4. ✅
- AI intake interview (adaptive, agency-style) → Tasks 2, 8, 9. ✅
- Profile synthesis → `brandBrief` → Task 3, 8. ✅
- Post-analysis enrichment, graceful no-posts → Tasks 4, 8 (`no_posts` 409), 9 (hint). ✅
- Data model `CreatorProfile` + `InterviewSession` → Task 5. ✅
- Server-only keys, lazy validation → Tasks 1, 6. ✅
- Editable profile + Profile page → Tasks 8 (PATCH), 9. ✅
- **Studio/Composer + `Draft`** → deliberately NOT here; this is Phase-2 sub-project 2 (separate plan).

**Placeholder scan:** No TBDs. Task 9's JSX is intentionally specified by interface + requirements (mirroring existing accounts pages) rather than transcribed line-for-line — the deliverable and every endpoint/shape it calls are concrete.

**Type consistency:** `ChatMessage`, `SynthesizedProfile`, `DerivedInsights` defined in `@outreach/ai` and reused by repo, routes, and web. `getTextModel`, `nextTurn`, `synthesizeProfile`, `analyzePosts` signatures match across tasks. Profile fields match the Prisma model (Task 5) and the synthesis schema (Task 3).

---

## Deviations / notes for the implementer

- **AI SDK version reality:** `MockLanguageModelV2` / `doGenerate` content shapes and the `openai(modelId)` return fields (`modelId`, `provider`) are the only SDK-internal touchpoints. Confirm them against the installed `ai@^5` / `@ai-sdk/openai@^2` and adjust the tests' field access if needed — document any change. Everything else uses the stable `generateText` / `generateObject` surface.
- **Single-account assumption** in the Profile page (first account) is a known simplification; multi-account selection is a later refinement.
- **Studio (composer, Draft, image generation)** is the next plan; this plan stops at a synthesized, editable Creator Profile.
