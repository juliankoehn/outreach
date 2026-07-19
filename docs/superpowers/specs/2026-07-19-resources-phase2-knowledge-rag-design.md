# Resources — Phase 2: Knowledge RAG — Design

**Status:** Design approved 2026-07-19 (brainstorm choices: pg-boss ingestion, agent-tool grounding, text-embedding-3-large).
**Scope:** Phase 2 of the Resources feature. Phase 1 (assets + storage + document upload) is merged to `main`. Phase 3 (Q&A over the knowledge base) is a later spec.

---

## Goal

Turn the `document` resources already stored per account (norms, laws, IT-Grundschutz, etc.) into a searchable knowledge base that **silently grounds** AI-generated LinkedIn posts, with the used sources **visible in the UI for verification** but **never cited inside the post text**.

Because the corpus is large (the Grundschutz-Kompendium alone is ~800 pages), this is true vector retrieval (pgvector), not context-stuffing.

## Context from Phase 1 (already built, do not rebuild)

- `Resource` model (`kind: "image" | "document"`, `status`, `meta`, `storageKey`) owned by `LinkedInAccount`. Documents currently land at `status: "pending"` after upload and are otherwise inert.
- Object storage (`apps/api/src/storage.ts` — `getObject(key)`), resources routes, Resources tab UI (Wissen section lists documents).
- `packages/ai` has `getTextModel()`/`getImageModel()` provider abstractions and the agentic studios: `packages/ai/src/studio-agent.ts` (draft studio) and `packages/ai/src/profile-studio.ts` (profile studio), both `streamText` + tools.
- `apps/worker` exists but is an inert scaffold. Postgres on :5544; the repo-root `.env` holds `DATABASE_URL`.

## Decisions (from brainstorm)

- **Ingestion runs on pg-boss** (Postgres-native job queue) in `apps/worker`. Robust across restarts, retries, and reused later by the publishing scheduler.
- **Grounding is an agent tool** (`searchKnowledge`) the studio agents call when they need facts — not blind auto-retrieval. The chunks it returns are what surface as sources.
- **Embeddings: `text-embedding-3-large` (3072 dims)** for retrieval precision on dense legal/norm text; provider-swappable.

---

## Global Constraints

- Monorepo pnpm workspaces, ESM with explicit `.js` import specifiers, `verbatimModuleSyntax`, TypeScript 7 native (`declaration:false`; pure-node pkgs `"types":["node"]`).
- Prisma 7: no in-schema `url`; driver adapter + `prisma.config.ts`; client generated to `packages/db/src/generated/prisma` (gitignored); model types re-exported from `@outreach/db`. Migrations via `pnpm --filter @outreach/db exec prisma migrate dev --name <n>`.
- AI SDK v7 (`ai@7`), `@ai-sdk/openai@4`. Tools stop the agent loop when they have no `execute`; here `searchKnowledge` HAS an `execute` (server-side retrieval).
- API Hono + Better Auth (`Origin: http://localhost:3000`); web ↔ API via `/api/[...proxy]`. Studio chat uses AI Elements + `useChat`; tool-parts render in the conversation.
- **Trunk-based:** work merges to `main`, no lingering feature branches; per-task commits authorized.
- Never `next build` while `next dev` runs. Restart api after api/db edits. Validate via `tsc --noEmit` + tests (bare `vitest` now loads root `.env`).
- **pgvector dimension limit:** pgvector HNSW indexes `vector` only up to 2000 dims; 3072-dim embeddings therefore use **`halfvec(3072)`** (HNSW supports halfvec up to 4000 dims; half the storage, negligible recall loss).

---

## 1. pgvector Infrastructure

- **docker-compose:** swap the db image `postgres:17` → **`pgvector/pgvector:pg17`** (same Postgres 17, ships the `vector` extension). Existing `pgdata` volume is compatible (same PG major).
- **Migration:** `CREATE EXTENSION IF NOT EXISTS vector;` (first migration of Phase 2), then the `ResourceChunk` table.
- Prisma cannot express `halfvec` natively → the column is `embedding Unsupported("halfvec(3072)")`. All embedding **writes and similarity reads go through `$executeRaw`/`$queryRaw`** (the typed client can't round-trip an Unsupported column). The HNSW index is created in the migration SQL (Prisma won't generate it):
  ```sql
  CREATE INDEX resource_chunk_embedding_hnsw
    ON "ResourceChunk" USING hnsw (embedding halfvec_cosine_ops);
  ```

## 2. `ResourceChunk` Model

```prisma
model ResourceChunk {
  id         String   @id @default(cuid())
  resourceId String
  resource   Resource @relation(fields: [resourceId], references: [id], onDelete: Cascade)
  accountId  String   // denormalized so retrieval scopes by account without a join
  ordinal    Int
  content    String
  section    String?  // heading/§ path, e.g. "OPS.1.1.2 Ordnungsgemäße IT-Administration"
  tokenCount Int
  embedding  Unsupported("halfvec(3072)")
  createdAt  DateTime @default(now())

  @@index([accountId])
  @@index([resourceId])
}
```
Add back-relation `chunks ResourceChunk[]` to `Resource`. The HNSW index is added via raw SQL in the migration. Chunk rows cascade-delete with their `Resource` (which already cascades with the account).

**Chunk repo** (`apps/api/src/repos/chunk.ts` — or shared where the worker can import it): `insertChunks(rows)` (raw multi-row insert, embeddings cast `::halfvec`), `searchChunks(accountId, queryEmbedding, topK)` (raw `ORDER BY embedding <=> $1::halfvec LIMIT topK`, joined to `Resource` for `name`, filtered to `status='ready'`), `deleteChunksForResource(resourceId)`.

## 3. Ingestion (pg-boss worker)

- Add **pg-boss** to `apps/worker`; it connects to the same `DATABASE_URL` and manages its own tables in a `pgboss` schema.
- **Enqueue on upload:** the Phase 1 document upload path (`apps/api/src/routes/resources.ts`) publishes an `ingest-document` job `{ resourceId }` right after creating the `pending` row. (API enqueues via a pg-boss send; worker consumes.)
- **Backfill:** on worker startup, enqueue every existing `document` resource still at `status: "pending"` (idempotent — the job re-checks status).
- **Job handler** (`apps/worker/src/jobs/ingest-document.ts`):
  1. Load the `Resource`; if not `pending`/`failed`, skip. Set `status: "processing"`.
  2. `getObject(storageKey)` → bytes.
  3. Extract text: PDF via **unpdf**; `text/plain`/`text/markdown` decoded directly.
  4. **Section-aware chunking:** split on heading/section markers (Markdown headings, numbered `§`/clause patterns), then pack into ~500-token windows with ~80-token overlap, carrying the current section label. Token counts via **`js-tiktoken`** (`o200k_base`).
  5. Embed chunks in batches with `text-embedding-3-large` (3072 dims).
  6. `deleteChunksForResource` (idempotent re-ingest) then `insertChunks`.
  7. `status: "ready"`, `meta.chunkCount = N` (and `meta.pageCount` if available). On any failure → `status: "failed"`, `error` set; pg-boss retry policy governs re-attempts.
- Concurrency and retries are pg-boss configuration (small concurrency, exponential backoff, capped retries).

## 4. Retrieval + Silent Grounding (agent tool)

- **`packages/ai`:** add `getEmbeddingModel()` (provider-swappable, default `openai.embedding("text-embedding-3-large")`) and `embedQuery(text)`. Retrieval itself needs DB access, so `retrieveKnowledge(accountId, query, {topK})` lives where it can call the chunk repo (in `apps/api`, or injected) — it embeds the query and calls `searchChunks`, returning `{ content, section, resourceId, resourceName, score }[]`.
- **`searchKnowledge` tool** (added to BOTH `studio-agent.ts` and `profile-studio.ts`): `inputSchema { query: string }`, server-side `execute` → `retrieveKnowledge` → returns the chunk list. The agent calls it when it needs facts; because it has an `execute`, the loop continues and the model grounds its next output on the results.
- **System-prompt rule (both agents):** "When you use the knowledge base, ground your writing on the retrieved passages, but NEVER put citations, source names, or section numbers in the post text itself — the post reads clean; sources are shown separately in the UI."
- Retrieval is scoped to the account (draft studio has `accountId`; profile studio resolves it via the Phase 1 `getAccountIdForProfile`). If no chunks / no ready documents, the tool returns an empty list and the agent proceeds without grounding.

## 5. Source Visibility (UI)

- In the studio chat, a `searchKnowledge` tool-part renders a compact, collapsible **"Based on N sources / Basiert auf N Quellen"** affordance (reusing the existing AI Elements tool-part rendering used for the other studio tools). Expanded: each source shows document name + section + a short snippet, so the user can verify or dig in.
- The generated post text stays citation-free (enforced by the prompt rule above).
- i18n en+de for the sources affordance.

## 6. Embedding Configuration

`text-embedding-3-large`, 3072 dims (default), via `getEmbeddingModel()` so it's swappable like text/image. Query and document embeddings use the same model/dimension. Batched calls during ingestion.

---

## Plan Shape (one plan, tasks in dependency order)

1. **pgvector infra + `ResourceChunk`** — db image swap, `CREATE EXTENSION` + table + HNSW-index migration, model, chunk repo (raw insert/search/delete) + tests.
2. **Embedding model + retrieval** — `getEmbeddingModel`/`embedQuery` in `packages/ai`; `retrieveKnowledge(accountId, query, topK)` + test.
3. **pg-boss + ingestion job** — pg-boss wiring in worker, `ingest-document` handler (unpdf extraction, section-aware chunking with js-tiktoken, batched embedding, chunk insert, status transitions), upload-enqueue in the API, startup backfill + test.
4. **`searchKnowledge` tool + silent grounding** — add the tool to both studio agents, the prompt rule, account scoping + test.
5. **Source visibility UI** — the tool-part sources affordance in the studio chat + i18n.

---

## Testing

- Chunk repo: insert + cosine search returns nearest chunk first, scoped by account (unit/integration against pgvector — the db image swap must be live).
- `retrieveKnowledge`: with a mock embedding model, a known query embedding retrieves the expected chunk.
- Ingestion job: a small text/markdown resource → chunks created, `status: ready`, `chunkCount` set; a forced failure → `status: failed` + error. (PDF extraction smoke against a tiny fixture PDF.)
- `searchKnowledge` tool: given ready chunks, the agent's tool call returns them; empty when no ready docs; account-scoped (cross-account returns nothing).
- Grounding prompt: assert the system prompt forbids in-post citations (string check) — the "no citations in post" behavior is verified in a live smoke.
- UI: sources affordance renders from a `searchKnowledge` tool-part; web typecheck clean.

## Success Criteria

- A pgvector-backed knowledge base per account; uploading a PDF ingests it (pending→processing→ready) via pg-boss, surviving worker restarts.
- The studio agents can pull relevant passages via `searchKnowledge`; generated posts are factually grounded but contain **no citations**.
- The UI shows exactly which sources (document + section + snippet) grounded a post, for verification.
- Existing Phase 1 `pending` documents get ingested (backfill).
- No regression to Phase 1 (assets, image references, storage).

## Explicitly NOT in Phase 2

- Q&A / "chat with your knowledge" (Phase 3).
- Cross-account/global shared corpora (still per-account; the Phase 1 upgrade path stands).
- Re-ranking, hybrid keyword+vector search, or query expansion (retrieval is straight cosine top-k; revisit if precision lacks).
- Orphaned-object / chunk GC sweeps beyond cascade deletes (a maintenance concern noted in Phase 1 follow-ups).
