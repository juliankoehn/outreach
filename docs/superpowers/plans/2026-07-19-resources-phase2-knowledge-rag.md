# Resources — Phase 2 (Knowledge RAG) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ingest per-account documents into a pgvector knowledge base and let the studio agents silently ground generated posts on retrieved passages via a `searchKnowledge` tool, with sources shown in the UI (never cited in the post).

**Architecture:** `ResourceChunk` rows (halfvec(3072) embeddings, HNSW cosine index) in pgvector. **pg-boss runs inside the API process** (register `ingest-document` there — keeps storage/DB/embedding deps local, no shared-package refactor, no second dev process; the persistent Postgres-backed queue still survives restarts and retries). Ingestion: getObject → extract (unpdf) → section-aware chunk (js-tiktoken) → embed (text-embedding-3-large) → insert chunks. `retrieveKnowledge(accountId, query)` embeds the query and cosine-searches; both studio agents call it through a `searchKnowledge` tool whose result grounds the next output. The tool-part renders a collapsible sources affordance.

**Tech Stack:** Prisma 7 + pgvector (`pgvector/pgvector:pg17`), pg-boss, unpdf, js-tiktoken, AI SDK v7 (`text-embedding-3-large`), Hono, Next.js 16 + AI Elements.

## Global Constraints

- ESM `.js` import specifiers; TS 7 native (`declaration:false`; pure-node pkgs `"types":["node"]`).
- Prisma 7: client to `packages/db/src/generated/prisma` (gitignored); import `{ prisma }` + model types from `@outreach/db`. Migrate: `pnpm --filter @outreach/db exec prisma migrate dev --name <n>`. Raw SQL for the halfvec column (typed client can't round-trip `Unsupported`).
- **halfvec(3072) + HNSW** (`halfvec_cosine_ops`); the index is created via raw SQL in the migration.
- Embedding: `text-embedding-3-large` (3072 dims) via a new `getEmbeddingModel()`, provider-swappable like `getTextModel()`/`getImageModel()`.
- Agent tools with an `execute` continue the loop (server-side); handlers are injected by the route (established pattern: `StudioAgentHandlers` in `studio-agent.ts`, `ProfileStudioHandlers` in `profile-studio.ts`).
- **Trunk-based: commit directly to `main`, per-task commits authorized.** No feature branch required; if one is used, merge + delete it when green.
- MinIO on host port 9010 locally; bare `vitest` now loads root `.env` (Phase-1 fix). Never `next build` while `next dev` runs; restart api after api/db edits.
- Studio chat = AI Elements + `useChat`; tool-parts render in the conversation.

---

## Task 1: pgvector infra + `ResourceChunk` model + chunk repo

**Files:**
- Modify: `docker-compose.yml` (db image), `packages/db/prisma/schema.prisma`
- Create: migration under `packages/db/prisma/migrations/` (extension + table + HNSW index)
- Create: `apps/api/src/repos/chunk.ts`
- Test: `apps/api/src/repos/chunk.test.ts`

**Interfaces produced:** `insertChunks(rows: ChunkInsert[])`, `searchChunks(accountId, embedding: number[], topK): Promise<ChunkHit[]>`, `deleteChunksForResource(resourceId)` from `apps/api/src/repos/chunk.ts`. Types: `ChunkInsert { resourceId; accountId; ordinal; content; section?; tokenCount; embedding: number[] }`, `ChunkHit { id; resourceId; resourceName; section; content; score }`.

- [ ] **Step 1: Swap the db image**

In `docker-compose.yml`, change the `db` service image `postgres:17` → `pgvector/pgvector:pg17` (same PG17 data dir; adds the `vector` extension). Then: `docker compose up -d db` and wait for healthy.

- [ ] **Step 2: Add the model (raw-mapped vector column)**

```prisma
// packages/db/prisma/schema.prisma
model ResourceChunk {
  id         String   @id @default(cuid())
  resourceId String
  resource   Resource @relation(fields: [resourceId], references: [id], onDelete: Cascade)
  accountId  String
  ordinal    Int
  content    String
  section    String?
  tokenCount Int
  embedding  Unsupported("halfvec(3072)")
  createdAt  DateTime @default(now())

  @@index([accountId])
  @@index([resourceId])
}
```
Add `chunks ResourceChunk[]` to `model Resource`.

- [ ] **Step 3: Create the migration (extension + HNSW index)**

Run `pnpm --filter @outreach/db exec prisma migrate dev --create-only --name add_resource_chunk`. Then edit the generated `migration.sql`: prepend `CREATE EXTENSION IF NOT EXISTS vector;` and append (Prisma won't emit these for an Unsupported column):
```sql
CREATE INDEX "resource_chunk_embedding_hnsw"
  ON "ResourceChunk" USING hnsw (embedding halfvec_cosine_ops);
```
Then apply: `pnpm --filter @outreach/db exec prisma migrate dev` and `prisma generate`.

- [ ] **Step 4: Write the failing chunk-repo test**

```ts
// apps/api/src/repos/chunk.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@outreach/db";
import { insertChunks, searchChunks, deleteChunksForResource } from "./chunk.js";

let userId = "", accountId = "", resourceId = "";
function vec(seed: number): number[] { return Array.from({ length: 3072 }, (_, i) => Math.sin(seed + i * 0.001)); }

beforeAll(async () => {
  const u = await prisma.user.create({ data: { id: `u${Date.now()}`, email: `c${Date.now()}@ex.com`, name: "C" } });
  userId = u.id;
  const a = await prisma.linkedInAccount.create({ data: { userId, memberUrn: `urn:li:person:${Date.now()}`, displayName: "T", accessToken: "e", scopes: [] } });
  accountId = a.id;
  const r = await prisma.resource.create({ data: { accountId, kind: "document", name: "norm.pdf", mimeType: "application/pdf", sizeBytes: 1, storageKey: "k", status: "ready" } });
  resourceId = r.id;
});
afterAll(async () => { await prisma.user.delete({ where: { id: userId } }); await prisma.$disconnect(); });

describe("chunk repo", () => {
  it("inserts chunks and cosine-searches nearest first, scoped by account", async () => {
    await insertChunks([
      { resourceId, accountId, ordinal: 0, content: "alpha passage", section: "A", tokenCount: 2, embedding: vec(1) },
      { resourceId, accountId, ordinal: 1, content: "beta passage", section: "B", tokenCount: 2, embedding: vec(50) },
    ]);
    const hits = await searchChunks(accountId, vec(1), 2);
    expect(hits.length).toBe(2);
    expect(hits[0]!.content).toBe("alpha passage");
    expect(hits[0]!.resourceName).toBe("norm.pdf");
    // other account sees nothing
    expect((await searchChunks("nope", vec(1), 2)).length).toBe(0);
    await deleteChunksForResource(resourceId);
    expect((await searchChunks(accountId, vec(1), 2)).length).toBe(0);
  });
});
```

- [ ] **Step 5: Run it, expect failure**

Run: `pnpm --filter @outreach/api exec vitest run src/repos/chunk.test.ts` → FAIL (`./chunk.js` missing).

- [ ] **Step 6: Implement the chunk repo (raw halfvec SQL)**

```ts
// apps/api/src/repos/chunk.ts
import { prisma } from "@outreach/db";

export interface ChunkInsert {
  resourceId: string; accountId: string; ordinal: number;
  content: string; section?: string | null; tokenCount: number; embedding: number[];
}
export interface ChunkHit {
  id: string; resourceId: string; resourceName: string;
  section: string | null; content: string; score: number;
}

const toVec = (e: number[]) => `[${e.join(",")}]`;

export async function insertChunks(rows: ChunkInsert[]): Promise<void> {
  // Insert one row at a time with a parameterized halfvec cast. (Row counts are
  // modest per batch; the ingestion job batches upstream.)
  for (const r of rows) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "ResourceChunk" ("id","resourceId","accountId","ordinal","content","section","tokenCount","embedding","createdAt")
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7::halfvec, now())`,
      r.resourceId, r.accountId, r.ordinal, r.content, r.section ?? null, r.tokenCount, toVec(r.embedding),
    );
  }
}

export async function searchChunks(accountId: string, embedding: number[], topK: number): Promise<ChunkHit[]> {
  return prisma.$queryRawUnsafe<ChunkHit[]>(
    `SELECT c."id", c."resourceId", r."name" AS "resourceName", c."section", c."content",
            1 - (c."embedding" <=> $1::halfvec) AS "score"
     FROM "ResourceChunk" c
     JOIN "Resource" r ON r."id" = c."resourceId"
     WHERE c."accountId" = $2 AND r."status" = 'ready'
     ORDER BY c."embedding" <=> $1::halfvec
     LIMIT $3`,
    toVec(embedding), accountId, topK,
  );
}

export async function deleteChunksForResource(resourceId: string): Promise<void> {
  await prisma.$executeRawUnsafe(`DELETE FROM "ResourceChunk" WHERE "resourceId" = $1`, resourceId);
}
```

- [ ] **Step 7: Green + typecheck**

Run: `pnpm --filter @outreach/api exec vitest run src/repos/chunk.test.ts` → PASS. `pnpm --filter @outreach/db exec tsc --noEmit` + `pnpm --filter @outreach/api exec tsc --noEmit` → 0 errors.

- [ ] **Step 8: Commit** — stage compose, schema, migration dir (NOT generated client), chunk repo + test. `feat(db): ResourceChunk + pgvector HNSW; chunk repo`.

---

## Task 2: Embedding model + `retrieveKnowledge`

**Files:**
- Modify: `packages/ai/src/provider.ts` (add `getEmbeddingModel`), `packages/ai/src/index.ts` (export `embedQuery`, `embedBatch`)
- Create: `packages/ai/src/embed.ts`
- Create: `apps/api/src/repos/knowledge.ts` (`retrieveKnowledge`)
- Test: `packages/ai/src/embed.test.ts`

**Interfaces produced:** `getEmbeddingModel()`, `embedQuery(text): Promise<number[]>`, `embedBatch(texts: string[]): Promise<number[][]>` from `@outreach/ai`; `retrieveKnowledge(accountId, query, topK?): Promise<ChunkHit[]>` from `apps/api/src/repos/knowledge.ts`.

- [ ] **Step 1: Add `getEmbeddingModel`**

```ts
// packages/ai/src/provider.ts — append
import type { EmbeddingModel } from "ai";
export function getEmbeddingModel(override?: string): EmbeddingModel<string> {
  const provider = process.env.AI_PROVIDER ?? "openai";
  const modelId = override ?? process.env.AI_EMBEDDING_MODEL ?? "text-embedding-3-large";
  switch (provider) {
    case "openai":
      return openai.embedding(modelId);
    default:
      throw new Error(`Unknown AI provider: ${provider}. Supported: openai.`);
  }
}
```

- [ ] **Step 2: Failing embed test**

```ts
// packages/ai/src/embed.test.ts
import { describe, it, expect } from "vitest";
import { MockEmbeddingModelV3 } from "ai/test";
import { embedQuery, embedBatch } from "./embed.js";

const model = new MockEmbeddingModelV3({
  doEmbed: async ({ values }) => ({ embeddings: values.map((_, i) => [i, 0, 0]), usage: { tokens: 1 } }),
});

describe("embed", () => {
  it("embeds a single query and a batch", async () => {
    expect(await embedQuery("hi", { model })).toEqual([0, 0, 0]);
    expect(await embedBatch(["a", "b"], { model })).toEqual([[0, 0, 0], [1, 0, 0]]);
  });
});
```
(Verify `ai/test` exports `MockEmbeddingModelV3`; if not, adapt to the exported embedding mock.)

- [ ] **Step 3: Run it, expect failure**, then implement:

```ts
// packages/ai/src/embed.ts
import { embed, embedMany, type EmbeddingModel } from "ai";
import { getEmbeddingModel } from "./provider.js";

export async function embedQuery(text: string, opts?: { model?: EmbeddingModel<string> }): Promise<number[]> {
  const { embedding } = await embed({ model: opts?.model ?? getEmbeddingModel(), value: text });
  return embedding;
}
export async function embedBatch(texts: string[], opts?: { model?: EmbeddingModel<string> }): Promise<number[][]> {
  if (texts.length === 0) return [];
  const { embeddings } = await embedMany({ model: opts?.model ?? getEmbeddingModel(), values: texts });
  return embeddings;
}
```
Export both from `packages/ai/src/index.ts`.

- [ ] **Step 4: `retrieveKnowledge`**

```ts
// apps/api/src/repos/knowledge.ts
import { embedQuery } from "@outreach/ai";
import { searchChunks, type ChunkHit } from "./chunk.js";

export async function retrieveKnowledge(accountId: string, query: string, topK = 6): Promise<ChunkHit[]> {
  const q = query.trim();
  if (!q) return [];
  const embedding = await embedQuery(q);
  return searchChunks(accountId, embedding, topK);
}
```

- [ ] **Step 5: Green + typecheck** — `pnpm --filter @outreach/ai exec vitest run src/embed.test.ts` PASS; ai + api `tsc --noEmit` clean.
- [ ] **Step 6: Commit** — `feat(ai): embedding model + retrieveKnowledge`.

---

## Task 3: Extraction + section-aware chunking

**Files:**
- Modify: `packages/ai/package.json` (add `unpdf`, `js-tiktoken`), `packages/ai/src/index.ts` (export)
- Create: `packages/ai/src/ingest.ts`
- Test: `packages/ai/src/ingest.test.ts`

**Interfaces produced:** `extractText(bytes: Uint8Array, mimeType: string): Promise<string>`, `chunkText(text, opts?): Chunk[]` where `Chunk { ordinal; content; section: string | null; tokenCount }`, from `@outreach/ai`.

- [ ] **Step 1: Add deps** — `pnpm --filter @outreach/ai add unpdf js-tiktoken`.

- [ ] **Step 2: Failing chunk test**

```ts
// packages/ai/src/ingest.test.ts
import { describe, it, expect } from "vitest";
import { chunkText } from "./ingest.js";

describe("chunkText", () => {
  it("splits by markdown/section heading and packs into token windows with a section label", () => {
    const md = "# Section One\n" + "word ".repeat(600) + "\n## Section Two\nshort tail";
    const chunks = chunkText(md, { targetTokens: 200, overlapTokens: 20 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]!.section).toContain("Section One");
    expect(chunks.at(-1)!.section).toContain("Section Two");
    expect(chunks.every((c) => c.tokenCount > 0)).toBe(true);
    expect(chunks.map((c, i) => c.ordinal === i).every(Boolean)).toBe(true);
  });
});
```

- [ ] **Step 3: Run it, expect failure**, then implement:

```ts
// packages/ai/src/ingest.ts
import { extractText as unpdfExtract } from "unpdf";
import { getEncoding } from "js-tiktoken";

const enc = getEncoding("cl100k_base");
const countTokens = (s: string) => enc.encode(s).length;

export async function extractText(bytes: Uint8Array, mimeType: string): Promise<string> {
  if (mimeType === "application/pdf") {
    const { text } = await unpdfExtract(bytes, { mergePages: true });
    return typeof text === "string" ? text : text.join("\n\n");
  }
  return new TextDecoder().decode(bytes); // text/plain, text/markdown
}

export interface Chunk { ordinal: number; content: string; section: string | null; tokenCount: number; }

// Split on headings (markdown #.., numbered §/clause lines), then pack each
// section's prose into ~targetTokens windows with overlap, carrying the heading.
const HEADING = /^(#{1,6}\s+.+|(§+\s*\d+[\w.\-]*.*)|(\d+(\.\d+){1,}\s+.+))$/;

export function chunkText(text: string, opts?: { targetTokens?: number; overlapTokens?: number }): Chunk[] {
  const target = opts?.targetTokens ?? 500;
  const overlap = opts?.overlapTokens ?? 80;
  const lines = text.split(/\r?\n/);
  const out: Chunk[] = [];
  let section: string | null = null;
  let buf: string[] = [];
  let ord = 0;
  const flush = () => {
    const body = buf.join("\n").trim();
    buf = [];
    if (!body) return;
    const words = body.split(/\s+/);
    let start = 0;
    while (start < words.length) {
      let end = start, toks = 0;
      while (end < words.length && toks < target) { toks += countTokens(words[end]! + " "); end++; }
      const content = words.slice(start, end).join(" ");
      out.push({ ordinal: ord++, content, section, tokenCount: countTokens(content) });
      if (end >= words.length) break;
      // step back ~overlap tokens worth of words
      let back = 0, w = end;
      while (w > start && back < overlap) { w--; back += countTokens(words[w]! + " "); }
      start = Math.max(w, start + 1);
    }
  };
  for (const line of lines) {
    if (HEADING.test(line.trim())) { flush(); section = line.trim().replace(/^#{1,6}\s+/, ""); }
    else buf.push(line);
  }
  flush();
  return out;
}
```

- [ ] **Step 4: Green + typecheck** — chunk test PASS; ai `tsc --noEmit` clean. (Extraction is exercised in the Task 4 ingestion test against a fixture.)
- [ ] **Step 5: Commit** — `feat(ai): document text extraction + section-aware chunking`.

---

## Task 4: pg-boss ingestion (in the API process) + enqueue + backfill

**Files:**
- Modify: `apps/api/package.json` (add `pg-boss`)
- Create: `apps/api/src/queue.ts` (boss singleton + start), `apps/api/src/jobs/ingest-document.ts`
- Modify: `apps/api/src/index.ts` (start boss + register worker + backfill on boot), `apps/api/src/routes/resources.ts` (enqueue after document upload)
- Test: `apps/api/src/jobs/ingest-document.test.ts`

**Interfaces produced:** `getBoss(): Promise<PgBoss>`, `enqueueIngest(resourceId)`, `ingestDocument(resourceId)` (the handler body, exported for direct testing).

- [ ] **Step 1: Add dep** — `pnpm --filter @outreach/api add pg-boss`.

- [ ] **Step 2: Queue singleton**

```ts
// apps/api/src/queue.ts
import PgBoss from "pg-boss";
let boss: PgBoss | null = null;
export const INGEST_QUEUE = "ingest-document";
export async function getBoss(): Promise<PgBoss> {
  if (boss) return boss;
  boss = new PgBoss(process.env.DATABASE_URL!);
  await boss.start();
  return boss;
}
export async function enqueueIngest(resourceId: string): Promise<void> {
  const b = await getBoss();
  await b.send(INGEST_QUEUE, { resourceId });
}
```

- [ ] **Step 3: The ingestion handler (exported for test)**

```ts
// apps/api/src/jobs/ingest-document.ts
import { prisma } from "@outreach/db";
import { extractText, chunkText, embedBatch } from "@outreach/ai";
import { getObject } from "../storage.js";
import { insertChunks, deleteChunksForResource } from "../repos/chunk.js";

export async function ingestDocument(resourceId: string): Promise<void> {
  const res = await prisma.resource.findUnique({ where: { id: resourceId } });
  if (!res || res.kind !== "document") return;
  if (res.status !== "pending" && res.status !== "failed") return;
  await prisma.resource.update({ where: { id: resourceId }, data: { status: "processing", error: null } });
  try {
    const obj = await getObject(res.storageKey);
    if (!obj) throw new Error("object missing in storage");
    const text = await extractText(obj.body, res.mimeType);
    const chunks = chunkText(text);
    await deleteChunksForResource(resourceId); // idempotent re-ingest
    // embed + insert in batches
    const BATCH = 64;
    for (let i = 0; i < chunks.length; i += BATCH) {
      const slice = chunks.slice(i, i + BATCH);
      const embeddings = await embedBatch(slice.map((c) => c.content));
      await insertChunks(slice.map((c, j) => ({
        resourceId, accountId: res.accountId, ordinal: c.ordinal,
        content: c.content, section: c.section, tokenCount: c.tokenCount, embedding: embeddings[j]!,
      })));
    }
    await prisma.resource.update({
      where: { id: resourceId },
      data: { status: "ready", meta: { ...((res.meta as object | null) ?? {}), chunkCount: chunks.length } },
    });
  } catch (e) {
    await prisma.resource.update({ where: { id: resourceId }, data: { status: "failed", error: String((e as Error).message ?? e) } });
    throw e; // let pg-boss apply its retry policy
  }
}
```

- [ ] **Step 4: Wire into boot + enqueue on upload**

In `apps/api/src/index.ts` (server bootstrap): after the server starts, `const b = await getBoss(); await b.work(INGEST_QUEUE, { teamSize: 2, teamConcurrency: 1 }, async ([job]) => ingestDocument(job.data.resourceId)); ` then a **backfill**: `const pending = await prisma.resource.findMany({ where: { kind: "document", status: "pending" }, select: { id: true } }); for (const r of pending) await enqueueIngest(r.id);`. Guard boot so a boss failure logs but doesn't crash the API.
In `apps/api/src/routes/resources.ts` POST upload: after creating a `document` resource, `await enqueueIngest(resource.id);` (best-effort — wrap so an enqueue failure doesn't fail the upload; the backfill will catch it).

- [ ] **Step 5: Failing ingestion test (direct handler call, text fixture)**

```ts
// apps/api/src/jobs/ingest-document.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@outreach/db";
import { putObject } from "../storage.js";
import { ingestDocument } from "./ingest-document.js";
import { searchChunks } from "../repos/chunk.js";

let userId = "", accountId = "", resourceId = "", key = "";
beforeAll(async () => {
  const u = await prisma.user.create({ data: { id: `u${Date.now()}`, email: `i${Date.now()}@ex.com`, name: "I" } });
  userId = u.id;
  accountId = (await prisma.linkedInAccount.create({ data: { userId, memberUrn: `urn:li:person:${Date.now()}`, displayName: "T", accessToken: "e", scopes: [] } })).id;
  key = `resources/${accountId}/${Date.now()}.md`;
  await putObject(key, Buffer.from("# Norm A\n" + "compliance ".repeat(300) + "\n## Norm B\ntail"), "text/markdown");
  resourceId = (await prisma.resource.create({ data: { accountId, kind: "document", name: "norm.md", mimeType: "text/markdown", sizeBytes: 10, storageKey: key, status: "pending" } })).id;
});
afterAll(async () => { await prisma.user.delete({ where: { id: userId } }); await prisma.$disconnect(); });

describe("ingestDocument", () => {
  it("extracts, chunks, embeds, inserts, marks ready", async () => {
    await ingestDocument(resourceId);
    const res = await prisma.resource.findUniqueOrThrow({ where: { id: resourceId } });
    expect(res.status).toBe("ready");
    expect((res.meta as { chunkCount?: number }).chunkCount).toBeGreaterThan(0);
    // a query embedding retrieves at least one chunk for this account
    // (uses the real embedding model — requires OPENAI_API_KEY in env)
    const { embedQuery } = await import("@outreach/ai");
    const hits = await searchChunks(accountId, await embedQuery("compliance norm"), 3);
    expect(hits.length).toBeGreaterThan(0);
  });
});
```
Note: this test hits the real embedding API (needs `OPENAI_API_KEY`); it's an integration test. If key-less CI is required, gate it behind an env check (skip when `!process.env.OPENAI_API_KEY`).

- [ ] **Step 6: Run it, expect failure → implement (Steps 2-4) → green.** Then `tsc --noEmit` clean for api. (`pg-boss` is only started at boot, not in this unit test.)
- [ ] **Step 7: Commit** — `feat(api): pg-boss document ingestion + enqueue + backfill`.

---

## Task 5: `searchKnowledge` tool + silent grounding

**Files:**
- Modify: `packages/ai/src/studio-agent.ts` (handler + tool + prompt rule), `packages/ai/src/profile-studio.ts` (same)
- Modify: `apps/api/src/routes/studio.ts` + `apps/api/src/routes/profile.ts` (wire `searchKnowledge` handler → `retrieveKnowledge`)
- Test: extend an existing agent test OR a focused prompt/handler test.

**Interfaces:** add `searchKnowledge(query: string): Promise<Array<{ content: string; section: string | null; resourceName: string }>>` to both `StudioAgentHandlers` and `ProfileStudioHandlers`.

- [ ] **Step 1:** Add `searchKnowledge` to `StudioAgentHandlers` and a `searchKnowledge` tool (inputSchema `{ query: string }`, `execute: async ({query}) => opts.handlers.searchKnowledge(query)`). Do the same in `profile-studio.ts` / `ProfileStudioHandlers`.

- [ ] **Step 2:** Add the grounding rule to BOTH system prompts, verbatim: `"You can call searchKnowledge to pull passages from the creator's uploaded documents (norms, guidelines). When you use them, ground your writing on the retrieved passages — but NEVER put citations, source names, section numbers, or quotes-with-attribution in the post text itself. The post must read clean; the sources are shown to the user separately in the UI."`

- [ ] **Step 3:** Wire the handler in both routes. Draft studio (`studio.ts`, account-scoped): `searchKnowledge: (query) => retrieveKnowledge(accountId, query).then(hits => hits.map(h => ({ content: h.content, section: h.section, resourceName: h.resourceName })))`. Profile studio (`profile.ts` `/:id/studio`): resolve account via `getAccountIdForProfile(id, user.id)`; if null, `searchKnowledge` returns `[]`.

- [ ] **Step 4:** Test — assert both agents' system prompts contain the no-in-post-citation rule (string check), and that the `searchKnowledge` handler maps `retrieveKnowledge` hits to `{content, section, resourceName}` (unit with a stub handler). Reuse existing agent test scaffolding.

- [ ] **Step 5: Green + typecheck** (ai + api). **Commit** — `feat(ai): searchKnowledge tool with silent grounding`.

---

## Task 6: Source-visibility UI

**Files:**
- Modify: the draft studio chat (`apps/web/src/app/(app)/studio/[id]/studio-chat.tsx`) and profile studio (`apps/web/src/app/(app)/profile/[id]/profile-studio.tsx`) — render the `searchKnowledge` tool-part
- Modify: `apps/web/messages/en.json`, `de.json`

- [ ] **Step 1:** In each studio chat, when iterating message parts, handle `part.type === "tool-searchKnowledge"`: when `state === "output-available"`, render a compact **collapsible** "sources" affordance — a chip/summary "Basiert auf N Quellen / Based on N sources" that expands to a list; each item shows `resourceName` + `section` + a truncated `content` snippet. Reuse the existing AI Elements tool-part rendering used for the other studio tools (match the look; do not invent a new component style). While `state` is input-available (searching), show a subtle "durchsucht Wissen…/searching knowledge…" line.

- [ ] **Step 2:** i18n keys `studio.sourcesTitle` ("Based on {count} sources" / "Basiert auf {count} Quellen" — ICU plural OK), `studio.sourcesSearching`, `studio.sourceSnippet`. NO literal `<`/unescaped braces beyond ICU placeholders.

- [ ] **Step 3:** `pnpm --filter @outreach/web exec tsc --noEmit` → 0 errors; the studio pages still serve 200. **Commit** — `feat(web): knowledge sources shown on grounded posts`.

---

## Task 7: End-to-end verification

- [ ] **Step 1:** Full typecheck sweep (`ai/api/web/db`) → 0 errors.
- [ ] **Step 2:** Test sweep: `pnpm --filter @outreach/api exec vitest run` and `pnpm --filter @outreach/ai exec vitest run` (pgvector db image live; `OPENAI_API_KEY` set for the ingestion integration test, or it self-skips).
- [ ] **Step 3:** Manual live smoke: upload a real PDF (norm/Grundschutz excerpt) in the Wissen section → watch status pending→processing→ready (chunkCount set) → in the studio, ask the agent to write a post on a topic the doc covers → confirm it calls `searchKnowledge`, the post has NO citations, and the UI shows the sources with document + section. Delete the doc → chunks cascade-gone.
- [ ] **Step 4:** Report: what shipped, test/typecheck results, and note the deliberate deviation (pg-boss runs in the API process, not `apps/worker` — event-loop caveat during heavy PDF parse; worker process is the future scale step). Merge to `main` (trunk-based) per user instruction.
