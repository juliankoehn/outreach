# Multi-Tenancy SP2 — Resources → Organization + Personal-Org Rules — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every domain resource org-owned (`organizationId`, active org from `c.get("orgId")`), keep the old `userId` as `createdBy` (audit), and enforce personal-org rules (no invites, non-deletable except via account deletion).

**Architecture:** Add `organizationId` to `LinkedInAccount`/`CreatorProfile`/`FeedSource`/`FeedItem` and backfill from each user's personal org (via `Member`); migrate the repos' scoping parameter `userId` → `orgId` domain-by-domain (routes pass `c.get("orgId")`); finalize by renaming `userId`→`createdBy` (nullable, SetNull) + swapping unique/index constraints + guarding resource routes on an active org. Personal orgs are marked and guarded via the better-auth org plugin.

**Tech Stack:** Prisma 7 (pg adapter), Hono, better-auth 1.4.22 (organization plugin), vitest.

## Global Constraints

- **Ownership:** `organizationId String` → Organization, `onDelete: Cascade`. `createdBy String?` → User, `onDelete: SetNull`. Deleting a user must NOT delete an org's resource.
- **Keep the build GREEN after every task.** The migration is staged: add `organizationId` (nullable) + backfill FIRST (keep `userId`), migrate repos/routes per domain, then finalize (NOT NULL + rename `userId`→`createdBy` + constraints) LAST. No task may leave the api package uncompilable or the suite red.
- **Migrations:** hand-crafted SQL + `prisma migrate deploy` — NEVER `migrate dev`. Keep `resource_chunk_embedding_hnsw` intact. `DATABASE_URL="postgresql://outreach:outreach@localhost:5544/outreach"`.
- **Verify better-auth against the installed 1.4.22** — the org-plugin hooks for blocking invite/delete and the user-delete hook are version-specific; get them from the installed types/docs, don't guess (as in SP1).
- **Cross-org isolation is the proof.** Every domain task adds a test where a resource owned by org A is NOT readable/mutable by a session whose active org is B — using a REAL second org (a second signed-up user's personal org, or a created team org), never a bogus id.
- **Personal-org rules:** a personal org rejects invites and deletion; it is removed only when its owner's user account is deleted (cascading its resources).
- `user.id` remains only where genuinely user-level: `createdBy`, `GET /me`, OAuth state signing. All resource ownership scoping moves to `orgId`.
- No real network / SMTP / LinkedIn in any test.

## Test helper (used across tasks)

Add `apps/api/src/test-helpers.ts` (or extend an existing one) exporting `signUpWithOrg(app)` → `{ cookie, user, orgId }`: signs up via `/api/auth/sign-up/email` (as in `auth-org.test.ts`), reads the user, and returns their personal org id (from their `Member` row). Domain tests use it so a resource can be created against a known org and a SECOND `signUpWithOrg` gives an isolated org B.

---

### Task A1: Mark personal organizations

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (Organization gains `personal Boolean @default(false)`)
- Create: `packages/db/prisma/migrations/<ts>_org_personal_flag/migration.sql`
- Modify: `apps/api/src/org.ts` (`ensurePersonalOrg` sets `personal: true`)
- Test: `apps/api/src/org.test.ts`

**Interfaces:**
- Produces: `Organization.personal` (true for personal orgs); `ensurePersonalOrg` sets it.

- [ ] **Step 1: Schema + migration**

Add to `model Organization` (schema.prisma:68): `personal Boolean @default(false)`. Hand-craft `migration.sql`:
```sql
ALTER TABLE "Organization" ADD COLUMN "personal" BOOLEAN NOT NULL DEFAULT false;
-- Backfill: personal orgs are the ones ensurePersonalOrg made (slug u-<userId>, single owner member).
UPDATE "Organization" SET "personal" = true WHERE "slug" LIKE 'u-%';
```
Apply via `prisma migrate deploy` + `prisma generate`; verify HNSW intact + the column exists.

- [ ] **Step 2: Write the failing test**

`org.test.ts`: sign up a user, assert their personal org row has `personal === true` (query `prisma.organization` via the member).

- [ ] **Step 3: Set the flag in `ensurePersonalOrg`**

In `apps/api/src/org.ts`, add `personal: true` to the `organization.create({ data: … })`. (No behavior change beyond the flag.)

- [ ] **Step 4: Run tests + lint** — `pnpm --filter @outreach/api exec vitest run src/org.test.ts src/auth-org.test.ts && pnpm --filter @outreach/api lint`.

- [ ] **Step 5: Commit** — `feat(auth): mark personal organizations (Organization.personal)`.

---

### Task A2: Personal-org guards (no invite, no delete, delete on account deletion)

**Files:**
- Modify: `apps/api/src/auth.ts`
- Test: `apps/api/src/auth-personal-org.test.ts`

**Interfaces:**
- Consumes: `Organization.personal` (A1), the org plugin.
- Produces: inviting into / deleting a personal org is rejected; deleting a user deletes their personal org (+ cascaded resources).

- [ ] **Step 1: Verify the plugin hook API**

Inspect the installed `better-auth@1.4.22` organization-plugin types/source for the supported way to (a) block an invitation, (b) block an organization deletion, and (c) a user-delete hook. Candidates to confirm: `organization({ organizationHooks: { beforeCreateInvitation, beforeDeleteOrganization } })` or per-endpoint access checks; `databaseHooks.user.delete.before/after`. Record the exact mechanism in the report.

- [ ] **Step 2: Write the failing tests**

`auth-personal-org.test.ts`:
- Sign up user A; attempt to invite `x@ex.com` into A's personal org → expect rejection (error / non-2xx).
- Attempt to delete A's personal org via the plugin API → expect rejection.
- Create a TEAM org for A (`auth.api.createOrganization`) → inviting + deleting it SUCCEED (proves the guard is scoped to personal orgs only).
- Create user B with a resource-less personal org, delete user B's account → B's personal org row is gone.

- [ ] **Step 3: Implement the guards**

Using the verified mechanism: reject `createInvitation`/`deleteOrganization` when the target org has `personal === true` (look it up); add a `user.delete` hook that deletes the user's personal org (its `organizationId`-cascade removes resources). Keep the errors clear.

- [ ] **Step 4: Run tests + lint.**

- [ ] **Step 5: Commit** — `feat(auth): personal orgs reject invites + deletion; account deletion removes them`.

---

### Task B1: Schema — add `organizationId` (nullable) + backfill; keep `userId`

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (4 models)
- Create: `packages/db/prisma/migrations/<ts>_resource_org_id/migration.sql`
- Test: `apps/api/src/scripts/backfill-resource-orgs.test.ts` (+ optional script)

**Interfaces:**
- Produces: `organizationId String?` + FK (Cascade) on `LinkedInAccount`(109)/`CreatorProfile`(156)/`FeedSource`(251)/`FeedItem`(265); all existing rows backfilled to the owner user's personal org. `userId` unchanged (build stays green).

- [ ] **Step 1: Schema — add nullable `organizationId` + relation to each of the 4 models**

For each model add:
```prisma
  organizationId String?
  organization   Organization? @relation(fields: [organizationId], references: [id], onDelete: Cascade)
```
Add the inverse relations on `Organization`. Keep everything else (including `userId`) as-is for now.

- [ ] **Step 2: Migration — add columns + backfill from `Member`**

Hand-craft `migration.sql` (nullable add + FK + data backfill in one file):
```sql
ALTER TABLE "LinkedInAccount" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "CreatorProfile"  ADD COLUMN "organizationId" TEXT;
ALTER TABLE "FeedSource"      ADD COLUMN "organizationId" TEXT;
ALTER TABLE "FeedItem"        ADD COLUMN "organizationId" TEXT;

-- Each user has exactly one org (their personal org) after SP1 → map via Member.
UPDATE "LinkedInAccount" a SET "organizationId" = m."organizationId"
  FROM "Member" m WHERE m."userId" = a."userId";
UPDATE "CreatorProfile" c SET "organizationId" = m."organizationId"
  FROM "Member" m WHERE m."userId" = c."userId";
UPDATE "FeedSource" s SET "organizationId" = m."organizationId"
  FROM "Member" m WHERE m."userId" = s."userId";
-- FeedItem: inherit from its source (keeps it consistent even if item.userId drifted).
UPDATE "FeedItem" i SET "organizationId" = s."organizationId"
  FROM "FeedSource" s WHERE s."id" = i."sourceId";

ALTER TABLE "LinkedInAccount" ADD CONSTRAINT "LinkedInAccount_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CreatorProfile" ADD CONSTRAINT "CreatorProfile_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FeedSource" ADD CONSTRAINT "FeedSource_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FeedItem" ADD CONSTRAINT "FeedItem_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```
Apply via `migrate deploy` + `generate`; verify HNSW intact, the 4 columns present, and that **no resource row has a NULL organizationId** (`SELECT count(*) FROM "LinkedInAccount" WHERE "organizationId" IS NULL;` = 0 for each — any non-zero means an owner had no Member; investigate before proceeding).

- [ ] **Step 3: Test the backfill invariant**

`backfill-resource-orgs.test.ts`: create a user (→ personal org), create a `LinkedInAccount` + `CreatorProfile` + `FeedSource` + `FeedItem` for them WITHOUT organizationId (simulating pre-migration rows), run the same UPDATE logic (extract it into a `backfillResourceOrgs()` fn the test can call, or run raw SQL), assert each row's `organizationId` equals the user's personal org.

- [ ] **Step 4: Run tests (full suite must stay green — repos still use userId) + lint.**

- [ ] **Step 5: Commit** — `feat(db): add organizationId to resources + backfill from personal org`.

---

### Task B2: `linkedin-account` repo + ALL its callers → org-scoped

**CRITICAL:** these repo functions are called from MORE than `routes/linkedin.ts` — `getAccountSummary`/`getDecryptedAccount`/`getAccountIdForProfile`/`getProfileImageProviders`/`setAccountImageProvider` are also used by `routes/studio.ts`, `routes/profile.ts`, `routes/schedule.ts`, `publish/publish-draft.ts`, and `image-gen.ts`. Changing a function's scoping param from `userId` to `orgId` REQUIRES updating EVERY call site in the SAME task, or the build breaks / ownership silently scopes by the wrong id. Grep each changed function name across `apps/api/src` and update all callers.

**Files:**
- Modify: `apps/api/src/repos/linkedin-account.ts` + every file that calls its changed functions (at least `routes/linkedin.ts`, `routes/studio.ts`, `routes/profile.ts`, `routes/schedule.ts`, `publish/publish-draft.ts`, `image-gen.ts` — confirm via grep)
- Test: `apps/api/src/routes/linkedin-org.test.ts` (+ update existing linkedin/account tests to set org)

**Interfaces:**
- Consumes: `organizationId` (B1); `c.get("orgId")`.
- Produces: LinkedIn account ownership is scoped by `organizationId`; create sets `organizationId` (from context) + keeps `userId` (createdBy-to-be).

- [ ] **Step 1: Migrate the repo functions (uniform pattern)**

In `repos/linkedin-account.ts`, change the SCOPING parameter from `userId` to `orgId` and the `where` clause from `{ …, userId }` to `{ …, organizationId: orgId }`, in exactly these functions:
`getDecryptedAccount(id, orgId)`, `listAccounts(orgId)`, `getAccountSummary(id, orgId)`, `getAccountIdForProfile(profileId, orgId)`, `getProfileImageProviders(profileId, orgId)`, `setAccountImageProvider(id, orgId, …)`.
`saveLinkedInAccount(input)`: `input` gains `organizationId` (set it on create/upsert), keeps `userId`; the upsert unique key stays `[userId, memberUrn]` for now (swapped in B5). Any returned object that exposed `userId` for an `acct.userId !== user.id` route check should also expose `organizationId`.

Example (pattern):
```ts
// before
export async function getAccountSummary(id: string, userId: string) {
  return prisma.linkedInAccount.findFirst({ where: { id, userId }, select: {…} });
}
// after
export async function getAccountSummary(id: string, orgId: string) {
  return prisma.linkedInAccount.findFirst({ where: { id, organizationId: orgId }, select: {…} });
}
```

- [ ] **Step 2: Update EVERY caller of the changed functions**

Grep each changed function name (`getAccountSummary`, `getDecryptedAccount`, `getAccountIdForProfile`, `getProfileImageProviders`, `setAccountImageProvider`, `listAccounts`) across `apps/api/src`. In each caller, pass `c.get("orgId")!` (routes) or the threaded `orgId` (repos/services like `image-gen.ts`, `publish-draft.ts`) instead of `user.id`. Change `acct.userId !== user.id` post-checks to `acct.organizationId !== orgId` (or drop them — the repo `where` already scopes). Keep `user.id` for `saveLinkedInAccount`'s `createdBy` (on connect) and OAuth state. On connect/create, pass BOTH `organizationId: c.get("orgId")` and `userId: user.id`. The api package must compile after this step (no caller left passing `user.id` as the org scope).

- [ ] **Step 3: Cross-org isolation test + fix existing tests**

`linkedin-org.test.ts` (using `signUpWithOrg`): user A connects/creates an account (seed via prisma with A's orgId) → A's session lists it; a SECOND user B (own org) does NOT see it and gets 404 on `GET /linkedin/accounts/:id` for A's account. Update existing `linkedin`/account-touching tests so their seeded `LinkedInAccount` rows include `organizationId` (A's org) — the shared `signUpWithOrg` helper gives the org id.

- [ ] **Step 4: Run tests (targeted + full suite) + lint** — all green.

- [ ] **Step 5: Commit** — `feat(api): scope LinkedIn accounts by organization`.

---

### Task B3: `profile` repo + ALL its callers → org-scoped

**CRITICAL (same as B2):** profile repo functions are called from `routes/profile.ts` AND `routes/studio.ts` (and possibly `image-gen.ts`). Grep each changed function name across `apps/api/src` and update EVERY caller in this task so the package compiles and ownership scopes by `orgId`.

**Files:**
- Modify: `apps/api/src/repos/profile.ts` + every caller of its changed functions (`routes/profile.ts`, `routes/studio.ts`, confirm via grep)
- Test: `apps/api/src/routes/profile-org.test.ts` (+ update existing profile/studio tests)

**Interfaces:**
- Produces: CreatorProfile ownership scoped by `organizationId`; create sets `organizationId` + `userId` (createdBy-to-be).

- [ ] **Step 1: Migrate the repo functions**

In `repos/profile.ts`, `userId` scoping param → `orgId`, `where { …, userId }` → `where { …, organizationId: orgId }`, in:
`listProfiles(orgId)`, `createProfile(orgId, name?, createdBy)` (create sets `organizationId: orgId` + `userId: createdBy`), `getProfileById(id, orgId)`, `updateProfileById(id, orgId, data)`, `deleteProfileById(id, orgId)`, `assignProfileToAccount(…, orgId)`, `unassignProfileFromAccount(accountId, orgId)`, `getOrCreateAccountProfile(accountId, orgId, createdBy)`.
`getAccountProfile(accountId)` stays as-is (already keyed off the account, which is org-scoped after B2).

- [ ] **Step 2: Migrate the routes**

`routes/profile.ts` (and `studio.ts` where it calls `getOrCreateAccountProfile`/profile repos): pass `c.get("orgId")!` for ownership; pass `user.id` only as `createdBy` on create.

- [ ] **Step 3: Cross-org isolation test + fix existing tests**

`profile-org.test.ts`: A creates a profile → visible to A, 404 for B. Update existing profile/studio tests' seeded `CreatorProfile` rows to include `organizationId`.

- [ ] **Step 4: Run tests + lint** — green.

- [ ] **Step 5: Commit** — `feat(api): scope creator profiles by organization`.

---

### Task B4: `feed` repo + ALL its callers → org-scoped

**CRITICAL (same as B2/B3):** grep each changed feed-repo function across `apps/api/src` (feed functions are called from `routes/feed.ts`, and `getItem` may be used by `routes/studio.ts` for feed-sourced drafts) and update EVERY caller so the package compiles and scopes by `orgId`.

**Files:**
- Modify: `apps/api/src/repos/feed.ts` + every caller of its changed functions (`routes/feed.ts`, and `routes/studio.ts` if it uses `getItem`, confirm via grep)
- Test: `apps/api/src/routes/feed-org.test.ts` (+ update existing feed tests)

**Interfaces:**
- Produces: FeedSource + FeedItem ownership scoped by `organizationId`.

- [ ] **Step 1: Migrate the repo functions**

In `repos/feed.ts`, `userId` scoping → `orgId`, in:
`createSource(input)` (input gains `organizationId`, keeps `userId`), `listSources(orgId)`, `getSource(id, orgId)`, `deleteSource(id, orgId)`, `getItem(id, orgId)`, `listItems(…, orgId)`, `setItemStatus(…, orgId)`, `updateItemContent(id, orgId, content)`. `insertItems(...)` sets each item's `organizationId` from its source's org (or pass it in). The `FeedItem` where-scoping uses `organizationId`.

- [ ] **Step 2: Migrate the routes**

`routes/feed.ts`: pass `c.get("orgId")!` for ownership; `user.id` only as `createdBy` on source create.

- [ ] **Step 3: Cross-org isolation test + fix existing tests**

`feed-org.test.ts`: A adds a feed source + items → visible to A, 404/empty for B. Update existing feed tests' seeded rows with `organizationId`.

- [ ] **Step 4: Run tests + lint** — green.

- [ ] **Step 5: Commit** — `feat(api): scope feed sources + items by organization`.

---

### Task B5: Finalize — NOT NULL, `userId`→`createdBy`, constraints, active-org guard

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (4 models), `apps/api/src/app.ts`, and the ~4 create sites that still write `userId` (`saveLinkedInAccount`, `createProfile`/`getOrCreateAccountProfile`, `createSource`, `insertItems`)
- Create: `packages/db/prisma/migrations/<ts>_resource_org_finalize/migration.sql`
- Test: `apps/api/src/routes/active-org-guard.test.ts`

**Interfaces:**
- Produces: `organizationId String` (NOT NULL); `createdBy String?` (renamed from `userId`, `onDelete: SetNull`); org-scoped unique/index constraints; resource route groups 403 when no active org.

- [ ] **Step 1: Schema — finalize the 4 models**

For each model: make `organizationId String` (drop the `?`), rename `userId` → `createdBy String?` with `user User? @relation(fields: [createdBy], references: [id], onDelete: SetNull)`. Swap constraints: `LinkedInAccount @@unique([organizationId, memberUrn])` (drop `[userId, memberUrn]`); `FeedSource @@unique([organizationId, url])` (drop `[userId, url]`); indexes leading with `userId` → `organizationId` (`CreatorProfile @@index([organizationId])`, `FeedItem @@index([organizationId, status, publishedAt])`).

- [ ] **Step 2: Migration**

Hand-craft `migration.sql`. FIRST, defensively re-run the B1 backfill (idempotent — covers any row created in the migration window that missed `organizationId`): `UPDATE "LinkedInAccount" a SET "organizationId"=m."organizationId" FROM "Member" m WHERE m."userId"=a."userId" AND a."organizationId" IS NULL;` (and the same for CreatorProfile/FeedSource, plus FeedItem-from-source). THEN `ALTER COLUMN "organizationId" SET NOT NULL` (all 4), `ALTER TABLE … RENAME COLUMN "userId" TO "createdBy"` + `ALTER COLUMN "createdBy" DROP NOT NULL`, drop the old User FK + add the new one (`ON DELETE SET NULL`), drop the old unique/index + create the org-based ones. Apply via `migrate deploy` + `generate`; verify HNSW intact + the constraints exist + `createdBy` is nullable.

- [ ] **Step 3: Update the create sites for the rename**

The functions that wrote `userId` now write `createdBy`: `saveLinkedInAccount` (upsert key is now `[organizationId, memberUrn]`), `createProfile`/`getOrCreateAccountProfile`, `createSource`, `insertItems`. Update those `data: { userId }` → `data: { createdBy }` and the upsert `where` to the org unique key.

- [ ] **Step 4: Active-org guard**

In `app.ts`, add to the `/linkedin/*`, `/profiles/*`, `/studio/*`, `/feed/*`, `/schedule/*` group guards (which already check `user`): after the user check, `if (!c.get("orgId")) return c.json({ error: "no_active_org" }, 403);`.

- [ ] **Step 5: Test + full suite**

`active-org-guard.test.ts`: a signed-in session with its active org unset (construct one, or clear `activeOrganizationId`) → a resource route returns 403. Then run the WHOLE api suite + lint — everything green. Fix any lingering `userId`-scoping references the compiler flags (there should be none left after B2-B4).

- [ ] **Step 6: Commit** — `feat(db,api): finalize org ownership (NOT NULL, createdBy, constraints, active-org guard)`.

---

## Final verification (whole branch)

- `pnpm --filter @outreach/api exec vitest run` + `pnpm --filter @outreach/api lint` + `pnpm --filter web exec tsc --noEmit` — all green.
- `psql` checks: every resource table has a NOT NULL `organizationId`, a nullable `createdBy`, the org-based unique/index constraints, and the HNSW index intact.
- **Live:** two users (two personal orgs). User A connects a LinkedIn account / creates a profile / adds a feed → user B (different active org) cannot see or open them (404). Inviting into / deleting a personal org is rejected. Everything A does still works within A's org.
- Confirm no route still scopes a resource by `user.id` (grep) — ownership is `orgId` everywhere; `user.id` remains only for `createdBy`, `/me`, and OAuth state.
