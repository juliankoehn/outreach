# Resources — Phase 1 (Assets & Storage) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-account Resources store (images + documents) backed by S3-compatible object storage (MinIO), with a Resources tab, image references that steer image generation, and LinkedIn-format image output.

**Architecture:** New `Resource` Prisma model owned by `LinkedInAccount`. Binary assets live in MinIO via a small S3 wrapper (`apps/api/src/storage.ts`), replacing the local-disk `uploads/`. Account-scoped Hono routes handle upload/list/stream/delete. Image generation gains a `size` (LinkedIn formats) and a `referenceHint` derived from the creator's tagged reference photos via the existing vision model. A Resources tab exposes it all. Documents are stored `pending` — ingestion/RAG is Phase 2.

**Tech Stack:** pnpm/Turborepo, Hono + Better Auth, Prisma 7 (pg adapter), AI SDK v7 (`gpt-image-1`), Next.js 16 + next-intl + shadcn, `@aws-sdk/client-s3`, MinIO (docker-compose).

## Global Constraints

- ESM with explicit `.js` import specifiers; `verbatimModuleSyntax`. TS 7 native (`declaration:false`; pure-node pkgs use `"types":["node"]`).
- Prisma 7: client generated to `packages/db/src/generated/prisma`; import `{ prisma }` and model types from `@outreach/db`. Migrations via `pnpm --filter @outreach/db exec prisma migrate dev --name <n>` (needs `DATABASE_URL`).
- AI SDK v7: `generateImage as genImage from "ai"`; `gpt-image-1` sizes are `"1024x1024" | "1024x1536" | "1536x1024"`. Vision file parts: `{ type:"file", data: <base64|URL>, mediaType }`. Test mocks in `packages/ai/src/testing.ts`.
- API is account-scoped with ownership checks: `const acct = await getAccountSummary(id, user.id); if (!acct) return c.json({error:"not_found"},404)`. Routers are `new Hono<AppEnv>()`, mounted in `apps/api/src/app.ts`.
- Web → API through `/api/[...proxy]` (cookies forwarded). App pages full-width `p-6`. i18n en+de, no literal `<`/`{`/`}` in plain ICU strings. Softer shadow tokens already set.
- Never run `next build` while `next dev` runs. Restart api after api/db edits (`tsx watch` is unreliable). Validate via `tsc --noEmit` + curl. Auth needs `Origin: http://localhost:3000`.
- Do NOT commit unless the user explicitly asks. (This overrides the skill's per-task `git commit` steps — run the `git add` to stage, but only commit when the user says so. Where steps below say "Commit", stage and pause for the user unless they've okayed committing.)

---

## Task 1: Object storage layer (MinIO + S3 wrapper)

**Files:**
- Modify: `docker-compose.yml`
- Modify: `apps/api/package.json` (add `@aws-sdk/client-s3`)
- Modify: `.env` / `.env.example` (root + `apps/api` as used) — S3 vars
- Create: `apps/api/src/storage.ts`
- Test: `apps/api/src/storage.test.ts`

**Interfaces:**
- Produces: `putObject(key, body: Buffer, contentType): Promise<{key}>`, `getObject(key): Promise<{body: Uint8Array; contentType: string} | null>`, `deleteObject(key): Promise<void>` from `apps/api/src/storage.ts`.

- [ ] **Step 1: Add MinIO to docker-compose**

```yaml
# docker-compose.yml — add under services:, and `miniodata` under volumes:
  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: outreach
      MINIO_ROOT_PASSWORD: outreach-secret
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - miniodata:/data
```
Add `miniodata:` to the `volumes:` mapping (next to `pgdata:`).

- [ ] **Step 2: Bring MinIO up and add env**

Run: `docker compose up -d minio`
Add to the api env (`.env` at repo root, read by `apps/api`):
```
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_ACCESS_KEY=outreach
S3_SECRET_KEY=outreach-secret
S3_BUCKET=outreach-resources
S3_FORCE_PATH_STYLE=true
```

- [ ] **Step 3: Add the dependency**

Run: `pnpm --filter @outreach/api add @aws-sdk/client-s3`

- [ ] **Step 4: Write the failing test**

```ts
// apps/api/src/storage.test.ts
import { describe, it, expect } from "vitest";
import { putObject, getObject, deleteObject } from "./storage.js";

describe("storage", () => {
  it("round-trips an object and deletes it", async () => {
    const key = `test/${Date.now()}-${Math.random().toString(36).slice(2)}.txt`;
    const body = Buffer.from("hello resources");
    await putObject(key, body, "text/plain");

    const got = await getObject(key);
    expect(got).not.toBeNull();
    expect(Buffer.from(got!.body).toString()).toBe("hello resources");
    expect(got!.contentType).toBe("text/plain");

    await deleteObject(key);
    expect(await getObject(key)).toBeNull();
  });
});
```

- [ ] **Step 5: Run it to confirm it fails**

Run: `pnpm --filter @outreach/api exec vitest run src/storage.test.ts`
Expected: FAIL (module `./storage.js` not found).

- [ ] **Step 6: Implement the storage module**

```ts
// apps/api/src/storage.ts
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from "@aws-sdk/client-s3";

const bucket = process.env.S3_BUCKET ?? "outreach-resources";

const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT ?? "http://localhost:9000",
  region: process.env.S3_REGION ?? "us-east-1",
  forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true") === "true",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY ?? "outreach",
    secretAccessKey: process.env.S3_SECRET_KEY ?? "outreach-secret",
  },
});

let bucketReady: Promise<void> | null = null;
function ensureBucket(): Promise<void> {
  bucketReady ??= (async () => {
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
    }
  })();
  return bucketReady;
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<{ key: string }> {
  await ensureBucket();
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
  return { key };
}

export async function getObject(key: string): Promise<{ body: Uint8Array; contentType: string } | null> {
  await ensureBucket();
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = await res.Body!.transformToByteArray();
    return { body, contentType: res.ContentType ?? "application/octet-stream" };
  } catch (e: unknown) {
    const name = (e as { name?: string })?.name;
    if (name === "NoSuchKey" || name === "NotFound") return null;
    throw e;
  }
}

export async function deleteObject(key: string): Promise<void> {
  await ensureBucket();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
```

- [ ] **Step 7: Run the test to green**

Run: `pnpm --filter @outreach/api exec vitest run src/storage.test.ts`
Expected: PASS.

- [ ] **Step 8: Typecheck + stage**

Run: `pnpm --filter @outreach/api exec tsc --noEmit` → 0 errors.
Stage: `git add docker-compose.yml apps/api/src/storage.ts apps/api/src/storage.test.ts apps/api/package.json pnpm-lock.yaml .env.example`
Commit message (commit only if user okayed): `feat(api): S3-compatible object storage (MinIO)`

---

## Task 2: `Resource` model + repo

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Modify: `packages/db/src/index.ts` (export `Resource` type)
- Create: `apps/api/src/repos/resource.ts`
- Test: `apps/api/src/repos/resource.test.ts`

**Interfaces:**
- Consumes: `putObject/deleteObject` (Task 1) — not here, in Task 3.
- Produces (from `apps/api/src/repos/resource.ts`): `createResource(input)`, `listResources(accountId, kind?)`, `getResource(id, accountId)`, `deleteResource(id, accountId)`, `setResourceImageRef(id, accountId, on, refDescription?)`, `listImageReferences(accountId)`. `Resource` type from `@outreach/db`.

- [ ] **Step 1: Add the model**

```prisma
// packages/db/prisma/schema.prisma — new model + back-relation on LinkedInAccount
model Resource {
  id         String   @id @default(cuid())
  accountId  String
  account    LinkedInAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)
  kind       String   // "image" | "document"
  name       String
  mimeType   String
  sizeBytes  Int
  storageKey String
  status     String   @default("ready") // document rows are created as "pending"
  error      String?
  isImageRef Boolean  @default(false)
  meta       Json?
  createdAt  DateTime @default(now())

  @@index([accountId, kind])
}
```
On `model LinkedInAccount { ... }` add: `resources Resource[]`.

- [ ] **Step 2: Migrate + regenerate**

Run: `pnpm --filter @outreach/db exec prisma migrate dev --name add_resource`
Then: `pnpm --filter @outreach/db exec prisma generate`
Expected: migration applied, client regenerated.

- [ ] **Step 3: Export the type**

In `packages/db/src/index.ts`, add `Resource,` to the `export type { ... } from "./generated/prisma/client.js";` list.

- [ ] **Step 4: Write the failing repo test**

```ts
// apps/api/src/repos/resource.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@outreach/db";
import {
  createResource, listResources, getResource, deleteResource,
  setResourceImageRef, listImageReferences,
} from "./resource.js";

let userId = "", accountId = "";
beforeAll(async () => {
  const u = await prisma.user.create({ data: { email: `r${Date.now()}@ex.com`, name: "R" } });
  userId = u.id;
  const a = await prisma.linkedInAccount.create({
    data: { userId, memberUrn: `urn:li:person:${Date.now()}`, displayName: "T", accessToken: "e", scopes: [] },
  });
  accountId = a.id;
});
afterAll(async () => { await prisma.user.delete({ where: { id: userId } }); await prisma.$disconnect(); });

describe("resource repo", () => {
  it("creates, lists by kind, toggles ref, deletes", async () => {
    const img = await createResource({ accountId, kind: "image", name: "me.png", mimeType: "image/png", sizeBytes: 10, storageKey: "k1", status: "ready" });
    await createResource({ accountId, kind: "document", name: "grundschutz.pdf", mimeType: "application/pdf", sizeBytes: 99, storageKey: "k2", status: "pending" });

    expect((await listResources(accountId, "image")).length).toBe(1);
    expect((await listResources(accountId, "document")).length).toBe(1);
    expect((await listResources(accountId)).length).toBe(2);

    await setResourceImageRef(img.id, accountId, true, "a person with short dark hair");
    const refs = await listImageReferences(accountId);
    expect(refs.map((r) => r.id)).toEqual([img.id]);
    expect((refs[0]!.meta as { refDescription?: string }).refDescription).toContain("dark hair");

    expect(await getResource(img.id, "nope")).toBeNull();
    await deleteResource(img.id, accountId);
    expect(await getResource(img.id, accountId)).toBeNull();
  });
});
```

- [ ] **Step 5: Run it to confirm it fails**

Run: `pnpm --filter @outreach/api exec vitest run src/repos/resource.test.ts`
Expected: FAIL (`./resource.js` not found).

- [ ] **Step 6: Implement the repo**

```ts
// apps/api/src/repos/resource.ts
import { prisma } from "@outreach/db";
import type { Resource } from "@outreach/db";

export interface CreateResourceInput {
  accountId: string; kind: "image" | "document"; name: string;
  mimeType: string; sizeBytes: number; storageKey: string;
  status?: string; meta?: object;
}

export function createResource(input: CreateResourceInput): Promise<Resource> {
  return prisma.resource.create({
    data: {
      accountId: input.accountId, kind: input.kind, name: input.name,
      mimeType: input.mimeType, sizeBytes: input.sizeBytes, storageKey: input.storageKey,
      status: input.status ?? "ready", meta: (input.meta as object | undefined) ?? undefined,
    },
  });
}

export function listResources(accountId: string, kind?: "image" | "document"): Promise<Resource[]> {
  return prisma.resource.findMany({
    where: { accountId, ...(kind ? { kind } : {}) },
    orderBy: { createdAt: "desc" },
  });
}

export function getResource(id: string, accountId: string): Promise<Resource | null> {
  return prisma.resource.findFirst({ where: { id, accountId } });
}

export async function deleteResource(id: string, accountId: string): Promise<Resource | null> {
  const r = await getResource(id, accountId);
  if (!r) return null;
  await prisma.resource.delete({ where: { id } });
  return r;
}

export async function setResourceImageRef(
  id: string, accountId: string, on: boolean, refDescription?: string,
): Promise<Resource | null> {
  const r = await prisma.resource.findFirst({ where: { id, accountId, kind: "image" } });
  if (!r) return null;
  const meta = { ...((r.meta as object | null) ?? {}), ...(refDescription ? { refDescription } : {}) };
  return prisma.resource.update({ where: { id }, data: { isImageRef: on, meta } });
}

export function listImageReferences(accountId: string): Promise<Resource[]> {
  return prisma.resource.findMany({ where: { accountId, kind: "image", isImageRef: true } });
}
```

- [ ] **Step 7: Run the test to green + typecheck**

Run: `pnpm --filter @outreach/api exec vitest run src/repos/resource.test.ts` → PASS.
Run: `pnpm --filter @outreach/db exec tsc --noEmit` and `pnpm --filter @outreach/api exec tsc --noEmit` → 0 errors.

- [ ] **Step 8: Stage**

Stage schema, migration dir, generated client changes, index.ts, repo + test.
Commit message: `feat(db): Resource model + repo`

---

## Task 3: Resources API routes

**Files:**
- Create: `apps/api/src/routes/resources.ts`
- Modify: `apps/api/src/app.ts` (mount)
- Test: `apps/api/src/routes/resources.test.ts`

**Interfaces:**
- Consumes: storage (Task 1), resource repo (Task 2), `getAccountSummary(id, userId)` from `../repos/linkedin-account.js`.
- Produces: mounted routes under `/linkedin/accounts/:accountId/resources`.

- [ ] **Step 1: Write the failing route test**

```ts
// apps/api/src/routes/resources.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@outreach/db";
import { createApp } from "../app.js";

let userId = "", accountId = "", cookie = "";
const app = createApp();

async function signup() {
  const email = `res${Date.now()}-${Math.random().toString(36).slice(2)}@ex.com`;
  const res = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: process.env.WEB_ORIGIN! },
    body: JSON.stringify({ email, password: "password-1234", name: "R" }),
  });
  return { cookie: res.headers.get("set-cookie")!.split(";")[0]!, email };
}

beforeAll(async () => {
  const s = await signup(); cookie = s.cookie;
  userId = (await prisma.user.findFirstOrThrow({ where: { email: s.email } })).id;
  accountId = (await prisma.linkedInAccount.create({
    data: { userId, memberUrn: `urn:li:person:${Date.now()}`, displayName: "T", accessToken: "e", scopes: [] },
  })).id;
});
afterAll(async () => { await prisma.user.delete({ where: { id: userId } }); await prisma.$disconnect(); });

function upload(kind: "image" | "document") {
  const fd = new FormData();
  const [bytes, name, type] = kind === "image"
    ? [new Uint8Array([137, 80, 78, 71]), "me.png", "image/png"]
    : [new TextEncoder().encode("norm text"), "norm.pdf", "application/pdf"];
  fd.set("file", new File([bytes], name, { type }));
  return app.request(`/linkedin/accounts/${accountId}/resources`, { method: "POST", headers: { Cookie: cookie }, body: fd });
}

describe("resources routes", () => {
  it("uploads image + document, lists, streams, deletes", async () => {
    const up = await upload("image");
    expect(up.status).toBe(200);
    const { resource } = (await up.json()) as { resource: { id: string; kind: string; status: string } };
    expect(resource.kind).toBe("image");
    expect(resource.status).toBe("ready");

    const doc = await upload("document");
    expect(((await doc.json()) as { resource: { status: string } }).resource.status).toBe("pending");

    const list = await app.request(`/linkedin/accounts/${accountId}/resources?kind=image`, { headers: { Cookie: cookie } });
    expect(((await list.json()) as { resources: unknown[] }).resources.length).toBe(1);

    const content = await app.request(`/linkedin/accounts/${accountId}/resources/${resource.id}/content`, { headers: { Cookie: cookie } });
    expect(content.status).toBe(200);
    expect(content.headers.get("content-type")).toContain("image/png");

    const del = await app.request(`/linkedin/accounts/${accountId}/resources/${resource.id}`, { method: "DELETE", headers: { Cookie: cookie } });
    expect(del.status).toBe(200);
  });

  it("rejects cross-user access", async () => {
    const other = await signup();
    const res = await app.request(`/linkedin/accounts/${accountId}/resources`, { headers: { Cookie: other.cookie } });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @outreach/api exec vitest run src/routes/resources.test.ts`
Expected: FAIL (404 / route missing).

- [ ] **Step 3: Implement the router**

```ts
// apps/api/src/routes/resources.ts
import { Hono } from "hono";
import type { AppEnv } from "../app.js";
import { getAccountSummary } from "../repos/linkedin-account.js";
import { putObject, getObject, deleteObject } from "../storage.js";
import {
  createResource, listResources, getResource, deleteResource, setResourceImageRef,
} from "../repos/resource.js";

const MAX_IMAGE = 25 * 1024 * 1024;
const MAX_DOC = 50 * 1024 * 1024;
const DOC_TYPES = new Set(["application/pdf", "text/plain", "text/markdown"]);
const EXT: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp",
  "application/pdf": "pdf", "text/plain": "txt", "text/markdown": "md",
};

export function resourcesRoutes() {
  const r = new Hono<AppEnv>();

  async function owned(c: Parameters<Parameters<typeof r.get>[1]>[0]) {
    const user = c.get("user")!;
    const accountId = c.req.param("accountId");
    const acct = await getAccountSummary(accountId, user.id);
    return acct ? accountId : null;
  }

  r.post("/accounts/:accountId/resources", async (c) => {
    const accountId = await owned(c);
    if (!accountId) return c.json({ error: "not_found" }, 404);

    const body = await c.req.parseBody();
    const file = body["file"];
    if (!(file instanceof File)) return c.json({ error: "no_file" }, 400);

    const mime = file.type || "application/octet-stream";
    const isImage = mime.startsWith("image/");
    const kind: "image" | "document" = isImage ? "image" : "document";
    if (!isImage && !DOC_TYPES.has(mime)) return c.json({ error: "unsupported_type" }, 415);

    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.byteLength > (isImage ? MAX_IMAGE : MAX_DOC)) return c.json({ error: "too_large" }, 413);

    const ext = EXT[mime] ?? "bin";
    // Placeholder id via storage key; row id assigned by DB. Use a random key.
    const key = `resources/${accountId}/${crypto.randomUUID()}.${ext}`;
    await putObject(key, buf, mime);

    const resource = await createResource({
      accountId, kind, name: file.name || `upload.${ext}`, mimeType: mime,
      sizeBytes: buf.byteLength, storageKey: key,
      status: isImage ? "ready" : "pending",
    });
    return c.json({ resource });
  });

  r.get("/accounts/:accountId/resources", async (c) => {
    const accountId = await owned(c);
    if (!accountId) return c.json({ error: "not_found" }, 404);
    const kindParam = c.req.query("kind");
    const kind = kindParam === "image" || kindParam === "document" ? kindParam : undefined;
    return c.json({ resources: await listResources(accountId, kind) });
  });

  r.get("/accounts/:accountId/resources/:id/content", async (c) => {
    const accountId = await owned(c);
    if (!accountId) return c.json({ error: "not_found" }, 404);
    const res = await getResource(c.req.param("id"), accountId);
    if (!res) return c.json({ error: "not_found" }, 404);
    const obj = await getObject(res.storageKey);
    if (!obj) return c.json({ error: "not_found" }, 404);
    return new Response(obj.body, { headers: { "Content-Type": obj.contentType, "Cache-Control": "private, max-age=3600" } });
  });

  r.patch("/accounts/:accountId/resources/:id/image-ref", async (c) => {
    const accountId = await owned(c);
    if (!accountId) return c.json({ error: "not_found" }, 404);
    const { on } = await c.req.json<{ on: boolean }>().catch(() => ({ on: false }));
    // refDescription is filled in Task 5 (vision). Here just toggle.
    const updated = await setResourceImageRef(c.req.param("id"), accountId, on);
    if (!updated) return c.json({ error: "not_found" }, 404);
    return c.json({ resource: updated });
  });

  r.delete("/accounts/:accountId/resources/:id", async (c) => {
    const accountId = await owned(c);
    if (!accountId) return c.json({ error: "not_found" }, 404);
    const removed = await deleteResource(c.req.param("id"), accountId);
    if (!removed) return c.json({ error: "not_found" }, 404);
    await deleteObject(removed.storageKey);
    return c.json({ ok: true });
  });

  return r;
}
```

- [ ] **Step 4: Mount it**

In `apps/api/src/app.ts`, import `{ resourcesRoutes } from "./routes/resources.js";` and, after the existing `app.route("/linkedin", linkedinRoutes());` (inside the same authenticated group), add `app.route("/linkedin", resourcesRoutes());`.

- [ ] **Step 5: Run the test to green + typecheck**

Run: `pnpm --filter @outreach/api exec vitest run src/routes/resources.test.ts` → PASS (MinIO must be up).
Run: `pnpm --filter @outreach/api exec tsc --noEmit` → 0 errors.

- [ ] **Step 6: Stage**

Commit message: `feat(api): resources upload/list/stream/delete routes`

---

## Task 4: Migrate generated images to storage (drop local `/uploads`)

**Files:**
- Rewrite: `apps/api/src/images.ts` (`saveImage` on top of `putObject`)
- Modify: `apps/api/src/app.ts` (replace `GET /uploads/:name` with a generated-image content route; drop disk imports)
- Test: `apps/api/src/images.test.ts`

**Interfaces:**
- Consumes: `putObject/getObject` (Task 1).
- Produces: `saveImage(base64, mediaType): Promise<{ url: string }>` returning a URL to `GET /generated/:name`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/images.test.ts
import { describe, it, expect } from "vitest";
import { saveImage } from "./images.js";
import { getObject } from "./storage.js";

describe("saveImage", () => {
  it("stores a base64 image in object storage and returns a /generated url", async () => {
    const b64 = Buffer.from([137, 80, 78, 71]).toString("base64");
    const { url } = await saveImage(b64, "image/png");
    expect(url).toMatch(/^\/generated\/[a-f0-9-]+\.png$/);
    const key = "generated/" + url.split("/").pop();
    expect(await getObject(key)).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @outreach/api exec vitest run src/images.test.ts`
Expected: FAIL (old `saveImage` writes to disk / returns `/uploads/...`).

- [ ] **Step 3: Rewrite `images.ts`**

```ts
// apps/api/src/images.ts
import { randomUUID } from "node:crypto";
import { putObject } from "./storage.js";

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export async function saveImage(base64: string, mediaType: string): Promise<{ url: string }> {
  const ext = EXT[mediaType] ?? "png";
  const name = `${randomUUID()}.${ext}`;
  await putObject(`generated/${name}`, Buffer.from(base64, "base64"), mediaType);
  return { url: `/generated/${name}` };
}
```

- [ ] **Step 4: Replace the `/uploads` route with `/generated`**

In `apps/api/src/app.ts`: remove the `GET /uploads/:name` handler and its disk-based imports (`readFile`, `uploadsDir`, `normalize`, `sep`, `join`, `CONTENT_TYPES`). Add a public generated-image route (generated images are non-sensitive; keep them unauthenticated so `<img>` works simply):
```ts
import { getObject } from "./storage.js";
// ...
app.get("/generated/:name", async (c) => {
  const name = c.req.param("name");
  if (name.includes("/") || name.includes("\\")) return c.json({ error: "not_found" }, 404);
  const obj = await getObject(`generated/${name}`);
  if (!obj) return c.json({ error: "not_found" }, 404);
  return new Response(obj.body, { headers: { "Content-Type": obj.contentType, "Cache-Control": "public, max-age=31536000" } });
});
```

- [ ] **Step 5: Update the web `/uploads` proxy → `/generated`**

The web currently serves generated images via `apps/web/src/app/uploads/[...file]/route.ts`. Rename/retarget it to `apps/web/src/app/generated/[...file]/route.ts` forwarding to the API `/generated/...`. (Generated image URLs are now `/generated/...`; existing `<img src>` values come straight from `saveImage`, so no component change is needed.)

- [ ] **Step 6: Run tests to green + typecheck**

Run: `pnpm --filter @outreach/api exec vitest run src/images.test.ts` → PASS.
Run: `pnpm --filter @outreach/api exec tsc --noEmit` → 0 errors.

- [ ] **Step 7: Stage**

Commit message: `refactor(api): generated images to object storage, drop disk uploads`

---

## Task 5: Image generation — LinkedIn sizes + reference hints

**Files:**
- Modify: `packages/ai/src/compose.ts` (`generateImage` opts)
- Create: `packages/ai/src/references.ts` (`describeImageReferences`)
- Modify: `packages/ai/src/index.ts` (export `describeImageReferences`)
- Modify: `apps/api/src/routes/resources.ts` (compute `refDescription` on ref-toggle ON)
- Modify: `apps/api/src/routes/profile.ts` (`createExampleImage` uses refs + `size`)
- Modify: `apps/api/src/routes/studio.ts` (image calls use refs + `size`)
- Test: `packages/ai/src/compose.test.ts` (size mapping + hint injection)

**Interfaces:**
- Consumes: resource repo `listImageReferences`, storage `getObject`, vision via `getTextModel`.
- Produces: `generateImage(prompt, { ..., size?, referenceHint? })`; `describeImageReferences(images): Promise<string>`.

- [ ] **Step 1: Write the failing test for `generateImage`**

```ts
// packages/ai/src/compose.test.ts
import { describe, it, expect } from "vitest";
import { MockImageModel } from "./testing.js"; // add if missing (see Step 2)
import { generateImage } from "./compose.js";

describe("generateImage", () => {
  it("maps size to LinkedIn dimensions and injects the reference hint", async () => {
    let seenSize: string | undefined, seenPrompt = "";
    const model = new MockImageModel(({ size, prompt }) => { seenSize = size; seenPrompt = prompt; });
    await generateImage("a shield", { model, size: "portrait", referenceHint: "short dark hair, navy blazer" });
    expect(seenSize).toBe("1024x1536");
    expect(seenPrompt).toContain("short dark hair");
  });
});
```

- [ ] **Step 2: Add a `MockImageModel` to `packages/ai/src/testing.ts`**

Provide a minimal `ImageModelV3` mock capturing `{ prompt, size }` and returning one base64 image (`"iVBORw0KGgo="`), mirroring the existing `MockLanguageModelV3` style already in that file. (Inspect the installed `@ai-sdk/provider` `ImageModelV3` shape and implement `doGenerate` to call the provided spy and return `{ images: [base64], warnings: [] }`.)

- [ ] **Step 3: Run it to confirm it fails**

Run: `pnpm --filter @outreach/ai exec vitest run src/compose.test.ts`
Expected: FAIL (opts unsupported / mock missing).

- [ ] **Step 4: Extend `generateImage`**

```ts
// packages/ai/src/compose.ts — replace the generateImage signature/body
const SIZE_MAP = { portrait: "1024x1536", square: "1024x1024", landscape: "1536x1024" } as const;

export async function generateImage(
  prompt: string,
  opts?: {
    model?: ImageModel; postText?: string; visualStyle?: string;
    size?: "portrait" | "square" | "landscape";
    referenceHint?: string;
  },
): Promise<{ base64: string; mediaType: string }> {
  const model = opts?.model ?? getImageModel();
  const parts: string[] = [];
  if (opts?.postText) {
    parts.push(`Create an image to accompany this LinkedIn post. Make it visually relevant to the post's message; no text or captions in the image unless asked.\n\nLinkedIn post:\n"""${opts.postText}"""`);
  }
  if (opts?.visualStyle?.trim()) parts.push(`Match this creator's established visual language: ${opts.visualStyle.trim()}`);
  if (opts?.referenceHint?.trim()) parts.push(`If a person appears, resemble this reference (style/subject guidance, not an exact likeness): ${opts.referenceHint.trim()}`);
  parts.push(`Image direction: ${prompt}`);
  const fullPrompt = parts.length > 1 ? parts.join("\n\n") : prompt;
  const { image } = await genImage({ model, prompt: fullPrompt, size: SIZE_MAP[opts?.size ?? "portrait"] });
  return { base64: image.base64, mediaType: image.mediaType ?? "image/png" };
}
```

- [ ] **Step 5: Implement `describeImageReferences`**

```ts
// packages/ai/src/references.ts
import { generateText, type LanguageModel } from "ai";
import { getTextModel } from "./provider.js";

// Vision-derived, cached appearance/style descriptor for reference photos.
// Kept short so it can be concatenated into image prompts cheaply.
export async function describeImageReferences(
  images: Array<{ base64: string; mediaType: string }>,
  opts?: { model?: LanguageModel },
): Promise<string> {
  if (images.length === 0) return "";
  const content: Array<{ type: "text"; text: string } | { type: "file"; data: string; mediaType: string }> = [
    { type: "text", text: "Describe the person/subject and visual style in these reference photos in 1-2 sentences — appearance, palette, mood, setting — for reuse as image-generation guidance. No names, no assumptions beyond what's visible." },
  ];
  for (const img of images) content.push({ type: "file", data: img.base64, mediaType: img.mediaType });
  const { text } = await generateText({ model: opts?.model ?? getTextModel(), messages: [{ role: "user", content }] });
  return text.trim();
}
```
Export it from `packages/ai/src/index.ts`.

- [ ] **Step 6: Compute `refDescription` on ref-toggle ON**

In `apps/api/src/routes/resources.ts`, update the `image-ref` PATCH: when `on === true`, load the image bytes (`getObject(res.storageKey)`), call `describeImageReferences([{ base64, mediaType }])`, and pass the result into `setResourceImageRef(..., true, description)`. When `on === false`, just toggle off. (Import `describeImageReferences` from `@outreach/ai`, `getObject` already imported.)

- [ ] **Step 7: Wire references + size into image generation**

In `apps/api/src/routes/profile.ts` `createExampleImage`: before `generateImage`, load `listImageReferences(id-as-account?)`. NOTE: profile studio is account-scoped via the profile's account — load the account id from the profile, then `listImageReferences(accountId)`, map each ref's `meta.refDescription` into a single joined `referenceHint`, and pass `{ ..., size: "portrait", referenceHint }`. In `apps/api/src/routes/studio.ts`, do the same for its two `generateImage` calls (account id is already in scope there).

- [ ] **Step 8: Run tests to green + typecheck**

Run: `pnpm --filter @outreach/ai exec vitest run src/compose.test.ts` → PASS.
Run: `pnpm --filter @outreach/ai exec tsc --noEmit`, `pnpm --filter @outreach/api exec tsc --noEmit` → 0 errors.

- [ ] **Step 9: Stage**

Commit message: `feat(ai): LinkedIn image sizes + reference-guided generation`

---

## Task 6: Resources tab (UI) + upload proxy fix + i18n

**Files:**
- Modify: `apps/web/src/app/api/[...proxy]/route.ts` (binary-safe body)
- Modify: `apps/web/src/app/(app)/accounts/[id]/layout.tsx` (add tab)
- Create: `apps/web/src/app/(app)/accounts/[id]/resources/page.tsx`
- Create: `apps/web/src/app/(app)/accounts/[id]/resources/resources-tab.tsx` (client)
- Modify: `apps/web/messages/en.json`, `apps/web/messages/de.json`

**Interfaces:**
- Consumes: resources API via `/api/linkedin/accounts/:id/resources...`.

- [ ] **Step 1: Fix the proxy to preserve binary bodies**

In `apps/web/src/app/api/[...proxy]/route.ts`, change the forwarded body from `await req.text()` to `await req.arrayBuffer()` for non-GET/HEAD:
```ts
body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),
```
(Preserves multipart/binary uploads; JSON POSTs are unaffected.)

- [ ] **Step 2: Add the tab**

In `accounts/[id]/layout.tsx`, insert into the `tabs` array between `profile` and `settings`:
```ts
{ key: "resources", href: `/accounts/${id}/resources` },
```

- [ ] **Step 3: Add i18n keys**

`apps/web/messages/en.json` under `accounts`: `"tab_resources": "Resources"`. Under a new `resources` top-level object (mirror the `profile` block style):
```json
"resources": {
  "title": "Resources",
  "images": "Images",
  "knowledge": "Knowledge",
  "uploadImage": "Upload image",
  "uploadDoc": "Upload document",
  "useAsReference": "Use as reference",
  "referenceOn": "Reference",
  "imagesEmpty": "Upload photos of yourself or brand imagery — the AI uses them to steer generated post images.",
  "knowledgeEmpty": "Upload PDFs (norms, laws, guidelines). They're stored now; grounded post generation activates in a later step.",
  "docPendingBadge": "Stored · analysis coming",
  "delete": "Delete"
}
```
`apps/web/messages/de.json`: `"tab_resources": "Ressourcen"` and the German `resources` block (title "Ressourcen", images "Bilder", knowledge "Wissen", uploadImage "Bild hochladen", uploadDoc "Dokument hochladen", useAsReference "Als Referenz nutzen", referenceOn "Referenz", imagesEmpty "Lade Fotos von dir oder Markenbilder hoch — die KI nutzt sie, um generierte Post-Bilder zu steuern.", knowledgeEmpty "Lade PDFs hoch (Normen, Gesetze, Richtlinien). Sie werden jetzt abgelegt; fundierte Post-Generierung folgt in einem späteren Schritt.", docPendingBadge "Abgelegt · Analyse folgt", delete "Löschen"). No literal `<`/`{`/`}` in any string.

- [ ] **Step 4: Page shell**

```tsx
// apps/web/src/app/(app)/accounts/[id]/resources/page.tsx
import { use } from "react";
import { ResourcesTab } from "./resources-tab";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ResourcesTab accountId={id} />;
}
```

- [ ] **Step 5: Client tab — implement `resources-tab.tsx`**

Build a client component with two sections following the account-tab visual language (full-width, `p-6` inside the layout's scroll container, softened shadows, hover borders). Requirements:
- On mount, `fetch('/api/linkedin/accounts/${accountId}/resources', { credentials:'include' })` and split by `kind`.
- **Images:** thumbnail grid (`<img src={`/api/linkedin/accounts/${accountId}/resources/${r.id}/content`} />`), a "Use as reference" toggle → `PATCH .../image-ref { on }`, a `Reference` badge when `isImageRef`, delete button → `DELETE`.
- **Knowledge:** rows with filename, size, a muted `docPendingBadge`, delete.
- Upload: a hidden `<input type="file">` per section; on change, POST `FormData` with the file to `.../resources` (`credentials:'include'`), then refresh the list. Accept `image/*` for Images, `.pdf,.txt,.md` for Knowledge.
- Use existing UI primitives (`Button`, `Card`, `Badge`, `Skeleton`) and `useTranslations()`. Empty states use the i18n copy above.

- [ ] **Step 6: Typecheck + serve check**

Run: `pnpm --filter @outreach/web exec tsc --noEmit` → 0 errors.
With web + api dev running, curl the page: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/accounts/<realId>/resources` → 200.

- [ ] **Step 7: Stage**

Commit message: `feat(web): Resources tab (images + knowledge), binary-safe upload proxy`

---

## Task 7: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Full typecheck sweep**

Run: `pnpm -r exec tsc --noEmit` (or per-package for ai/api/web/db) → 0 errors everywhere.

- [ ] **Step 2: Test sweep**

Run: `pnpm --filter @outreach/api exec vitest run` and `pnpm --filter @outreach/ai exec vitest run` → all pass (MinIO + Postgres up).

- [ ] **Step 3: Manual E2E (scratchpad script)**

Signup → create account → upload an image + a PDF via the API → toggle the image as reference (assert `refDescription` populated in `meta`) → generate an example image through the profile studio and assert the returned URL is `/generated/...` and streams 200 → delete resources → cleanup user. Confirm the old `/uploads/:name` route is gone (404) and `/generated/:name` serves.

- [ ] **Step 4: Report**

Summarize what shipped, test/typecheck results, and the two documented caveats (likeness is style/subject-level; documents are stored `pending` awaiting Phase 2). Do not commit unless the user asks.
