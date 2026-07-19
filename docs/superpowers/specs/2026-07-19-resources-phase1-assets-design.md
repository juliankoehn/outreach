# Resources — Phase 1: Assets & Storage — Design

**Status:** Design (approved to write spec 2026-07-19)
**Scope:** Phase 1 of a 3-phase feature. This spec covers ONLY Phase 1. Phases 2 (Wissens-RAG) and 3 (Q&A) get their own specs when we reach them.

---

## Overall Vision (context — not all built here)

A per-account **Resource** store with two kinds of assets:

- **`image`** — visual references (photos of the creator, brand imagery) that steer image generation toward the creator's face/aesthetic.
- **`document`** — the knowledge base (norms, laws, IT-Grundschutz, articles) that *silently grounds* generated post text via RAG. In the UI the used sources are visible for verification; **the post text itself never contains citations**. A Q&A mode lets the creator "chat with their knowledge".

Because norms/laws/Grundschutz are large (the Grundschutz-Kompendium alone is ~800 pages), the knowledge side needs true vector retrieval (pgvector), not context-stuffing.

**Phasing:**

1. **Phase 1 (this spec)** — Resource model + object storage (MinIO/S3) + Resources tab UI (upload/list/delete for both kinds) + image references in image generation + LinkedIn image formats. Documents can be uploaded and stored (queued `pending`); they are not yet searchable.
2. **Phase 2** — pgvector infra, ingestion background job (extract → chunk → embed), retrieval, silent grounding of post generation, source visibility in the UI. Backfills the `pending` documents from Phase 1.
3. **Phase 3** — Q&A chat over the knowledge base.

**Ownership decision (YAGNI):** Resources belong to the **LinkedIn account** (`accountId`), like CreatorProfile. No global/user-level store yet. Upgrade path if ever needed: make `accountId` nullable + add `userId` (or a `scope` field) — purely additive migration. Reference corpora (norms) would be the first candidate for a shared store, but not until a real second account exists.

---

## Phase 1 Scope

Deliver a complete, shippable slice:

1. **Object storage layer** — S3-compatible (MinIO locally via docker-compose; S3/R2 in prod). Replaces the local-disk `uploads/` mechanism for all binary assets.
2. **`Resource` Prisma model** (no chunk table yet — that's Phase 2).
3. **API routes** — upload, list, get content (auth-gated stream), delete, toggle "use as image reference".
4. **Resources tab** on the account — two sections: **Bilder** and **Wissen**.
5. **Image generation upgrades** — (a) pass selected image references to the model, (b) LinkedIn-appropriate output sizes.
6. **Migrate the existing generated-image path** (`saveImage` → studio/profile example images) onto the new storage layer, so there is one storage mechanism, not two.

**Explicitly NOT in Phase 1:** `ResourceChunk`, embeddings, pgvector, ingestion job, retrieval, grounding, Q&A. Documents uploaded in Phase 1 sit at `status = "pending"` until Phase 2 ingests them.

---

## Global Constraints

- Monorepo: pnpm workspaces, ESM with explicit `.js` import specifiers, `verbatimModuleSyntax`.
- TypeScript 7 native compiler; pure-node packages need `"types": ["node"]`; `declaration: false` in `tsconfig.base.json`.
- Prisma 7: no in-schema `url`; driver adapter (`@prisma/adapter-pg`) + `prisma.config.ts`; client generated to `packages/db/src/generated/prisma`, imported from `./generated/prisma/client.js`.
- AI SDK v7 (`ai@7`), `@ai-sdk/openai@4`. Image model is `gpt-image-1` via `getImageModel()` in `packages/ai/src/compose.ts`.
- API is Hono + Better Auth; auth requires `Origin: http://localhost:3000`. Web talks to the API through the `/api/[...proxy]` route (cookies forwarded).
- UI: Next.js 16, next-intl (en/de; **no literal `<`, `{`, `}` in plain ICU strings**), shadcn/ui, Tailwind v4. App pages full-width (`p-6`, no `mx-auto max-w-*`). Softer shadow tokens already set in `globals.css`.
- Never run `next build` while `next dev` runs. `tsx watch` (api) does not reliably hot-reload — restart api after api/db edits. Validate via `tsc --noEmit` + curl.
- Do not commit unless the user explicitly asks.

---

## 1. Object Storage Layer

### docker-compose

Add a MinIO service alongside Postgres:

```yaml
  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: outreach
      MINIO_ROOT_PASSWORD: outreach-secret
    ports:
      - "9000:9000"   # S3 API
      - "9001:9001"   # web console
    volumes:
      - miniodata:/data
```

Add `miniodata` to the `volumes:` block. Bucket `outreach-resources` is created on first use by the storage module (idempotent `HeadBucket` → `CreateBucket`).

### Env (both `apps/api` and `apps/worker`)

```
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_ACCESS_KEY=outreach
S3_SECRET_KEY=outreach-secret
S3_BUCKET=outreach-resources
S3_FORCE_PATH_STYLE=true          # MinIO requires path-style addressing
```

### Storage module

A small shared wrapper over `@aws-sdk/client-s3` — new file `apps/api/src/storage.ts` (the worker imports it or gets its own copy; keep it in the api for Phase 1 since only the api writes objects here). Interface:

```ts
export interface StoredObject { key: string }
export async function putObject(key: string, body: Buffer, contentType: string): Promise<StoredObject>
export async function getObject(key: string): Promise<{ body: Uint8Array; contentType: string } | null>
export async function deleteObject(key: string): Promise<void>
```

- Ensures the bucket exists on first `putObject`.
- **Key scheme:** `resources/{accountId}/{resourceId}.{ext}` for resources; `generated/{random}.{ext}` for AI-generated images. Keys are opaque to clients.

### Serving (auth-gated, replaces public `/uploads`)

Resources are **private** (personal photos, proprietary docs) — unlike the old public `/uploads`. Serve them through an authenticated API route that checks account ownership, then streams from S3:

- `GET /linkedin/accounts/:accountId/resources/:id/content` → 200 with the object bytes + correct `Content-Type`, or 404. Ownership enforced (account belongs to the session user).
- `<img>` tags in the web app reference this via the `/api/...` proxy; the browser sends the session cookie same-origin, so auth passes.

Generated example-post images move to the same storage; they are served through a route too (they may be public-ish, but routing them through the API keeps one mechanism). The old `GET /uploads/:name` handler and `apps/api/src/images.ts` disk code are removed; `saveImage` is reimplemented on top of `putObject` (see §5), returning a URL that points at the content route.

---

## 2. `Resource` Prisma Model

```prisma
model Resource {
  id         String   @id @default(cuid())
  accountId  String
  account    LinkedInAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)

  kind       String   // "image" | "document"
  name       String   // original filename / display name
  mimeType   String
  sizeBytes  Int
  storageKey String   // S3 object key
  status     String   @default("ready") // image → "ready"; document → "pending" (until Phase 2 ingests)
  error      String?
  isImageRef Boolean  @default(false)   // image kind only: use as a reference for image generation
  meta       Json?    // image: { width, height }; document: { pageCount? }
  createdAt  DateTime @default(now())

  @@index([accountId, kind])
}
```

Add the back-relation `resources Resource[]` to `LinkedInAccount`. Phase 2 adds `ResourceChunk` + changes document defaults to `pending → processing → ready`; the field is already `pending` for documents here, so Phase 2's ingester simply consumes them.

Repo functions in `packages/db` (mirroring existing repos): `createResource`, `listResources(accountId, kind?)`, `getResource(id, accountId)`, `deleteResource(id, accountId)`, `setResourceImageRef(id, accountId, on)`, `listImageReferences(accountId)`.

---

## 3. API Routes

New router `apps/api/src/routes/resources.ts`, mounted under the LinkedIn account namespace (all ownership-checked):

- `POST /linkedin/accounts/:accountId/resources` — multipart upload. Validates kind by mime (`image/*` → `image`, `application/pdf` + common doc types → `document`), size cap (e.g. 25 MB images, 50 MB docs), stores to S3, creates the `Resource` row (image → `ready`, document → `pending`). For images, read dimensions into `meta`.
- `GET /linkedin/accounts/:accountId/resources?kind=image|document` — list.
- `GET /linkedin/accounts/:accountId/resources/:id/content` — auth-gated stream (see §1).
- `DELETE /linkedin/accounts/:accountId/resources/:id` — delete row + S3 object.
- `PATCH /linkedin/accounts/:accountId/resources/:id/image-ref` — `{ on: boolean }`, image kind only, toggles `isImageRef`.

Allowed document mime types (Phase 1 stores them regardless of ingestability; Phase 2 handles extraction): `application/pdf`, `text/plain`, `text/markdown`. Reject others with a clear error.

---

## 4. Resources Tab (UI)

Add a `resources` tab to the account layout tabs (`accounts/[id]/layout.tsx`), between `profile` and `settings`: route `accounts/[id]/resources/page.tsx`. i18n keys `accounts.tab_resources` (en "Resources" / de "Ressourcen").

Two sections on the page:

- **Bilder** — thumbnail grid of `image` resources. Upload (drag-drop + file picker). Each tile: image, name, delete, and a **"Als Referenz nutzen"** toggle (`isImageRef`) with a small badge when active. Empty state invites upload.
- **Wissen** — list of `document` resources. Upload. Each row: filename, size, a **status badge** — Phase 1 documents show `pending` styled as e.g. "Abgelegt · Analyse folgt" (de) / "Stored · analysis coming" (en) with a muted tooltip explaining RAG activates in a later step. Delete. Empty state.

Design: follow the existing account-tab visual language (Linear-ish, tight, hover borders, the softened shadows). Full-width, `p-6` inside the tab's scroll container (the account layout already provides `min-h-0 flex-1 overflow-y-auto`). Upload uses the same `/api/...` proxy with `credentials: "include"`.

---

## 5. Image Generation Upgrades

In `packages/ai/src/compose.ts`, extend `generateImage`:

```ts
export async function generateImage(
  prompt: string,
  opts?: {
    model?: ImageModel
    postText?: string
    visualStyle?: string
    size?: "portrait" | "square" | "landscape"   // NEW → maps to gpt-image-1 sizes
    referenceImages?: Array<{ base64: string; mediaType: string }>  // NEW
  },
): Promise<{ base64: string; mediaType: string }>
```

- **LinkedIn formats (`size`):** default `portrait` → `1024x1536` (~4:5, maximizes feed real estate); `square` → `1024x1024`; `landscape` → `1536x1024`. Pass through the AI SDK image call's `size`/provider options. The profile-studio and draft-studio image calls request `portrait` by default.
- **References:** when `referenceImages` are provided, pass them as image inputs to `gpt-image-1` (image-edit / reference mode) so the output reflects the creator's look. **Caveat documented in code + UI:** exact facial likeness is unreliable with current image models; references work well as *style/subject* guidance, not as a guaranteed portrait.

Route wiring (`apps/api/src/routes/profile.ts` `createExampleImage`, and `apps/api/src/routes/studio.ts` image calls): before generating, load the account's active image references (`listImageReferences`) via the storage layer (fetch object bytes → base64), pass them + `size: "portrait"` into `generateImage`. Persist the generated image through the new storage layer (`saveImage` reimplemented on `putObject`), returning the content-route URL.

`saveImage` (currently `apps/api/src/images.ts`) is reimplemented to call `putObject("generated/{random}.{ext}", ...)` and return a URL to a generated-image content route. The disk `uploadsDir` + `GET /uploads/:name` are removed. All existing call sites keep the same `{ url }` return shape → no changes needed at call sites beyond what the reference feature adds.

---

## Data Flow (Phase 1)

**Upload image:** web upload → `POST …/resources` → `putObject(resources/{acct}/{id}.png)` → `Resource(kind=image, status=ready)`. Toggle "Als Referenz" → `isImageRef=true`.

**Generate example image (now reference-aware):** studio agent calls `generateExampleImage` → route loads active `isImageRef` images → base64 → `generateImage(direction, { postText, visualStyle, size:"portrait", referenceImages })` → `saveImage` (`putObject generated/…`) → content URL → canvas preview.

**Upload document:** web upload → `POST …/resources` → `putObject(resources/{acct}/{id}.pdf)` → `Resource(kind=document, status=pending)`. Listed under Wissen as "Abgelegt · Analyse folgt". (Phase 2 will ingest all `pending`.)

---

## Testing (Phase 1)

Follow the repo's E2E pattern (signup → seed account → act → assert → cleanup; `Origin` header; api on :8787). Cover:

- Storage module round-trip against MinIO: `putObject` → `getObject` returns same bytes + content type; `deleteObject` removes it; bucket auto-created.
- `POST resources` (image) → row `kind=image status=ready`, object exists in S3; `GET …/content` streams bytes with correct mime; cross-user access → 404.
- `POST resources` (pdf) → row `kind=document status=pending`.
- `PATCH …/image-ref` toggles `isImageRef`; `listImageReferences` returns only toggled images.
- `DELETE` removes both row and S3 object.
- `generateImage` unit: `size` maps to the right dimension; `referenceImages` are passed to the model (assert via a mock image model). Reuse `packages/ai/src/testing.ts` mock shapes.
- Web typecheck clean; Resources tab renders (page 200 through the proxy).

---

## Success Criteria

- MinIO runs in docker-compose; all binary assets (uploaded + generated) live in S3, none on local disk; the old `/uploads` path is gone.
- I can upload photos + PDFs to a per-account Resources tab, mark photos as references, and delete them.
- Generated example-post images use `portrait` LinkedIn sizing and are influenced by my reference photos.
- Uploaded PDFs are safely stored and listed, awaiting Phase 2 ingestion.
- Private resources are auth-gated (not publicly fetchable).
