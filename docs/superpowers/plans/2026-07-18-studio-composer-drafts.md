# Studio — Composer + Drafts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user can, for a connected account with a ready Creator Profile, generate a LinkedIn post draft in their voice (from the `brandBrief` + an optional topic), generate an image for it, and **save it as a Draft**. Publishing/scheduling are a later phase.

**Architecture:** Extends `packages/ai` with a composer (`draftPost` text + `generateImage`). New `Draft` DB model. `apps/api` gets compose/draft routes + local image storage served at `/uploads`. `apps/web` gets a Studio page (composer + drafts list) inside the app shell, with an image proxy so `<img>` loads through the web origin.

**Tech Stack:** Vercel AI SDK (`ai` `experimental_generateImage`, `@ai-sdk/openai` `openai.image`), Prisma/Postgres, Hono + `@hono/node-server` static serving, Next.js 15 + shadcn, Vitest. Phase-2 sub-project 2 (spec `docs/superpowers/specs/2026-07-18-ai-studio-creator-profile-design.md`). Builds on Plan 1 (AI layer + Creator Profile).

## Global Constraints

- ESM everywhere, `.js` extensions, verbatimModuleSyntax. `packages/ai` server-only.
- AI functions are **model-injectable** (optional `model` param) for tests; images use an injectable **image model**. No live-LLM calls in the automated suite (`ai/test` mocks).
- **Image generation is OpenAI-only this phase** — `getImageModel()` resolves `openai.image(env.AI_IMAGE_MODEL)` (default `gpt-image-1`); non-openai providers throw (documented, not silently portable).
- Lazy AI-key validation (already established in Plan 1) — app boots without `OPENAI_API_KEY`.
- Ownership enforced on every `/:accountId` / draft route via the authed user (as in Sub-project 1).
- **No publishing** — `Draft.status` stays `"draft"`; publish/scheduled are reserved enum values only.
- Test runner Vitest; whole workspace stays green (`DATABASE_URL=... pnpm test`). DB dev on `localhost:5544`.
- Web dev server is long-running; **never run `next build` while it runs** — validate via curl + dev compile / standalone `tsc --noEmit`.

---

## File Structure

**packages/ai**
- `src/compose.ts` — `draftPost(brandBrief, opts?)`, `generateImage(prompt, opts?)`, `getImageModel()`
- `src/compose.test.ts`
- `src/index.ts` — add exports

**packages/db**
- `prisma/schema.prisma` — add `Draft` + relation + migration

**apps/api**
- `src/env.ts` — add `AI_IMAGE_MODEL` (default `gpt-image-1`)
- `src/images.ts` — save bytes to `uploads/` + resolve path
- `src/repos/draft.ts` — draft persistence
- `src/routes/studio.ts` — compose text/image + draft CRUD
- `src/app.ts` — mount `/studio` (guarded) + a public `GET /uploads/*` static route
- `src/repos/draft.test.ts`, `src/routes/studio.test.ts`

**apps/web**
- `src/app/uploads/[...file]/route.ts` — proxy `/uploads/*` → API
- `src/app/(app)/studio/page.tsx` — composer + drafts
- `src/lib/studio.ts` — client types
- `src/components/app-shell.tsx` — enable "Content" nav → `/studio` (label "Studio")
- `messages/en.json`, `messages/de.json` — studio copy
- `src/components/ui/textarea.tsx` already exists (Plan 1)

---

## Task 1: Composer — `draftPost` + `generateImage` (`packages/ai`)

**Files:**
- Create: `packages/ai/src/compose.ts`
- Test: `packages/ai/src/compose.test.ts`
- Modify: `packages/ai/src/index.ts`

**Interfaces:**
- Produces:
  - `draftPost(brandBrief: string, opts?: { topic?: string; model?: LanguageModel }): Promise<string>` — a LinkedIn post in the creator's voice, via `generateText` (system = the brandBrief + LinkedIn-post instructions).
  - `getImageModel(): ImageModel` — resolves `AI_PROVIDER` (openai only) → `openai.image(AI_IMAGE_MODEL ?? "gpt-image-1")`.
  - `generateImage(prompt: string, opts?: { model?: ImageModel }): Promise<{ base64: string; mediaType: string }>` — via `experimental_generateImage`.

- [ ] **Step 1: Write the failing test (mocked models)**

```typescript
// packages/ai/src/compose.test.ts
import { describe, it, expect, vi } from "vitest";
import { MockLanguageModelV2 } from "ai/test";
import { draftPost, generateImage } from "./compose.js";

function textMock(text: string) {
  return new MockLanguageModelV2({
    doGenerate: async () => ({
      finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      content: [{ type: "text", text }], warnings: [],
    }),
  });
}

describe("compose", () => {
  it("drafts a post using the brandBrief as system context", async () => {
    const spy = vi.fn(async () => ({
      finishReason: "stop" as const, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      content: [{ type: "text" as const, text: "Here's a hook...\n\nBody." }], warnings: [],
    }));
    const model = new MockLanguageModelV2({ doGenerate: spy });
    const out = await draftPost("Write as Julian, a GRC founder.", { topic: "AI governance", model });
    expect(out).toMatch(/hook/i);
    const sys = spy.mock.calls[0]![0].prompt.find((m: { role: string }) => m.role === "system");
    expect(JSON.stringify(sys)).toContain("GRC founder");
    expect(JSON.stringify(spy.mock.calls[0]![0].prompt)).toContain("AI governance");
  });

  it("generates an image and returns base64 + mediaType", async () => {
    // inject a mock image model matching the ai SDK ImageModelV2 doGenerate shape
    const imageModel = {
      specificationVersion: "v2",
      provider: "mock",
      modelId: "mock-image",
      maxImagesPerCall: 1,
      doGenerate: async () => ({
        images: [{ base64: "aGVsbG8=", mediaType: "image/png" }],
        warnings: [], response: { timestamp: new Date(0), modelId: "mock-image", headers: {} },
      }),
    } as unknown as import("ai").ImageModel;
    const img = await generateImage("a minimalist poster", { model: imageModel });
    expect(img.base64).toBe("aGVsbG8=");
    expect(img.mediaType).toMatch(/image\//);
  });
});
```

Note: the exact `ImageModelV2` `doGenerate` return shape (`images[].base64` vs `.uint8Array`, `mediaType` field name) is an SDK-internal detail — VERIFY against installed `ai@5` and `@ai-sdk/openai@2`, adjust the mock + the extraction in `generateImage` to match, and document. Everything else uses the stable `generateText` / `experimental_generateImage` surface.

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @outreach/ai test compose`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/compose.ts`**

```typescript
// packages/ai/src/compose.ts
import { generateText, experimental_generateImage as genImage, type LanguageModel, type ImageModel } from "ai";
import { openai } from "@ai-sdk/openai";
import { getTextModel } from "./provider.js";

const POST_INSTRUCTIONS = `Write a single LinkedIn post in the creator's authentic voice, following the brand brief exactly. Use a strong first line hook, short scannable paragraphs, no hashtags unless clearly on-brand, and end with a light call to action or an open question. Output only the post text.`;

export async function draftPost(
  brandBrief: string,
  opts?: { topic?: string; model?: LanguageModel },
): Promise<string> {
  const model = opts?.model ?? getTextModel();
  const { text } = await generateText({
    model,
    system: `${brandBrief}\n\n${POST_INSTRUCTIONS}`,
    prompt: opts?.topic ? `Topic / angle: ${opts.topic}` : "Write a strong post on one of the creator's core pillars.",
  });
  return text.trim();
}

export function getImageModel(): ImageModel {
  const provider = process.env.AI_PROVIDER ?? "openai";
  if (provider !== "openai") throw new Error(`Image generation supports only openai (got ${provider}).`);
  return openai.image(process.env.AI_IMAGE_MODEL ?? "gpt-image-1");
}

export async function generateImage(
  prompt: string,
  opts?: { model?: ImageModel },
): Promise<{ base64: string; mediaType: string }> {
  const model = opts?.model ?? getImageModel();
  const { image } = await genImage({ model, prompt });
  return { base64: image.base64, mediaType: image.mediaType ?? "image/png" };
}
```

- [ ] **Step 4: Export + run — expect PASS**

Add to `src/index.ts`: `export { draftPost, generateImage, getImageModel } from "./compose.js";`
Run: `pnpm --filter @outreach/ai test` then `pnpm --filter @outreach/ai build`. Adjust only SDK-internal image field access if the installed version differs.

- [ ] **Step 5: Commit**

```bash
git add packages/ai
git commit -m "feat(ai): composer — draftPost + generateImage (openai)"
```

---

## Task 2: `Draft` DB model

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (+ migration), `packages/db/src/index.ts`

**Interfaces:**
- Produces: `Draft` model + type export.

- [ ] **Step 1: Add the model + relation**

Add `drafts Draft[]` to `LinkedInAccount`, then:

```prisma
model Draft {
  id                String   @id @default(cuid())
  linkedinAccountId String
  text              String   @default("")
  imageUrl          String?
  imagePrompt       String?
  status            String   @default("draft") // draft (published/scheduled reserved later)
  source            String   @default("ai")    // ai | manual
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  account           LinkedInAccount @relation(fields: [linkedinAccountId], references: [id], onDelete: Cascade)

  @@index([linkedinAccountId, createdAt])
}
```

- [ ] **Step 2: Migrate**

Run: `DATABASE_URL="postgresql://outreach:outreach@localhost:5544/outreach" pnpm --filter @outreach/db exec prisma migrate dev --name draft`
Expected: migration applied, client regenerated.

- [ ] **Step 3: Export type**

Add `Draft` to the `packages/db/src/index.ts` type export.

- [ ] **Step 4: Verify + commit**

Run: `DATABASE_URL="postgresql://outreach:outreach@localhost:5544/outreach" pnpm --filter @outreach/db test` (existing test passes). Commit including `prisma/migrations/**`:
```bash
git add packages/db
git commit -m "feat(db): Draft model"
```

---

## Task 3: API — image storage + env

**Files:**
- Modify: `apps/api/src/env.ts` (add `AI_IMAGE_MODEL` default `gpt-image-1`)
- Create: `apps/api/src/images.ts`
- Test: `apps/api/src/images.test.ts`
- Modify: `.env.example` (+ `AI_IMAGE_MODEL`), `.gitignore` (ignore `apps/api/uploads/`)

**Interfaces:**
- Produces:
  - `saveImage(base64: string, mediaType: string): Promise<{ url: string; path: string }>` — writes bytes to `apps/api/uploads/<cuid>.<ext>`, returns `{ url: "/uploads/<file>", path }`.
  - `uploadsDir: string` — absolute path to the uploads dir (for the static route).

- [ ] **Step 1: env + gitignore**

Add `AI_IMAGE_MODEL: z.string().default("gpt-image-1")` to `env.ts`. Append `AI_IMAGE_MODEL="gpt-image-1"` to `.env.example`. Add `apps/api/uploads/` to root `.gitignore`.

- [ ] **Step 2: Write the failing test**

```typescript
// apps/api/src/images.test.ts
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { saveImage } from "./images.js";

describe("saveImage", () => {
  it("writes base64 bytes and returns a /uploads url", async () => {
    const base64 = Buffer.from("hello-png").toString("base64");
    const { url, path } = await saveImage(base64, "image/png");
    expect(url).toMatch(/^\/uploads\/[a-z0-9]+\.png$/);
    expect((await readFile(path)).toString()).toBe("hello-png");
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

Run: `pnpm --filter @outreach/api test images`
Expected: FAIL.

- [ ] **Step 4: Implement `src/images.ts`**

```typescript
// apps/api/src/images.ts
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
export const uploadsDir = join(here, "..", "uploads");

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export async function saveImage(base64: string, mediaType: string): Promise<{ url: string; path: string }> {
  await mkdir(uploadsDir, { recursive: true });
  const ext = EXT[mediaType] ?? "png";
  const name = `${randomBytes(12).toString("hex")}.${ext}`;
  const path = join(uploadsDir, name);
  await writeFile(path, Buffer.from(base64, "base64"));
  return { url: `/uploads/${name}`, path };
}
```

- [ ] **Step 5: Run — expect PASS + commit**

Run: `pnpm --filter @outreach/api test images` (PASS). Commit:
```bash
git add apps/api/src/env.ts apps/api/src/images.ts apps/api/src/images.test.ts .env.example .gitignore
git commit -m "feat(api): image storage util + AI_IMAGE_MODEL env"
```

---

## Task 4: Draft repository (`apps/api`)

**Files:**
- Create: `apps/api/src/repos/draft.ts`
- Test: `apps/api/src/repos/draft.test.ts`

**Interfaces:**
- Produces:
  - `createDraft(accountId, data: { text: string; imageUrl?: string; imagePrompt?: string; source?: string }): Promise<DraftRow>`
  - `listDrafts(accountId): Promise<DraftRow[]>` (newest first)
  - `getDraft(id, accountId): Promise<DraftRow | null>`
  - `updateDraft(id, accountId, data): Promise<DraftRow>`
  - `deleteDraft(id, accountId): Promise<void>`

- [ ] **Step 1: Write the failing integration test**

```typescript
// apps/api/src/repos/draft.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@outreach/db";
import { createDraft, listDrafts, getDraft, updateDraft, deleteDraft } from "./draft.js";

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

describe("draft repo", () => {
  it("creates, lists, updates, scopes, and deletes", async () => {
    const d = await createDraft(accountId, { text: "hello", imagePrompt: "poster" });
    expect((await listDrafts(accountId)).length).toBeGreaterThan(0);
    const upd = await updateDraft(d.id, accountId, { text: "edited" });
    expect(upd.text).toBe("edited");
    expect(await getDraft(d.id, "other-account")).toBeNull(); // ownership scoping
    await deleteDraft(d.id, accountId);
    expect(await getDraft(d.id, accountId)).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @outreach/api test draft`
Expected: FAIL.

- [ ] **Step 3: Implement `repos/draft.ts`**

```typescript
// apps/api/src/repos/draft.ts
import { prisma } from "@outreach/db";

export function createDraft(
  accountId: string,
  data: { text: string; imageUrl?: string; imagePrompt?: string; source?: string },
) {
  return prisma.draft.create({ data: { linkedinAccountId: accountId, ...data } });
}

export function listDrafts(accountId: string) {
  return prisma.draft.findMany({ where: { linkedinAccountId: accountId }, orderBy: { createdAt: "desc" } });
}

export function getDraft(id: string, accountId: string) {
  return prisma.draft.findFirst({ where: { id, linkedinAccountId: accountId } });
}

export async function updateDraft(
  id: string,
  accountId: string,
  data: { text?: string; imageUrl?: string | null; imagePrompt?: string | null },
) {
  // scope the update to the owning account via updateMany, then return the row
  await prisma.draft.updateMany({ where: { id, linkedinAccountId: accountId }, data });
  return prisma.draft.findFirstOrThrow({ where: { id, linkedinAccountId: accountId } });
}

export async function deleteDraft(id: string, accountId: string): Promise<void> {
  await prisma.draft.deleteMany({ where: { id, linkedinAccountId: accountId } });
}
```

- [ ] **Step 4: Run — expect PASS + commit**

Run: `pnpm --filter @outreach/api test draft` (PASS). Commit:
```bash
git add apps/api/src/repos/draft.ts apps/api/src/repos/draft.test.ts
git commit -m "feat(api): draft repository (ownership-scoped)"
```

---

## Task 5: Studio routes + uploads static (`apps/api`)

**Files:**
- Create: `apps/api/src/routes/studio.ts`
- Modify: `apps/api/src/app.ts` (mount `/studio` under a guard; add public `GET /uploads/*` static)
- Test: `apps/api/src/routes/studio.test.ts`
- Modify: `apps/api/package.json` if `@hono/node-server` static serving needs it (serveStatic is in `@hono/node-server/serve-static`, already a dep)

**Interfaces:**
- Consumes: `@outreach/ai` (`draftPost`, `generateImage`), profile repo (`getProfile`), draft repo, `saveImage`/`uploadsDir`, `getAccountSummary` for ownership.
- Produces routes under `/studio` (behind `/studio/*` 401 guard), all ownership-checked:
  - `POST /studio/:accountId/draft-text { topic? }` → needs a ready profile (`brandBrief`); `draftPost` → `{ text }`. 400 `{error:"no_profile"}` if no ready profile.
  - `POST /studio/:accountId/draft-image { prompt }` → `generateImage` → `saveImage` → `{ imageUrl }`.
  - `GET  /studio/:accountId/drafts` → `{ drafts }`
  - `POST /studio/:accountId/drafts { text, imageUrl?, imagePrompt? }` → `createDraft` → `{ draft }`
  - `PATCH /studio/:accountId/drafts/:id { ... }` → `updateDraft` → `{ draft }`
  - `DELETE /studio/:accountId/drafts/:id` → `deleteDraft` → `{ ok: true }`
- Public static: `GET /uploads/*` serves files from `uploadsDir` (no auth — images referenced by `<img>`).

- [ ] **Step 1: Write the failing test (AI mocked)**

```typescript
// apps/api/src/routes/studio.test.ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@outreach/ai", () => ({
  draftPost: vi.fn(async () => "A strong hook.\n\nBody of the post."),
  generateImage: vi.fn(async () => ({ base64: Buffer.from("img").toString("base64"), mediaType: "image/png" })),
}));

import { prisma } from "@outreach/db";
import { createApp } from "../app.js";

let userId = "", accountId = "", cookie = "";
const app = createApp();

async function authed(): Promise<{ cookie: string; email: string }> {
  const email = `s${Date.now()}${Math.floor(Math.random() * 1e6)}@ex.com`;
  const res = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: process.env.WEB_ORIGIN! },
    body: JSON.stringify({ email, password: "password-1234", name: "S" }),
  });
  return { cookie: res.headers.get("set-cookie")!.split(";")[0]!, email };
}

beforeAll(async () => {
  const a = await authed(); cookie = a.cookie;
  const u = await prisma.user.findUniqueOrThrow({ where: { email: a.email } });
  userId = u.id;
  const acc = await prisma.linkedInAccount.create({
    data: { userId, memberUrn: `urn:li:person:${Date.now()}`, displayName: "T", accessToken: "enc", scopes: [] },
  });
  accountId = acc.id;
  await prisma.creatorProfile.create({ data: { linkedinAccountId: accountId, status: "ready", brandBrief: "Write as X." } });
});
afterAll(async () => { await prisma.user.delete({ where: { id: userId } }); await prisma.$disconnect(); });

describe("studio routes", () => {
  it("drafts text, generates an image, saves + lists a draft", async () => {
    const t = await app.request(`/studio/${accountId}/draft-text`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ topic: "AI governance" }),
    });
    expect(t.status).toBe(200);
    const text = (await t.json()).text as string;

    const img = await app.request(`/studio/${accountId}/draft-image`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ prompt: "poster" }),
    });
    const imageUrl = (await img.json()).imageUrl as string;
    expect(imageUrl).toMatch(/^\/uploads\//);

    const save = await app.request(`/studio/${accountId}/drafts`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ text, imageUrl }),
    });
    expect(save.status).toBe(200);

    const list = await app.request(`/studio/${accountId}/drafts`, { headers: { Cookie: cookie } });
    expect((await list.json()).drafts.length).toBe(1);
  });

  it("draft-text 400s without a ready profile", async () => {
    const other = await authed();
    const u = await prisma.user.findUniqueOrThrow({ where: { email: other.email } });
    const acc = await prisma.linkedInAccount.create({
      data: { userId: u.id, memberUrn: `urn:li:person:${Date.now() + 1}`, displayName: "N", accessToken: "e", scopes: [] },
    });
    const res = await app.request(`/studio/${acc.id}/draft-text`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: other.cookie }, body: "{}",
    });
    expect(res.status).toBe(400);
    await prisma.user.delete({ where: { id: u.id } });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @outreach/api test routes/studio`
Expected: FAIL.

- [ ] **Step 3: Implement `routes/studio.ts`**

```typescript
// apps/api/src/routes/studio.ts
import { Hono } from "hono";
import { draftPost, generateImage } from "@outreach/ai";
import type { AppEnv } from "../app.js";
import { getAccountSummary } from "../repos/linkedin-account.js";
import { getProfile } from "../repos/profile.js";
import { createDraft, listDrafts, updateDraft, deleteDraft } from "../repos/draft.js";
import { saveImage } from "../images.js";

export function studioRoutes() {
  const r = new Hono<AppEnv>();

  async function own(c: Parameters<Parameters<Hono<AppEnv>["get"]>[1]>[0]) {
    const user = c.get("user")!;
    const acct = await getAccountSummary(c.req.param("accountId"), user.id);
    return acct ? null : c.json({ error: "not_found" }, 404);
  }

  r.post("/:accountId/draft-text", async (c) => {
    const no = await own(c); if (no) return no;
    const accountId = c.req.param("accountId");
    const profile = await getProfile(accountId);
    if (!profile || profile.status !== "ready" || !profile.brandBrief) {
      return c.json({ error: "no_profile" }, 400);
    }
    const { topic } = await c.req.json<{ topic?: string }>().catch(() => ({ topic: undefined }));
    const text = await draftPost(profile.brandBrief, { topic });
    return c.json({ text });
  });

  r.post("/:accountId/draft-image", async (c) => {
    const no = await own(c); if (no) return no;
    const { prompt } = await c.req.json<{ prompt: string }>();
    const { base64, mediaType } = await generateImage(prompt);
    const { url } = await saveImage(base64, mediaType);
    return c.json({ imageUrl: url });
  });

  r.get("/:accountId/drafts", async (c) => {
    const no = await own(c); if (no) return no;
    return c.json({ drafts: await listDrafts(c.req.param("accountId")) });
  });

  r.post("/:accountId/drafts", async (c) => {
    const no = await own(c); if (no) return no;
    const body = await c.req.json<{ text: string; imageUrl?: string; imagePrompt?: string }>();
    return c.json({ draft: await createDraft(c.req.param("accountId"), body) });
  });

  r.patch("/:accountId/drafts/:id", async (c) => {
    const no = await own(c); if (no) return no;
    const body = await c.req.json();
    return c.json({ draft: await updateDraft(c.req.param("id"), c.req.param("accountId"), body) });
  });

  r.delete("/:accountId/drafts/:id", async (c) => {
    const no = await own(c); if (no) return no;
    await deleteDraft(c.req.param("id"), c.req.param("accountId"));
    return c.json({ ok: true });
  });

  return r;
}
```

- [ ] **Step 4: Mount + static in `app.ts`**

Add imports; mount a guarded `/studio` group (mirror the `/linkedin/*` and `/profile/*` guards); and add a PUBLIC static route for uploads BEFORE the guards:

```typescript
// apps/api/src/app.ts — imports
import { studioRoutes } from "./routes/studio.js";
import { serveStatic } from "@hono/node-server/serve-static";
import { uploadsDir } from "./images.js";
import { relative } from "node:path";

// ...in createApp(), before the auth-guarded groups (public):
app.use("/uploads/*", serveStatic({ root: relative(process.cwd(), uploadsDir) + "/", rewriteRequestPath: (p) => p.replace(/^\/uploads/, "") }));

// ...alongside the other guarded mounts:
app.use("/studio/*", async (c, next) => {
  if (!c.get("user")) return c.json({ error: "unauthorized" }, 401);
  await next();
});
app.route("/studio", studioRoutes());
```

Note: `serveStatic`'s `root` is resolved relative to `process.cwd()`; confirm it serves `uploadsDir` correctly at runtime (the manual smoke covers this). If the relative-path resolution is fragile, implement `GET /uploads/:name` as a small handler that reads `join(uploadsDir, name)` and returns the bytes with the right content-type — whichever reliably serves the file; document the choice.

- [ ] **Step 5: Run — expect PASS**

Run: `docker compose up -d && pnpm --filter @outreach/api test`
Expected: PASS (existing + studio). `pnpm --filter @outreach/api build` clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/studio.ts apps/api/src/app.ts
git commit -m "feat(api): studio routes (draft text/image, draft CRUD) + uploads static"
```

---

## Task 6: Web — Studio page (composer + drafts) + uploads proxy

**Files:**
- Create: `apps/web/src/lib/studio.ts`, `apps/web/src/app/(app)/studio/page.tsx`, `apps/web/src/app/uploads/[...file]/route.ts`
- Modify: `apps/web/src/components/app-shell.tsx` (enable "Content" nav → `/studio`, label "Studio")
- Modify: `apps/web/messages/en.json`, `apps/web/messages/de.json`

**Interfaces:**
- Consumes `/api/studio/*` via the BFF proxy; `<img src="/uploads/..">` via a new uploads proxy.

- [ ] **Step 1: uploads proxy route**

```typescript
// apps/web/src/app/uploads/[...file]/route.ts
const API_BASE = process.env.API_BASE ?? "http://localhost:8787";
export async function GET(_req: Request, ctx: { params: Promise<{ file: string[] }> }) {
  const { file } = await ctx.params;
  const res = await fetch(`${API_BASE}/uploads/${file.join("/")}`);
  return new Response(res.body, { status: res.status, headers: { "content-type": res.headers.get("content-type") ?? "image/png" } });
}
```

- [ ] **Step 2: Shared types**

```typescript
// apps/web/src/lib/studio.ts
export interface Draft {
  id: string; text: string; imageUrl: string | null; imagePrompt: string | null;
  status: string; source: string; createdAt: string;
}
```

- [ ] **Step 3: Studio page**

Requirements (client component, shadcn, match the accounts/profile pages' polish):
- Resolve the first connected account (`GET /api/linkedin/accounts` → `accounts[0]`); none → empty state → `/accounts`.
- Composer card:
  - A topic/angle `Input` + "Generate post" `Button` → `POST /api/studio/:id/draft-text { topic }` → fill a `Textarea` with the returned text. On 400 `no_profile`, show a hint linking to `/profile` ("build your creator profile first").
  - The post `Textarea` (editable).
  - An image `Input` (prompt, prefilled from the first line of the post) + "Generate image" `Button` → `POST /api/studio/:id/draft-image { prompt }` → preview `<img src={imageUrl}>` (served via the uploads proxy).
  - "Save draft" `Button` → `POST /api/studio/:id/drafts { text, imageUrl, imagePrompt }` → prepend to the drafts list; toast/inline "Saved".
- Drafts list: `GET /api/studio/:id/drafts` → cards showing text (clamped) + thumbnail + created date + a Delete button (`DELETE .../drafts/:id`).
- All copy in i18n (en + de). Loading/disabled states while generating (image gen is slow — show a spinner). Guard 401 → `/login`.

Keep it cohesive with the existing pages. Deliverable is a working Studio page.

- [ ] **Step 4: Enable the "Content" nav → Studio**

In `app-shell.tsx`, point the `content` nav entry at `/studio`, drop `soon: true`, keep/adjust the icon (`PenLine` is fine). Set its label to "Studio" (via the `nav.content` message value).

- [ ] **Step 5: i18n**

Add a `studio` message group (en + de): title/subtitle, `topicPlaceholder`, `generatePost`, `generating`, `postPlaceholder`, `imagePromptPlaceholder`, `generateImage`, `generatingImage`, `saveDraft`, `saved`, `draftsTitle`, `draftsEmpty`, `delete`, `noProfile` (+ link label), `emptyNoAccount`, `goToAccounts`. Update `nav.content` → "Studio" / "Studio".

- [ ] **Step 6: Validate + commit**

Do NOT run `next build` while the dev server runs. Hit `/studio` via curl (expect 200), confirm the dev compile has no errors (or `tsc --noEmit`). Manual smoke (real key + API restarted): generate a post + image, save, see it in the drafts list. Commit:
```bash
git add apps/web
git commit -m "feat(web): Studio — AI composer (text+image) + drafts"
```

---

## Self-Review

**Spec coverage (Studio/Composer):**
- Composer: AI text draft from `brandBrief` + optional topic → Tasks 1, 5, 6. ✅
- Image generation (text→image, openai) → Tasks 1, 3, 5, 6. ✅
- Save as Draft (no publish) → Tasks 2, 4, 5, 6. ✅
- Requires a ready profile → Task 5 (`no_profile` 400), Task 6 (UI hint). ✅
- Image storage (local `/uploads`, served, proxied to web) → Tasks 3, 5, 6. ✅
- Studio surface in the shell, "Content" nav → Studio → Task 6. ✅
- **Deferred (correctly not here):** publishing, scheduling, reference-image selfies.

**Placeholder scan:** No TBDs. Task 6's JSX is specified by interface + requirements (mirroring existing pages), every endpoint/shape concrete.

**Type consistency:** `Draft` shape consistent across db model (Task 2), repo (Task 4), routes (Task 5), web types (Task 6). `draftPost`/`generateImage`/`getImageModel` signatures consistent (Task 1) with route usage (Task 5). Image `{base64, mediaType}` flows compose → route → `saveImage` → `/uploads` url → web `<img>`.

---

## Deviations / notes for the implementer
- **AI SDK image internals** (`experimental_generateImage` result `image.base64`/`.mediaType`, and `ImageModelV2.doGenerate` mock shape) are the only SDK-internal touchpoints — verify against installed `ai@5`/`@ai-sdk/openai@2` and adjust the mock + extraction, documenting any change. Everything else uses the stable surface.
- **Static serving** of `/uploads` — if `serveStatic`'s relative-root resolution is fragile in this setup, fall back to a small file-reading handler; document the choice.
- **gpt-image-1 access:** the OpenAI account/key must be enabled for `gpt-image-1`; if the manual smoke returns an access error, note it — the code path is correct and the model id is configurable via `AI_IMAGE_MODEL`.
