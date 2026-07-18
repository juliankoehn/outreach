# Foundation + LinkedIn Connect + Post Ingestion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user can log in, connect one or more LinkedIn accounts via OAuth, and pull their existing posts into the database (via API where permitted, otherwise via LinkedIn's `Shares.csv` data export).

**Architecture:** Turborepo monorepo. A single Hono backend (`apps/api`) owns all business logic, the database, auth (Better Auth), and encrypted LinkedIn tokens. `apps/web` (Next.js) is a UI-only client that proxies to the API. `apps/worker` and `apps/desktop` are scaffolded but inert in this sub-project. Shared logic lives in `packages/*` (`core`, `db`, `linkedin`).

**Tech Stack:** pnpm workspaces + Turborepo, TypeScript (strict, ESM), Hono + @hono/node-server, Better Auth, Prisma + PostgreSQL, Vitest, Zod, Next.js (App Router). Node 22+.

## Global Constraints

- **Package manager:** pnpm (workspaces). Root is private; every package/app has its own `package.json`.
- **Module system:** ESM everywhere (`"type": "module"`). TypeScript `moduleResolution: "bundler"`, `strict: true`, `noUncheckedIndexedAccess: true`.
- **Test runner:** Vitest for all unit/integration tests. Test files are colocated as `*.test.ts` next to source.
- **Secrets never in plaintext:** LinkedIn OAuth tokens are encrypted at rest with AES-256-GCM. Only `apps/api` en/decrypts.
- **Fail fast on config:** missing required env vars abort process start with a clear message.
- **HTTP calls are injectable:** every module that calls `fetch` accepts a `fetchImpl` parameter defaulting to global `fetch`, so tests never hit the network.
- **Node version floor:** Node 22+. Do not use APIs newer than Node 22.
- **LinkedIn OAuth uses `state` (CSRF), NOT PKCE** — LinkedIn is a confidential client. (This corrects the design spec, which mentioned PKCE.)
- **Dedupe key:** every `Post` row stores a `dedupeHash`; uniqueness is `(linkedinAccountId, dedupeHash)`. `dedupeHash = externalId` when present, else `sha256(text + '\n' + publishedAt.toISOString())`.

---

## File Structure

**Root**
- `package.json` — workspace root, scripts delegate to turbo
- `pnpm-workspace.yaml` — `apps/*`, `packages/*`
- `turbo.json` — build/test/lint/dev pipelines
- `tsconfig.base.json` — shared compiler options
- `docker-compose.yml` — local Postgres
- `.env.example` — documents all env vars

**packages/core** — pure, dependency-light shared code
- `src/crypto.ts` — `encrypt(plaintext, keyB64)`, `decrypt(payload, keyB64)`
- `src/types.ts` — `RawPost`, `MediaType`, `PostMetrics`
- `src/index.ts` — re-exports

**packages/db** — Prisma schema + client
- `prisma/schema.prisma`
- `src/client.ts` — Prisma client singleton
- `src/index.ts`

**packages/linkedin** — LinkedIn integration units
- `src/oauth.ts` — `LinkedInOAuthClient`
- `src/ingestor.ts` — `PostIngestor` interface, `LinkedInReadUnavailableError`
- `src/api-ingestor.ts` — `LinkedInApiIngestor`
- `src/csv-ingestor.ts` — `CsvShareIngestor`
- `src/dedupe.ts` — `hashPost`, `dedupeKey`
- `src/index.ts`

**apps/api** — Hono backend
- `src/env.ts` — Zod-validated env
- `src/auth.ts` — Better Auth instance
- `src/repos/linkedin-account.ts` — account persistence (encrypt/decrypt)
- `src/repos/post.ts` — `upsertPosts`
- `src/oauth-state.ts` — signed OAuth state store
- `src/routes/linkedin.ts` — connect / callback / ingest / import
- `src/app.ts` — Hono app assembly
- `src/server.ts` — node-server entry

**apps/web / apps/worker / apps/desktop** — scaffolds (Task 11)

---

## Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `docker-compose.yml`, `.env.example`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/src/index.ts`, `packages/core/vitest.config.ts`

**Interfaces:**
- Produces: a working pnpm+turbo workspace; `packages/core` importable as `@outreach/core`.

- [ ] **Step 1: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 2: Create root `package.json`**

```json
{
  "name": "outreach",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.9.2",
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "turbo run build",
    "test": "turbo run test",
    "lint": "turbo run lint",
    "dev": "turbo run dev",
    "db:up": "docker compose up -d",
    "db:migrate": "pnpm --filter @outreach/db exec prisma migrate dev"
  },
  "devDependencies": {
    "turbo": "^2.3.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 3: Create `turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "test": { "dependsOn": ["^build"] },
    "lint": {},
    "dev": { "cache": false, "persistent": true }
  }
}
```

- [ ] **Step 4: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2023"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "resolveJsonModule": true,
    "verbatimModuleSyntax": true
  }
}
```

- [ ] **Step 5: Create `docker-compose.yml`**

```yaml
services:
  db:
    image: postgres:17
    environment:
      POSTGRES_USER: outreach
      POSTGRES_PASSWORD: outreach
      POSTGRES_DB: outreach
    ports:
      - "5544:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
volumes:
  pgdata:
```

- [ ] **Step 6: Create `.env.example`**

```bash
# apps/api
DATABASE_URL="postgresql://outreach:outreach@localhost:5544/outreach"
ENCRYPTION_KEY="" # base64 of 32 random bytes: openssl rand -base64 32
BETTER_AUTH_SECRET="" # openssl rand -base64 32
BETTER_AUTH_URL="http://localhost:8787"
API_PORT="8787"
WEB_ORIGIN="http://localhost:3000"
LINKEDIN_CLIENT_ID=""
LINKEDIN_CLIENT_SECRET=""
LINKEDIN_REDIRECT_URI="http://localhost:8787/linkedin/callback"
```

- [ ] **Step 7: Create `packages/core/package.json`**

```json
{
  "name": "@outreach/core",
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
  "devDependencies": { "typescript": "^5.7.0", "vitest": "^3.0.0" }
}
```

- [ ] **Step 8: Create `packages/core/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["src"]
}
```

- [ ] **Step 9: Create `packages/core/src/index.ts` and `packages/core/vitest.config.ts`**

```typescript
// src/index.ts
export {};
```

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node" } });
```

- [ ] **Step 10: Install and verify**

Run: `pnpm install && pnpm build`
Expected: install succeeds; turbo runs `build` for `@outreach/core` with no type errors.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "chore: scaffold turborepo workspace with core package"
```

---

## Task 2: Spike — verify LinkedIn personal-post read access

**Files:**
- Create: `docs/superpowers/spikes/linkedin-read-access.md` (findings record)

**Interfaces:**
- Produces: a documented decision — is the API path viable, or is CSV the primary ingestion path? Later tasks (6, 9) reference this outcome but do not depend on it structurally (both paths are built regardless).

This task is a manual investigation, not a code test. Do not skip it — its outcome sets expectations, but both ingestion paths get built either way.

- [ ] **Step 1: Confirm the app's granted products**

In the LinkedIn Developer Portal → your app → **Products**, record which are **granted** (green), not merely requested. Note whether "Community Management API" is granted.

- [ ] **Step 2: Attempt an authenticated read against `/rest/posts`**

Using a valid member access token (from a manual OAuth run or the LinkedIn token generator), run:

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  -H "LinkedIn-Version: 202401" \
  -H "X-Restli-Protocol-Version: 2.0.0" \
  "https://api.linkedin.com/rest/posts?q=author&author=urn:li:person:{MEMBER_ID}&count=5" | head -c 2000
```

- [ ] **Step 3: Record the result**

Write to `docs/superpowers/spikes/linkedin-read-access.md`:
- HTTP status and whether posts were returned.
- If `403`/`ACCESS_DENIED`/empty: **CSV is the primary path**; the API ingestor stays as a best-effort option that surfaces `LinkedInReadUnavailableError`.
- If posts returned: record the exact query params, `LinkedIn-Version` header value, and response shape (fields for text, media, publishedAt, social metrics) — Task 6 uses these.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/spikes/linkedin-read-access.md
git commit -m "docs: record LinkedIn post-read access spike findings"
```

---

## Task 3: Token encryption (`packages/core`)

**Files:**
- Create: `packages/core/src/crypto.ts`
- Test: `packages/core/src/crypto.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces:
  - `encrypt(plaintext: string, keyB64: string): string` — returns `"<ivB64>.<tagB64>.<ctB64>"`
  - `decrypt(payload: string, keyB64: string): string`
  - Both throw `Error` on a malformed key (not 32 bytes) or tampered payload.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/crypto.test.ts
import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "./crypto.js";
import { randomBytes } from "node:crypto";

const key = randomBytes(32).toString("base64");

describe("crypto", () => {
  it("round-trips a secret", () => {
    const token = "ya29.super-secret-token";
    expect(decrypt(encrypt(token, key), key)).toBe(token);
  });

  it("produces different ciphertext each call (random IV)", () => {
    expect(encrypt("x", key)).not.toBe(encrypt("x", key));
  });

  it("rejects a tampered payload", () => {
    const enc = encrypt("x", key);
    const tampered = enc.slice(0, -2) + (enc.endsWith("A") ? "B" : "A") + enc.slice(-1);
    expect(() => decrypt(tampered, key)).toThrow();
  });

  it("rejects a wrong-length key", () => {
    expect(() => encrypt("x", "c2hvcnQ=")).toThrow(/32 bytes/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @outreach/core test`
Expected: FAIL — `crypto.js` / `encrypt` not found.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/crypto.ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function loadKey(keyB64: string): Buffer {
  const key = Buffer.from(keyB64, "base64");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY must decode to 32 bytes (AES-256).");
  }
  return key;
}

export function encrypt(plaintext: string, keyB64: string): string {
  const key = loadKey(keyB64);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(".");
}

export function decrypt(payload: string, keyB64: string): string {
  const key = loadKey(keyB64);
  const [ivB64, tagB64, ctB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !ctB64) throw new Error("Malformed ciphertext payload.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}
```

- [ ] **Step 4: Export from index**

```typescript
// packages/core/src/index.ts
export { encrypt, decrypt } from "./crypto.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @outreach/core test`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): AES-256-GCM secret encryption"
```

---

## Task 4: Shared domain types (`packages/core`)

**Files:**
- Create: `packages/core/src/types.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces:
  - `type MediaType = "none" | "image" | "video" | "article"`
  - `interface PostMetrics { likes?: number; comments?: number; shares?: number; impressions?: number }`
  - `interface RawPost { externalId: string | null; text: string; mediaType: MediaType; publishedAt: Date; metrics?: PostMetrics; raw: unknown }`

- [ ] **Step 1: Create the types file**

```typescript
// packages/core/src/types.ts
export type MediaType = "none" | "image" | "video" | "article";

export interface PostMetrics {
  likes?: number;
  comments?: number;
  shares?: number;
  impressions?: number;
}

export interface RawPost {
  externalId: string | null;
  text: string;
  mediaType: MediaType;
  publishedAt: Date;
  metrics?: PostMetrics;
  raw: unknown;
}
```

- [ ] **Step 2: Re-export**

```typescript
// packages/core/src/index.ts
export { encrypt, decrypt } from "./crypto.js";
export type { MediaType, PostMetrics, RawPost } from "./types.js";
```

- [ ] **Step 3: Verify build**

Run: `pnpm --filter @outreach/core build`
Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add packages/core
git commit -m "feat(core): shared RawPost domain types"
```

---

## Task 5: Database schema and client (`packages/db`)

**Files:**
- Create: `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/db/prisma/schema.prisma`, `packages/db/src/client.ts`, `packages/db/src/index.ts`
- Test: `packages/db/src/client.test.ts`

**Interfaces:**
- Produces: `prisma` (Prisma client singleton) exported from `@outreach/db`. Models: `User`, `Session`, `Account`, `Verification` (Better Auth), `LinkedInAccount`, `Post`.

- [ ] **Step 1: Create `packages/db/package.json`**

```json
{
  "name": "@outreach/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "build": "prisma generate && tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "lint": "tsc -p tsconfig.json --noEmit",
    "db:generate": "prisma generate",
    "db:migrate": "prisma migrate dev"
  },
  "dependencies": { "@prisma/client": "^6.2.0" },
  "devDependencies": { "prisma": "^6.2.0", "typescript": "^5.7.0", "vitest": "^3.0.0" }
}
```

- [ ] **Step 2: Create `packages/db/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/db/prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// --- Better Auth core tables ---
model User {
  id            String           @id
  email         String           @unique
  name          String?
  emailVerified Boolean          @default(false)
  image         String?
  createdAt     DateTime         @default(now())
  updatedAt     DateTime         @updatedAt
  sessions      Session[]
  accounts      Account[]
  linkedin      LinkedInAccount[]
}

model Session {
  id        String   @id
  userId    String
  token     String   @unique
  expiresAt DateTime
  ipAddress String?
  userAgent String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model Account {
  id                    String    @id
  userId                String
  accountId             String
  providerId            String
  accessToken           String?
  refreshToken          String?
  idToken               String?
  accessTokenExpiresAt  DateTime?
  refreshTokenExpiresAt DateTime?
  scope                 String?
  password              String?
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt
  user                  User      @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model Verification {
  id         String   @id
  identifier String
  value      String
  expiresAt  DateTime
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}

// --- Domain tables ---
model LinkedInAccount {
  id             String   @id @default(cuid())
  userId         String
  memberUrn      String
  displayName    String
  avatarUrl      String?
  accessToken    String   // AES-GCM encrypted
  refreshToken   String?  // AES-GCM encrypted
  tokenExpiresAt DateTime?
  scopes         String[]
  status         String   @default("active") // active | expired | revoked
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  posts          Post[]

  @@unique([userId, memberUrn])
}

model Post {
  id                String   @id @default(cuid())
  linkedinAccountId String
  source            String   // linkedin_api | csv_import
  externalId        String?
  dedupeHash        String
  text              String
  mediaType         String   @default("none")
  publishedAt       DateTime
  metrics           Json?
  raw               Json?
  createdAt         DateTime @default(now())
  ingestedAt        DateTime @default(now())
  account           LinkedInAccount @relation(fields: [linkedinAccountId], references: [id], onDelete: Cascade)

  @@unique([linkedinAccountId, dedupeHash])
  @@index([linkedinAccountId, publishedAt])
}
```

- [ ] **Step 4: Create the client singleton and index**

```typescript
// packages/db/src/client.ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

```typescript
// packages/db/src/index.ts
export { prisma } from "./client.js";
export type { User, LinkedInAccount, Post, Prisma } from "@prisma/client";
```

- [ ] **Step 5: Start Postgres and run the first migration**

Run:
```bash
docker compose up -d
DATABASE_URL="postgresql://outreach:outreach@localhost:5544/outreach" \
  pnpm --filter @outreach/db exec prisma migrate dev --name init
```
Expected: migration `init` created and applied; Prisma client generated.

- [ ] **Step 6: Write the integration test**

```typescript
// packages/db/src/client.test.ts
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "./client.js";

describe("db", () => {
  afterAll(async () => { await prisma.$disconnect(); });

  it("connects and round-trips a user + linkedin account", async () => {
    const user = await prisma.user.create({
      data: { id: `u_${Date.now()}`, email: `t${Date.now()}@ex.com` },
    });
    const acct = await prisma.linkedInAccount.create({
      data: {
        userId: user.id, memberUrn: `urn:li:person:${Date.now()}`,
        displayName: "Test", accessToken: "enc", scopes: ["w_member_social"],
      },
    });
    expect(acct.status).toBe("active");
    await prisma.user.delete({ where: { id: user.id } });
  });
});
```

- [ ] **Step 7: Run the test**

Run: `DATABASE_URL="postgresql://outreach:outreach@localhost:5544/outreach" pnpm --filter @outreach/db test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/db
git commit -m "feat(db): Prisma schema for auth + LinkedIn accounts + posts"
```

---

## Task 6: LinkedIn OAuth client (`packages/linkedin`)

**Files:**
- Create: `packages/linkedin/package.json`, `packages/linkedin/tsconfig.json`, `packages/linkedin/src/oauth.ts`, `packages/linkedin/src/index.ts`
- Test: `packages/linkedin/src/oauth.test.ts`

**Interfaces:**
- Produces:
  - `interface TokenResponse { accessToken: string; refreshToken?: string; expiresIn: number; scopes: string[] }`
  - `interface LinkedInProfile { memberUrn: string; displayName: string; avatarUrl?: string }`
  - `class LinkedInOAuthClient`:
    - `constructor(cfg: { clientId: string; clientSecret: string; redirectUri: string; fetchImpl?: typeof fetch })`
    - `createAuthorization(scopes: string[]): { url: string; state: string }`
    - `exchangeCode(code: string): Promise<TokenResponse>`
    - `refresh(refreshToken: string): Promise<TokenResponse>`
    - `fetchProfile(accessToken: string): Promise<LinkedInProfile>`

- [ ] **Step 1: Create package files**

```json
// packages/linkedin/package.json
{
  "name": "@outreach/linkedin",
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
  "dependencies": { "@outreach/core": "workspace:*" },
  "devDependencies": { "typescript": "^5.7.0", "vitest": "^3.0.0" }
}
```

```json
// packages/linkedin/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["src"]
}
```

- [ ] **Step 2: Write the failing test**

```typescript
// packages/linkedin/src/oauth.test.ts
import { describe, it, expect, vi } from "vitest";
import { LinkedInOAuthClient } from "./oauth.js";

const cfg = { clientId: "cid", clientSecret: "secret", redirectUri: "http://localhost/cb" };

describe("LinkedInOAuthClient", () => {
  it("builds an authorization URL with state and scopes", () => {
    const client = new LinkedInOAuthClient(cfg);
    const { url, state } = client.createAuthorization(["openid", "profile", "w_member_social"]);
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://www.linkedin.com/oauth/v2/authorization");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("client_id")).toBe("cid");
    expect(u.searchParams.get("redirect_uri")).toBe("http://localhost/cb");
    expect(u.searchParams.get("scope")).toBe("openid profile w_member_social");
    expect(u.searchParams.get("state")).toBe(state);
    expect(state.length).toBeGreaterThan(16);
  });

  it("exchanges a code for tokens", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: "AT", refresh_token: "RT", expires_in: 3600, scope: "openid,w_member_social" }), { status: 200 }),
    ) as unknown as typeof fetch;
    const client = new LinkedInOAuthClient({ ...cfg, fetchImpl });
    const t = await client.exchangeCode("the-code");
    expect(t.accessToken).toBe("AT");
    expect(t.refreshToken).toBe("RT");
    expect(t.expiresIn).toBe(3600);
    expect(t.scopes).toEqual(["openid", "w_member_social"]);
  });

  it("throws a clear error on token exchange failure", async () => {
    const fetchImpl = vi.fn(async () => new Response("bad", { status: 400 })) as unknown as typeof fetch;
    const client = new LinkedInOAuthClient({ ...cfg, fetchImpl });
    await expect(client.exchangeCode("x")).rejects.toThrow(/token exchange failed/i);
  });

  it("maps userinfo to a member profile", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ sub: "abc123", name: "Jane Doe", picture: "http://img" }), { status: 200 }),
    ) as unknown as typeof fetch;
    const client = new LinkedInOAuthClient({ ...cfg, fetchImpl });
    const p = await client.fetchProfile("AT");
    expect(p.memberUrn).toBe("urn:li:person:abc123");
    expect(p.displayName).toBe("Jane Doe");
    expect(p.avatarUrl).toBe("http://img");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @outreach/linkedin test`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the implementation**

```typescript
// packages/linkedin/src/oauth.ts
import { randomBytes } from "node:crypto";

const AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const USERINFO_URL = "https://api.linkedin.com/v2/userinfo";

export interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  scopes: string[];
}

export interface LinkedInProfile {
  memberUrn: string;
  displayName: string;
  avatarUrl?: string;
}

interface Config {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
}

export class LinkedInOAuthClient {
  private readonly fetch: typeof fetch;
  constructor(private readonly cfg: Config) {
    this.fetch = cfg.fetchImpl ?? fetch;
  }

  createAuthorization(scopes: string[]): { url: string; state: string } {
    const state = randomBytes(16).toString("hex");
    const params = new URLSearchParams({
      response_type: "code",
      client_id: this.cfg.clientId,
      redirect_uri: this.cfg.redirectUri,
      state,
      scope: scopes.join(" "),
    });
    return { url: `${AUTH_URL}?${params.toString()}`, state };
  }

  private parseTokens(json: Record<string, unknown>): TokenResponse {
    const scopeRaw = typeof json.scope === "string" ? json.scope : "";
    return {
      accessToken: String(json.access_token),
      refreshToken: json.refresh_token ? String(json.refresh_token) : undefined,
      expiresIn: Number(json.expires_in ?? 0),
      scopes: scopeRaw.split(/[ ,]+/).filter(Boolean),
    };
  }

  async exchangeCode(code: string): Promise<TokenResponse> {
    const res = await this.fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: this.cfg.redirectUri,
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
      }),
    });
    if (!res.ok) throw new Error(`LinkedIn token exchange failed: ${res.status}`);
    return this.parseTokens(await res.json());
  }

  async refresh(refreshToken: string): Promise<TokenResponse> {
    const res = await this.fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
      }),
    });
    if (!res.ok) throw new Error(`LinkedIn token refresh failed: ${res.status}`);
    return this.parseTokens(await res.json());
  }

  async fetchProfile(accessToken: string): Promise<LinkedInProfile> {
    const res = await this.fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`LinkedIn userinfo failed: ${res.status}`);
    const j = (await res.json()) as Record<string, unknown>;
    return {
      memberUrn: `urn:li:person:${String(j.sub)}`,
      displayName: String(j.name ?? "LinkedIn Member"),
      avatarUrl: j.picture ? String(j.picture) : undefined,
    };
  }
}
```

- [ ] **Step 5: Create index barrel**

```typescript
// packages/linkedin/src/index.ts
export { LinkedInOAuthClient } from "./oauth.js";
export type { TokenResponse, LinkedInProfile } from "./oauth.js";
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @outreach/linkedin test`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/linkedin
git commit -m "feat(linkedin): OAuth client (authorize, token exchange, refresh, profile)"
```

---

## Task 7: Dedupe helpers + PostIngestor interface (`packages/linkedin`)

**Files:**
- Create: `packages/linkedin/src/dedupe.ts`, `packages/linkedin/src/ingestor.ts`
- Test: `packages/linkedin/src/dedupe.test.ts`
- Modify: `packages/linkedin/src/index.ts`

**Interfaces:**
- Produces:
  - `hashPost(text: string, publishedAt: Date): string` — sha256 hex of `text + "\n" + publishedAt.toISOString()`
  - `dedupeKey(raw: RawPost): string` — `raw.externalId ?? hashPost(raw.text, raw.publishedAt)`
  - `interface PostIngestor { fetch(): Promise<RawPost[]> }`
  - `class LinkedInReadUnavailableError extends Error`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/linkedin/src/dedupe.test.ts
import { describe, it, expect } from "vitest";
import { hashPost, dedupeKey } from "./dedupe.js";
import type { RawPost } from "@outreach/core";

const base: RawPost = { externalId: null, text: "hello", mediaType: "none", publishedAt: new Date("2025-01-01T00:00:00Z"), raw: {} };

describe("dedupe", () => {
  it("hashPost is stable for same input", () => {
    expect(hashPost("hello", new Date("2025-01-01T00:00:00Z")))
      .toBe(hashPost("hello", new Date("2025-01-01T00:00:00Z")));
  });
  it("hashPost differs for different text", () => {
    expect(hashPost("a", base.publishedAt)).not.toBe(hashPost("b", base.publishedAt));
  });
  it("dedupeKey prefers externalId", () => {
    expect(dedupeKey({ ...base, externalId: "urn:li:share:99" })).toBe("urn:li:share:99");
  });
  it("dedupeKey falls back to content hash", () => {
    expect(dedupeKey(base)).toBe(hashPost("hello", base.publishedAt));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @outreach/linkedin test dedupe`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `dedupe.ts` and `ingestor.ts`**

```typescript
// packages/linkedin/src/dedupe.ts
import { createHash } from "node:crypto";
import type { RawPost } from "@outreach/core";

export function hashPost(text: string, publishedAt: Date): string {
  return createHash("sha256").update(`${text}\n${publishedAt.toISOString()}`).digest("hex");
}

export function dedupeKey(raw: RawPost): string {
  return raw.externalId ?? hashPost(raw.text, raw.publishedAt);
}
```

```typescript
// packages/linkedin/src/ingestor.ts
import type { RawPost } from "@outreach/core";

export interface PostIngestor {
  fetch(): Promise<RawPost[]>;
}

export class LinkedInReadUnavailableError extends Error {
  constructor(message = "LinkedIn API does not permit reading this member's posts.") {
    super(message);
    this.name = "LinkedInReadUnavailableError";
  }
}
```

- [ ] **Step 4: Export from index**

```typescript
// packages/linkedin/src/index.ts
export { LinkedInOAuthClient } from "./oauth.js";
export type { TokenResponse, LinkedInProfile } from "./oauth.js";
export { hashPost, dedupeKey } from "./dedupe.js";
export { LinkedInReadUnavailableError } from "./ingestor.js";
export type { PostIngestor } from "./ingestor.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @outreach/linkedin test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/linkedin
git commit -m "feat(linkedin): dedupe helpers + PostIngestor interface"
```

---

## Task 8: CSV ingestor (`packages/linkedin`)

**Files:**
- Create: `packages/linkedin/src/csv-ingestor.ts`
- Test: `packages/linkedin/src/csv-ingestor.test.ts`
- Modify: `packages/linkedin/src/index.ts`
- Modify: `packages/linkedin/package.json` (add `csv-parse`)

**Interfaces:**
- Consumes: `RawPost` (core), `PostIngestor` (Task 7).
- Produces: `class CsvShareIngestor implements PostIngestor` — `constructor(csvContent: string)`; parses LinkedIn `Shares.csv`. Returns `{ inserted rows }`; malformed rows are skipped, and the count is exposed via `get skipped(): number` after `fetch()`.

- [ ] **Step 1: Add dependency**

Add to `packages/linkedin/package.json` `dependencies`: `"csv-parse": "^5.6.0"`. Run `pnpm install`.

- [ ] **Step 2: Write the failing test**

```typescript
// packages/linkedin/src/csv-ingestor.test.ts
import { describe, it, expect } from "vitest";
import { CsvShareIngestor } from "./csv-ingestor.js";

// LinkedIn export columns: Date,ShareLink,ShareCommentary,SharedUrl,MediaUrl,Visibility
const csv = `Date,ShareLink,ShareCommentary,SharedUrl,MediaUrl,Visibility
2025-03-01 10:00:00,https://www.linkedin.com/feed/update/urn:li:share:111,"Hello world, my first post",,,MEMBER_NETWORK
2025-03-02 09:00:00,https://www.linkedin.com/feed/update/urn:li:share:222,"With an image",,https://media/img.png,MEMBER_NETWORK
bad-row-without-enough-columns`;

describe("CsvShareIngestor", () => {
  it("parses shares into RawPosts", async () => {
    const ing = new CsvShareIngestor(csv);
    const posts = await ing.fetch();
    expect(posts).toHaveLength(2);
    expect(posts[0]!.text).toBe("Hello world, my first post");
    expect(posts[0]!.externalId).toBe("urn:li:share:111");
    expect(posts[0]!.mediaType).toBe("none");
    expect(posts[1]!.mediaType).toBe("image");
    expect(posts[0]!.publishedAt.toISOString()).toBe("2025-03-01T10:00:00.000Z");
  });

  it("skips malformed rows and reports the count", async () => {
    const ing = new CsvShareIngestor(csv);
    await ing.fetch();
    expect(ing.skipped).toBe(1);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @outreach/linkedin test csv`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the implementation**

```typescript
// packages/linkedin/src/csv-ingestor.ts
import { parse } from "csv-parse/sync";
import type { RawPost, MediaType } from "@outreach/core";
import type { PostIngestor } from "./ingestor.js";

interface ShareRow {
  Date?: string;
  ShareLink?: string;
  ShareCommentary?: string;
  MediaUrl?: string;
}

function extractUrn(shareLink: string | undefined): string | null {
  if (!shareLink) return null;
  const m = shareLink.match(/urn:li:share:\d+/);
  return m ? m[0] : null;
}

export class CsvShareIngestor implements PostIngestor {
  private _skipped = 0;
  constructor(private readonly csvContent: string) {}

  get skipped(): number {
    return this._skipped;
  }

  async fetch(): Promise<RawPost[]> {
    this._skipped = 0;
    const rows = parse(this.csvContent, {
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
    }) as ShareRow[];

    const posts: RawPost[] = [];
    for (const row of rows) {
      const dateStr = row.Date?.trim();
      const text = row.ShareCommentary?.trim() ?? "";
      if (!dateStr || (!text && !row.MediaUrl)) {
        this._skipped++;
        continue;
      }
      const publishedAt = new Date(dateStr.replace(" ", "T") + "Z");
      if (Number.isNaN(publishedAt.getTime())) {
        this._skipped++;
        continue;
      }
      const mediaType: MediaType = row.MediaUrl?.trim() ? "image" : "none";
      posts.push({
        externalId: extractUrn(row.ShareLink),
        text,
        mediaType,
        publishedAt,
        raw: row,
      });
    }
    return posts;
  }
}
```

Note: `csv-parse` with `relax_column_count` keeps short rows; the loop's own guards (missing date / empty text+media) count them as skipped.

- [ ] **Step 5: Export from index**

```typescript
// add to packages/linkedin/src/index.ts
export { CsvShareIngestor } from "./csv-ingestor.js";
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @outreach/linkedin test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/linkedin
git commit -m "feat(linkedin): CSV Shares.csv ingestor"
```

---

## Task 9: API ingestor (`packages/linkedin`)

**Files:**
- Create: `packages/linkedin/src/api-ingestor.ts`
- Test: `packages/linkedin/src/api-ingestor.test.ts`
- Modify: `packages/linkedin/src/index.ts`

**Interfaces:**
- Consumes: `RawPost` (core), `PostIngestor`, `LinkedInReadUnavailableError` (Task 7).
- Produces: `class LinkedInApiIngestor implements PostIngestor` — `constructor(cfg: { accessToken: string; memberUrn: string; apiVersion?: string; fetchImpl?: typeof fetch })`. Calls `/rest/posts`. Throws `LinkedInReadUnavailableError` on 403.

Use the spike (Task 2) findings to confirm the exact query/response shape. The mapping below is the default; adjust field paths if the spike recorded different ones.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/linkedin/src/api-ingestor.test.ts
import { describe, it, expect, vi } from "vitest";
import { LinkedInApiIngestor } from "./api-ingestor.js";
import { LinkedInReadUnavailableError } from "./ingestor.js";

const cfg = { accessToken: "AT", memberUrn: "urn:li:person:abc" };

describe("LinkedInApiIngestor", () => {
  it("maps API posts to RawPosts", async () => {
    const body = {
      elements: [
        { id: "urn:li:share:1", commentary: "Post one", createdAt: 1710000000000, content: {} },
        { id: "urn:li:share:2", commentary: "Post two", createdAt: 1710100000000, content: { media: { id: "x" } } },
      ],
    };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
    const posts = await new LinkedInApiIngestor({ ...cfg, fetchImpl }).fetch();
    expect(posts).toHaveLength(2);
    expect(posts[0]!.externalId).toBe("urn:li:share:1");
    expect(posts[0]!.text).toBe("Post one");
    expect(posts[1]!.mediaType).toBe("image");
  });

  it("throws LinkedInReadUnavailableError on 403", async () => {
    const fetchImpl = vi.fn(async () => new Response("denied", { status: 403 })) as unknown as typeof fetch;
    await expect(new LinkedInApiIngestor({ ...cfg, fetchImpl }).fetch())
      .rejects.toBeInstanceOf(LinkedInReadUnavailableError);
  });

  it("throws a generic error on other failures", async () => {
    const fetchImpl = vi.fn(async () => new Response("oops", { status: 500 })) as unknown as typeof fetch;
    await expect(new LinkedInApiIngestor({ ...cfg, fetchImpl }).fetch()).rejects.toThrow(/500/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @outreach/linkedin test api-ingestor`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/linkedin/src/api-ingestor.ts
import type { RawPost, MediaType } from "@outreach/core";
import { PostIngestor, LinkedInReadUnavailableError } from "./ingestor.js";

interface Config {
  accessToken: string;
  memberUrn: string;
  apiVersion?: string;
  fetchImpl?: typeof fetch;
}

interface ApiPost {
  id?: string;
  commentary?: string;
  createdAt?: number;
  content?: { media?: unknown };
}

export class LinkedInApiIngestor implements PostIngestor {
  private readonly fetch: typeof fetch;
  private readonly apiVersion: string;
  constructor(private readonly cfg: Config) {
    this.fetch = cfg.fetchImpl ?? fetch;
    this.apiVersion = cfg.apiVersion ?? "202401";
  }

  async fetch_(): Promise<Response> {
    const url = new URL("https://api.linkedin.com/rest/posts");
    url.searchParams.set("q", "author");
    url.searchParams.set("author", this.cfg.memberUrn);
    url.searchParams.set("count", "50");
    return this.fetch(url, {
      headers: {
        Authorization: `Bearer ${this.cfg.accessToken}`,
        "LinkedIn-Version": this.apiVersion,
        "X-Restli-Protocol-Version": "2.0.0",
      },
    });
  }

  async fetch(): Promise<RawPost[]> {
    const res = await this.fetch_();
    if (res.status === 403) throw new LinkedInReadUnavailableError();
    if (!res.ok) throw new Error(`LinkedIn posts read failed: ${res.status}`);
    const json = (await res.json()) as { elements?: ApiPost[] };
    return (json.elements ?? []).map((p) => this.map(p));
  }

  private map(p: ApiPost): RawPost {
    const mediaType: MediaType = p.content?.media ? "image" : "none";
    return {
      externalId: p.id ?? null,
      text: p.commentary ?? "",
      mediaType,
      publishedAt: new Date(p.createdAt ?? 0),
      raw: p,
    };
  }
}
```

Note: `fetch_` is split out only so the class-private wrapper reads cleanly; the public method is `fetch()` as required by `PostIngestor`.

- [ ] **Step 4: Export from index**

```typescript
// add to packages/linkedin/src/index.ts
export { LinkedInApiIngestor } from "./api-ingestor.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @outreach/linkedin test`
Expected: PASS (all linkedin tests).

- [ ] **Step 6: Commit**

```bash
git add packages/linkedin
git commit -m "feat(linkedin): API post ingestor with read-unavailable handling"
```

---

## Task 10: API env + Better Auth + app skeleton (`apps/api`)

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/vitest.config.ts`, `apps/api/src/env.ts`, `apps/api/src/auth.ts`, `apps/api/src/app.ts`, `apps/api/src/server.ts`
- Test: `apps/api/src/app.test.ts`

**Interfaces:**
- Consumes: `prisma` (`@outreach/db`).
- Produces:
  - `env` (validated config object) from `./env.js`
  - `auth` (Better Auth instance) from `./auth.js`
  - `createApp(): Hono` from `./app.js` with `/health` and Better Auth mounted at `/api/auth/*`, plus a session middleware exposing `c.get("user")`.

- [ ] **Step 1: Create package + tsconfig + vitest config**

```json
// apps/api/package.json
{
  "name": "@outreach/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json --noEmit",
    "dev": "tsx watch src/server.ts",
    "start": "tsx src/server.ts",
    "test": "vitest run",
    "lint": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@outreach/core": "workspace:*",
    "@outreach/db": "workspace:*",
    "@outreach/linkedin": "workspace:*",
    "hono": "^4.6.0",
    "@hono/node-server": "^1.13.0",
    "better-auth": "^1.1.0",
    "zod": "^3.24.0"
  },
  "devDependencies": { "tsx": "^4.19.0", "typescript": "^5.7.0", "vitest": "^3.0.0" }
}
```

```json
// apps/api/tsconfig.json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "noEmit": true }, "include": ["src"] }
```

```typescript
// apps/api/vitest.config.ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node" } });
```

- [ ] **Step 2: Write `env.ts` (fail-fast config)**

```typescript
// apps/api/src/env.ts
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url(),
  ENCRYPTION_KEY: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(1),
  BETTER_AUTH_URL: z.string().url(),
  API_PORT: z.coerce.number().default(8787),
  WEB_ORIGIN: z.string().url(),
  LINKEDIN_CLIENT_ID: z.string().min(1),
  LINKEDIN_CLIENT_SECRET: z.string().min(1),
  LINKEDIN_REDIRECT_URI: z.string().url(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}
export const env = parsed.data;
```

- [ ] **Step 3: Write `auth.ts`**

```typescript
// apps/api/src/auth.ts
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "@outreach/db";
import { env } from "./env.js";

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  emailAndPassword: { enabled: true },
  trustedOrigins: [env.WEB_ORIGIN],
});

export type AuthUser = typeof auth.$Infer.Session.user;
```

- [ ] **Step 4: Write the failing test for the app skeleton**

```typescript
// apps/api/src/app.test.ts
import { describe, it, expect } from "vitest";
import { createApp } from "./app.js";

describe("api app", () => {
  it("serves /health", async () => {
    const app = createApp();
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("rejects an unauthenticated protected route", async () => {
    const app = createApp();
    const res = await app.request("/linkedin/accounts");
    expect(res.status).toBe(401);
  });
});
```

Note: this test requires env vars. Provide them in `apps/api/vitest.config.ts` via a `setupFiles` that sets safe test defaults, or run with an `.env.test`. Add this setup file:

```typescript
// apps/api/src/test-setup.ts
process.env.DATABASE_URL ??= "postgresql://outreach:outreach@localhost:5544/outreach";
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.BETTER_AUTH_SECRET ??= "test-secret";
process.env.BETTER_AUTH_URL ??= "http://localhost:8787";
process.env.WEB_ORIGIN ??= "http://localhost:3000";
process.env.LINKEDIN_CLIENT_ID ??= "cid";
process.env.LINKEDIN_CLIENT_SECRET ??= "csecret";
process.env.LINKEDIN_REDIRECT_URI ??= "http://localhost:8787/linkedin/callback";
```

Update `vitest.config.ts` to `test: { environment: "node", setupFiles: ["./src/test-setup.ts"] }`.

- [ ] **Step 5: Run test to verify it fails**

Run: `pnpm --filter @outreach/api test`
Expected: FAIL — `app.js` not found.

- [ ] **Step 6: Write `app.ts`**

```typescript
// apps/api/src/app.ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import { auth, type AuthUser } from "./auth.js";
import { env } from "./env.js";

export type AppEnv = { Variables: { user: AuthUser | null } };

export function createApp() {
  const app = new Hono<AppEnv>();

  app.use("*", cors({ origin: env.WEB_ORIGIN, credentials: true }));

  app.use("*", async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    c.set("user", session?.user ?? null);
    await next();
  });

  app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

  app.get("/health", (c) => c.json({ status: "ok" }));

  // Protected route group guard
  app.use("/linkedin/*", async (c, next) => {
    if (!c.get("user")) return c.json({ error: "unauthorized" }, 401);
    await next();
  });

  app.get("/linkedin/accounts", (c) => c.json({ accounts: [] })); // filled in Task 12

  return app;
}
```

- [ ] **Step 7: Write `server.ts`**

```typescript
// apps/api/src/server.ts
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { env } from "./env.js";

serve({ fetch: createApp().fetch, port: env.API_PORT }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`);
});
```

- [ ] **Step 8: Run test to verify it passes**

Run: `docker compose up -d && pnpm --filter @outreach/api test`
Expected: PASS (2 tests).

- [ ] **Step 9: Commit**

```bash
git add apps/api
git commit -m "feat(api): Hono app skeleton with Better Auth + session guard"
```

---

## Task 11: Account & post repositories (`apps/api`)

**Files:**
- Create: `apps/api/src/repos/linkedin-account.ts`, `apps/api/src/repos/post.ts`
- Test: `apps/api/src/repos/post.test.ts`

**Interfaces:**
- Consumes: `prisma` (`@outreach/db`), `encrypt`/`decrypt` (`@outreach/core`), `dedupeKey` (`@outreach/linkedin`), `RawPost`.
- Produces:
  - `saveLinkedInAccount(input: { userId; profile: LinkedInProfile; tokens: TokenResponse }): Promise<{ id: string }>`
  - `getDecryptedAccount(id: string): Promise<{ id; userId; memberUrn; accessToken; refreshToken?; scopes: string[] } | null>`
  - `listAccounts(userId: string): Promise<Array<{ id; memberUrn; displayName; avatarUrl?; status }>>`
  - `upsertPosts(accountId: string, source: "linkedin_api" | "csv_import", posts: RawPost[]): Promise<{ inserted: number; skipped: number }>`

- [ ] **Step 1: Write the failing test for `upsertPosts`**

```typescript
// apps/api/src/repos/post.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@outreach/db";
import { upsertPosts } from "./post.js";
import type { RawPost } from "@outreach/core";

let accountId = "";
let userId = "";

beforeAll(async () => {
  userId = `u_${Date.now()}`;
  await prisma.user.create({ data: { id: userId, email: `${userId}@ex.com` } });
  const a = await prisma.linkedInAccount.create({
    data: { userId, memberUrn: `urn:li:person:${Date.now()}`, displayName: "T", accessToken: "enc", scopes: [] },
  });
  accountId = a.id;
});

afterAll(async () => {
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

const post = (over: Partial<RawPost>): RawPost => ({
  externalId: null, text: "hi", mediaType: "none",
  publishedAt: new Date("2025-01-01T00:00:00Z"), raw: {}, ...over,
});

describe("upsertPosts", () => {
  it("inserts new posts and skips duplicates on re-run", async () => {
    const posts = [post({ externalId: "urn:li:share:1" }), post({ externalId: "urn:li:share:2" })];
    const first = await upsertPosts(accountId, "linkedin_api", posts);
    expect(first).toEqual({ inserted: 2, skipped: 0 });

    const second = await upsertPosts(accountId, "linkedin_api", posts);
    expect(second).toEqual({ inserted: 0, skipped: 2 });
  });

  it("dedupes CSV posts without externalId by content hash", async () => {
    const p = post({ text: "unique-body", publishedAt: new Date("2025-02-02T00:00:00Z") });
    await upsertPosts(accountId, "csv_import", [p]);
    const again = await upsertPosts(accountId, "csv_import", [p]);
    expect(again).toEqual({ inserted: 0, skipped: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @outreach/api test post`
Expected: FAIL — `post.js` not found.

- [ ] **Step 3: Write `repos/post.ts`**

```typescript
// apps/api/src/repos/post.ts
import { prisma } from "@outreach/db";
import { dedupeKey } from "@outreach/linkedin";
import type { RawPost } from "@outreach/core";

export async function upsertPosts(
  accountId: string,
  source: "linkedin_api" | "csv_import",
  posts: RawPost[],
): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;
  for (const p of posts) {
    const hash = dedupeKey(p);
    try {
      await prisma.post.create({
        data: {
          linkedinAccountId: accountId,
          source,
          externalId: p.externalId,
          dedupeHash: hash,
          text: p.text,
          mediaType: p.mediaType,
          publishedAt: p.publishedAt,
          metrics: p.metrics ?? undefined,
          raw: p.raw as object,
        },
      });
      inserted++;
    } catch (e: unknown) {
      // Unique violation on (linkedinAccountId, dedupeHash) => already ingested.
      if (typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "P2002") {
        skipped++;
      } else {
        throw e;
      }
    }
  }
  return { inserted, skipped };
}
```

- [ ] **Step 4: Write `repos/linkedin-account.ts`**

```typescript
// apps/api/src/repos/linkedin-account.ts
import { prisma } from "@outreach/db";
import { encrypt, decrypt } from "@outreach/core";
import type { LinkedInProfile, TokenResponse } from "@outreach/linkedin";
import { env } from "../env.js";

export async function saveLinkedInAccount(input: {
  userId: string;
  profile: LinkedInProfile;
  tokens: TokenResponse;
}): Promise<{ id: string }> {
  const { userId, profile, tokens } = input;
  const expiresAt = tokens.expiresIn ? new Date(Date.now() + tokens.expiresIn * 1000) : null;
  const acct = await prisma.linkedInAccount.upsert({
    where: { userId_memberUrn: { userId, memberUrn: profile.memberUrn } },
    create: {
      userId,
      memberUrn: profile.memberUrn,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      accessToken: encrypt(tokens.accessToken, env.ENCRYPTION_KEY),
      refreshToken: tokens.refreshToken ? encrypt(tokens.refreshToken, env.ENCRYPTION_KEY) : null,
      tokenExpiresAt: expiresAt,
      scopes: tokens.scopes,
      status: "active",
    },
    update: {
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      accessToken: encrypt(tokens.accessToken, env.ENCRYPTION_KEY),
      refreshToken: tokens.refreshToken ? encrypt(tokens.refreshToken, env.ENCRYPTION_KEY) : null,
      tokenExpiresAt: expiresAt,
      scopes: tokens.scopes,
      status: "active",
    },
  });
  return { id: acct.id };
}

export async function getDecryptedAccount(id: string) {
  const a = await prisma.linkedInAccount.findUnique({ where: { id } });
  if (!a) return null;
  return {
    id: a.id,
    userId: a.userId,
    memberUrn: a.memberUrn,
    accessToken: decrypt(a.accessToken, env.ENCRYPTION_KEY),
    refreshToken: a.refreshToken ? decrypt(a.refreshToken, env.ENCRYPTION_KEY) : undefined,
    scopes: a.scopes,
  };
}

export async function listAccounts(userId: string) {
  const rows = await prisma.linkedInAccount.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { id: true, memberUrn: true, displayName: true, avatarUrl: true, status: true },
  });
  return rows;
}
```

- [ ] **Step 5: Run tests**

Run: `docker compose up -d && pnpm --filter @outreach/api test post`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): account + post repositories with encryption and dedupe"
```

---

## Task 12: LinkedIn routes — connect, callback, list, ingest, import (`apps/api`)

**Files:**
- Create: `apps/api/src/oauth-state.ts`, `apps/api/src/routes/linkedin.ts`
- Modify: `apps/api/src/app.ts` (mount routes, remove the Task 10 stub `/linkedin/accounts`)
- Test: `apps/api/src/routes/linkedin.test.ts`

**Interfaces:**
- Consumes: `LinkedInOAuthClient`, ingestors (`@outreach/linkedin`), repos (Task 11), `env`.
- Produces route handlers:
  - `GET /linkedin/connect` → 302 redirect to LinkedIn, sets a signed `li_oauth_state` cookie.
  - `GET /linkedin/callback?code&state` → validates state, exchanges code, saves account, 302 to `WEB_ORIGIN`.
  - `GET /linkedin/accounts` → `{ accounts }` for the logged-in user.
  - `POST /linkedin/accounts/:id/ingest` → API path; `{ inserted, skipped }` or 409 with `read_unavailable`.
  - `POST /linkedin/accounts/:id/import` (body: CSV text) → `{ inserted, skipped }`.

- [ ] **Step 1: Write `oauth-state.ts` (signed state, no DB needed)**

```typescript
// apps/api/src/oauth-state.ts
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env.js";

// state payload = userId; we sign it so the callback can trust it without storage.
export function signState(userId: string, nonce: string): string {
  const body = `${userId}.${nonce}`;
  const sig = createHmac("sha256", env.BETTER_AUTH_SECRET).update(body).digest("hex");
  return `${body}.${sig}`;
}

export function verifyState(state: string): { userId: string } | null {
  const parts = state.split(".");
  if (parts.length !== 3) return null;
  const [userId, nonce, sig] = parts;
  const expected = createHmac("sha256", env.BETTER_AUTH_SECRET).update(`${userId}.${nonce}`).digest("hex");
  const a = Buffer.from(sig!);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { userId: userId! };
}
```

- [ ] **Step 2: Write the failing test**

```typescript
// apps/api/src/routes/linkedin.test.ts
import { describe, it, expect } from "vitest";
import { signState, verifyState } from "../oauth-state.js";

describe("oauth state", () => {
  it("round-trips a signed state", () => {
    const s = signState("user-1", "nonce-abc");
    expect(verifyState(s)).toEqual({ userId: "user-1" });
  });
  it("rejects a tampered state", () => {
    const s = signState("user-1", "nonce-abc");
    expect(verifyState(s.slice(0, -1) + "0")).toBeNull();
  });
  it("rejects malformed state", () => {
    expect(verifyState("garbage")).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @outreach/api test linkedin`
Expected: FAIL — `oauth-state.js` not found.

- [ ] **Step 4: Run test to verify it passes (after Step 1 exists)**

Run: `pnpm --filter @outreach/api test linkedin`
Expected: PASS (3 state tests).

- [ ] **Step 5: Write `routes/linkedin.ts`**

```typescript
// apps/api/src/routes/linkedin.ts
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { randomBytes } from "node:crypto";
import {
  LinkedInOAuthClient,
  LinkedInApiIngestor,
  CsvShareIngestor,
  LinkedInReadUnavailableError,
} from "@outreach/linkedin";
import type { AppEnv } from "../app.js";
import { env } from "../env.js";
import { signState, verifyState } from "../oauth-state.js";
import { saveLinkedInAccount, getDecryptedAccount, listAccounts } from "../repos/linkedin-account.js";
import { upsertPosts } from "../repos/post.js";

const SCOPES = ["openid", "profile", "email", "w_member_social"];

function client() {
  return new LinkedInOAuthClient({
    clientId: env.LINKEDIN_CLIENT_ID,
    clientSecret: env.LINKEDIN_CLIENT_SECRET,
    redirectUri: env.LINKEDIN_REDIRECT_URI,
  });
}

export function linkedinRoutes() {
  const r = new Hono<AppEnv>();

  r.get("/connect", (c) => {
    const user = c.get("user")!;
    const nonce = randomBytes(8).toString("hex");
    const state = signState(user.id, nonce);
    const { url } = client().createAuthorization(SCOPES);
    const withState = url.replace(/state=[^&]+/, `state=${encodeURIComponent(state)}`);
    setCookie(c, "li_oauth_state", state, { httpOnly: true, sameSite: "Lax", path: "/", maxAge: 600 });
    return c.redirect(withState);
  });

  r.get("/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const cookieState = getCookie(c, "li_oauth_state");
    if (!code || !state || state !== cookieState) {
      return c.json({ error: "invalid_oauth_state" }, 400);
    }
    const verified = verifyState(state);
    if (!verified) return c.json({ error: "invalid_oauth_state" }, 400);

    const oauth = client();
    const tokens = await oauth.exchangeCode(code);
    const profile = await oauth.fetchProfile(tokens.accessToken);
    await saveLinkedInAccount({ userId: verified.userId, profile, tokens });
    return c.redirect(`${env.WEB_ORIGIN}/accounts?connected=1`);
  });

  r.get("/accounts", async (c) => {
    const user = c.get("user")!;
    return c.json({ accounts: await listAccounts(user.id) });
  });

  r.post("/accounts/:id/ingest", async (c) => {
    const user = c.get("user")!;
    const acct = await getDecryptedAccount(c.req.param("id"));
    if (!acct || acct.userId !== user.id) return c.json({ error: "not_found" }, 404);
    const ingestor = new LinkedInApiIngestor({ accessToken: acct.accessToken, memberUrn: acct.memberUrn });
    try {
      const posts = await ingestor.fetch();
      return c.json(await upsertPosts(acct.id, "linkedin_api", posts));
    } catch (e) {
      if (e instanceof LinkedInReadUnavailableError) {
        return c.json({ error: "read_unavailable", hint: "Import your Shares.csv export instead." }, 409);
      }
      throw e;
    }
  });

  r.post("/accounts/:id/import", async (c) => {
    const user = c.get("user")!;
    const acct = await getDecryptedAccount(c.req.param("id"));
    if (!acct || acct.userId !== user.id) return c.json({ error: "not_found" }, 404);
    const csv = await c.req.text();
    const ingestor = new CsvShareIngestor(csv);
    const posts = await ingestor.fetch();
    const result = await upsertPosts(acct.id, "csv_import", posts);
    return c.json({ ...result, malformed: ingestor.skipped });
  });

  return r;
}
```

- [ ] **Step 6: Mount routes in `app.ts`**

Replace the Task 10 stub line `app.get("/linkedin/accounts", ...)` with:

```typescript
// apps/api/src/app.ts — add import at top
import { linkedinRoutes } from "./routes/linkedin.js";

// ...inside createApp(), after the /linkedin/* auth guard:
app.route("/linkedin", linkedinRoutes());
```

- [ ] **Step 7: Run the full api test suite**

Run: `docker compose up -d && pnpm --filter @outreach/api test`
Expected: PASS (health + auth guard + state tests + post repo).

- [ ] **Step 8: Manual smoke of the app skeleton**

Run: `pnpm --filter @outreach/api dev` (with a real `.env`). Then:
```bash
curl -s http://localhost:8787/health
curl -s -i http://localhost:8787/linkedin/accounts   # expect 401 unauthenticated
```
Expected: `{"status":"ok"}`, then `HTTP/1.1 401`.

- [ ] **Step 9: Commit**

```bash
git add apps/api
git commit -m "feat(api): LinkedIn connect/callback/ingest/import routes"
```

---

## Task 13: Web client — login, connect, accounts, posts, CSV upload (`apps/web`)

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/next.config.ts`, `apps/web/src/lib/api.ts`, `apps/web/src/app/layout.tsx`, `apps/web/src/app/page.tsx`, `apps/web/src/app/login/page.tsx`, `apps/web/src/app/accounts/page.tsx`, `apps/web/src/app/api/[...proxy]/route.ts`
- Test: `apps/web/src/lib/api.test.ts`

**Interfaces:**
- Consumes: `apps/api` HTTP endpoints (via the BFF proxy).
- Produces: a UI that lets a user sign in (Better Auth email/password), connect a LinkedIn account, see connected accounts, trigger ingest, upload a CSV, and view ingested posts.

The BFF proxy forwards `/api/*` browser requests to `apps/api`, carrying cookies both ways so Better Auth session cookies and the OAuth flow work behind one origin.

- [ ] **Step 1: Create `apps/web/package.json`**

```json
{
  "name": "@outreach/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "next build",
    "dev": "next dev -p 3000",
    "start": "next start -p 3000",
    "test": "vitest run",
    "lint": "next lint"
  },
  "dependencies": {
    "next": "^15.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "better-auth": "^1.1.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Create `next.config.ts`, `tsconfig.json`**

```typescript
// apps/web/next.config.ts
import type { NextConfig } from "next";
const config: NextConfig = { env: { API_BASE: process.env.API_BASE ?? "http://localhost:8787" } };
export default config;
```

```json
// apps/web/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "jsx": "preserve",
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src", "next-env.d.ts", ".next/types/**/*.ts"]
}
```

- [ ] **Step 3: Write the failing test for the API base helper**

```typescript
// apps/web/src/lib/api.test.ts
import { describe, it, expect } from "vitest";
import { apiUrl } from "./api.js";

describe("apiUrl", () => {
  it("joins the API base with a path", () => {
    expect(apiUrl("http://api:8787", "/linkedin/accounts")).toBe("http://api:8787/linkedin/accounts");
  });
  it("normalizes a missing leading slash", () => {
    expect(apiUrl("http://api:8787", "health")).toBe("http://api:8787/health");
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @outreach/web test`
Expected: FAIL — `api.js` not found.

- [ ] **Step 5: Write `src/lib/api.ts`**

```typescript
// apps/web/src/lib/api.ts
export function apiUrl(base: string, path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @outreach/web test`
Expected: PASS.

- [ ] **Step 7: Write the BFF proxy route**

```typescript
// apps/web/src/app/api/[...proxy]/route.ts
import { apiUrl } from "@/lib/api";

const API_BASE = process.env.API_BASE ?? "http://localhost:8787";

async function forward(req: Request, path: string[]): Promise<Response> {
  const url = apiUrl(API_BASE, "/" + path.join("/")) + (new URL(req.url).search || "");
  const res = await fetch(url, {
    method: req.method,
    headers: req.headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.text(),
    redirect: "manual",
  });
  // Pass through status, body, and Set-Cookie/Location headers.
  const headers = new Headers(res.headers);
  return new Response(res.body, { status: res.status, headers });
}

export async function GET(req: Request, ctx: { params: Promise<{ proxy: string[] }> }) {
  return forward(req, (await ctx.params).proxy);
}
export async function POST(req: Request, ctx: { params: Promise<{ proxy: string[] }> }) {
  return forward(req, (await ctx.params).proxy);
}
```

Note: with this proxy, the browser calls `/api/linkedin/...` on the web origin and it is forwarded to `apps/api`. Better Auth is mounted at `/api/auth/*` on the API and is reached the same way. Set `BETTER_AUTH_URL` and the LinkedIn redirect URI to whichever origin the browser actually uses (documented in `.env.example`).

- [ ] **Step 8: Write the pages (layout, login, accounts)**

```tsx
// apps/web/src/app/layout.tsx
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui", maxWidth: 720, margin: "40px auto", padding: 16 }}>
        {children}
      </body>
    </html>
  );
}
```

```tsx
// apps/web/src/app/page.tsx
export default function Home() {
  return (
    <main>
      <h1>Outreach</h1>
      <p><a href="/login">Sign in</a> · <a href="/accounts">Accounts</a></p>
    </main>
  );
}
```

```tsx
// apps/web/src/app/login/page.tsx
"use client";
import { useState } from "react";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");

  async function submit(kind: "sign-in" | "sign-up") {
    const res = await fetch(`/api/api/auth/${kind}/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email, password, name: email.split("@")[0] }),
    });
    setMsg(res.ok ? "OK — go to /accounts" : `Error ${res.status}`);
  }

  return (
    <main>
      <h1>Sign in</h1>
      <input placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input placeholder="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <div>
        <button onClick={() => submit("sign-in")}>Sign in</button>
        <button onClick={() => submit("sign-up")}>Sign up</button>
      </div>
      <p>{msg}</p>
    </main>
  );
}
```

```tsx
// apps/web/src/app/accounts/page.tsx
"use client";
import { useEffect, useState } from "react";

interface Account { id: string; displayName: string; status: string }

export default function Accounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [log, setLog] = useState("");

  async function load() {
    const res = await fetch("/api/linkedin/accounts", { credentials: "include" });
    if (res.ok) setAccounts((await res.json()).accounts);
  }
  useEffect(() => { void load(); }, []);

  async function ingest(id: string) {
    const res = await fetch(`/api/linkedin/accounts/${id}/ingest`, { method: "POST", credentials: "include" });
    setLog(await res.text());
  }
  async function importCsv(id: string, file: File) {
    const res = await fetch(`/api/linkedin/accounts/${id}/import`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "text/csv" }, body: await file.text(),
    });
    setLog(await res.text());
  }

  return (
    <main>
      <h1>LinkedIn accounts</h1>
      <p><a href="/api/linkedin/connect">+ Connect LinkedIn</a></p>
      <ul>
        {accounts.map((a) => (
          <li key={a.id}>
            {a.displayName} ({a.status})
            <button onClick={() => ingest(a.id)}>Ingest via API</button>
            <input type="file" accept=".csv" onChange={(e) => e.target.files?.[0] && importCsv(a.id, e.target.files[0])} />
          </li>
        ))}
      </ul>
      <pre>{log}</pre>
    </main>
  );
}
```

- [ ] **Step 9: Build and manual smoke**

Run: `pnpm --filter @outreach/web build`
Expected: Next build succeeds.

Manual smoke (with `apps/api` running and a real `.env`):
```
1. pnpm --filter @outreach/web dev
2. Open http://localhost:3000/login → sign up with an email/password.
3. Go to /accounts → click "Connect LinkedIn" → complete LinkedIn consent → redirected back with the account listed.
4. Click "Ingest via API" → either counts appear, or a read_unavailable message.
5. If unavailable, upload your Shares.csv → counts appear.
```

- [ ] **Step 10: Commit**

```bash
git add apps/web
git commit -m "feat(web): login, connect, accounts, ingest + CSV import UI with BFF proxy"
```

---

## Task 14: Scaffold `apps/worker` and `apps/desktop` (inert)

**Files:**
- Create: `apps/worker/package.json`, `apps/worker/tsconfig.json`, `apps/worker/src/index.ts`
- Create: `apps/desktop/package.json`, `apps/desktop/tsconfig.json`, `apps/desktop/src/main.ts`

**Interfaces:**
- Produces: two buildable-but-inert apps so the monorepo structure is complete and future sub-projects have a home. No behavior yet.

- [ ] **Step 1: Create `apps/worker`**

```json
// apps/worker/package.json
{
  "name": "@outreach/worker",
  "version": "0.0.0", "private": true, "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json --noEmit",
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "test": "vitest run --passWithNoTests",
    "lint": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": { "@outreach/db": "workspace:*" },
  "devDependencies": { "tsx": "^4.19.0", "typescript": "^5.7.0", "vitest": "^3.0.0" }
}
```

```json
// apps/worker/tsconfig.json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "noEmit": true }, "include": ["src"] }
```

```typescript
// apps/worker/src/index.ts
// Sub-project 5 (Scheduler) fills this with a pg-boss job runner.
console.log("worker: no jobs registered yet");
```

- [ ] **Step 2: Create `apps/desktop`**

```json
// apps/desktop/package.json
{
  "name": "@outreach/desktop",
  "version": "0.0.0", "private": true, "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run --passWithNoTests",
    "lint": "tsc -p tsconfig.json --noEmit"
  },
  "devDependencies": { "typescript": "^5.7.0", "vitest": "^3.0.0" }
}
```

```json
// apps/desktop/tsconfig.json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "noEmit": true }, "include": ["src"] }
```

```typescript
// apps/desktop/src/main.ts
// Electron shell arrives in a later sub-project; it will consume @outreach/api via HTTP.
export const placeholder = true;
```

- [ ] **Step 3: Verify the whole workspace builds and tests**

Run: `docker compose up -d && pnpm install && pnpm build && pnpm test`
Expected: all packages/apps build; all test suites pass.

- [ ] **Step 4: Commit**

```bash
git add apps/worker apps/desktop
git commit -m "chore: scaffold inert worker and desktop apps"
```

---

## Self-Review

**Spec coverage:**
- Monorepo (apps/api, web, desktop, worker; packages core/db/linkedin) → Tasks 1, 10–14. ✅
- Multi-tenant data model (User, LinkedInAccount, Post) → Task 5. ✅
- Token encryption at rest (AES-GCM) → Tasks 3, 11. ✅
- LinkedIn OAuth connect flow → Tasks 6, 12. ✅
- Two ingestion paths (API + CSV) with shared `PostIngestor` interface → Tasks 7, 8, 9, 12. ✅
- Dedupe `(accountId, externalId)` / content-hash → Tasks 7, 11 (via `dedupeHash` column). ✅
- Error handling: OAuth state mismatch (Task 12), read-unavailable → CSV (Tasks 9, 12), malformed CSV rows skipped (Task 8), missing `ENCRYPTION_KEY` fail-fast (Task 10 env). ✅
- Better Auth (email/password) usable by web (and later desktop) → Tasks 10, 13. ✅
- De-risking spike for personal-post read → Task 2. ✅
- Minimal web UI (login, connect, list, ingest, CSV upload) → Task 13. ✅
- `api-client` package: **deferred** — not built in Sub-project 1 because the web BFF proxy + `fetch` covers all current needs; the typed Hono RPC client is introduced when the desktop app is built. Noted here so it is a conscious omission, not a gap.

**Placeholder scan:** No TBD/TODO in executable steps. The two `apps/worker`/`apps/desktop` placeholders (Task 14) are intentional inert scaffolds with explanatory comments, not unfinished logic.

**Type consistency:** `RawPost`, `TokenResponse`, `LinkedInProfile`, `PostIngestor`, `dedupeKey`, `encrypt`/`decrypt`, `saveLinkedInAccount`/`getDecryptedAccount`/`listAccounts`, `upsertPosts` are defined once and consumed with matching signatures across tasks. `PostIngestor.fetch()` is implemented consistently by both `CsvShareIngestor` and `LinkedInApiIngestor`.

---

## Deviations from the design spec

1. **PKCE → state.** The spec mentioned PKCE; LinkedIn's authorization-code flow is a confidential-client flow that uses `state` for CSRF and does not support PKCE. Implemented with signed `state` (HMAC over `userId.nonce`) + an `httpOnly` cookie cross-check.
2. **`dedupeHash` column added.** The spec described dedupe conceptually; this plan persists a `dedupeHash` with a `(linkedinAccountId, dedupeHash)` unique constraint so dedupe is enforced by the database, not application logic alone.
3. **`packages/api-client` deferred** to the sub-project that builds the desktop client (see Self-Review).
