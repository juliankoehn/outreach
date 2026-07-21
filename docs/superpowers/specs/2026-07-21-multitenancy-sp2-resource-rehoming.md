# Multi-Tenancy SP2 — Resources → Organization + Personal-Org Rules

**Date:** 2026-07-21
**Status:** approved (brainstorm)
**Part of:** Multi-tenancy (SP2 of 3). SP1 (done) = org/membership foundation. SP3 = SaaS org-management UI.

## Problem

SP1 introduced organizations + a personal org per user + the active org in the API
context (`c.get("orgId")`), but **resources are still owned by `userId`**
(`LinkedInAccount`, `CreatorProfile`, `FeedSource`, `FeedItem` and everything
cascading off them). So the org layer is inert: a team can't share resources, and
switching org changes nothing. Also, personal orgs currently have no lifecycle
guards — nothing stops inviting a member into a personal org or deleting it.

## Goal

Make org-scoping real: every domain resource is owned by an `organization`
(active org from context), with the old `userId` kept as `createdBy` (audit).
Enforce personal-org rules (single-member, non-deletable except via account
deletion). After SP2, the app is genuinely multi-tenant at the data layer; SP3
adds the UI.

## Decisions (locked in brainstorm)

- **Ownership:** resources gain `organizationId` (FK → Organization, `onDelete:
  Cascade`); the existing `userId` becomes `createdBy String?` (FK → User,
  `onDelete: SetNull`) — deleting the creator does NOT delete an org's resource.
- **Rollout:** big-bang in one SDD run — end state is fully org-scoped, no mixed
  window.
- **Personal-org rules:** a personal org is marked; you cannot invite members
  into it and cannot delete it; it is deleted only when its owner's user account
  is deleted (cascading its resources).

## Part A — Personal-org lifecycle rules

- **Mark personal orgs.** Add a durable marker (a `personal Boolean @default(false)`
  column on `Organization`, or the plugin's `metadata` — prefer a real column for
  a security guard, not the `u-…` slug convention). `ensurePersonalOrg`
  (`apps/api/src/org.ts`) sets it; a migration backfills existing personal orgs
  (identifiable today by the `u-${userId}` slug + single owner member).
- **Invite guard.** Reject creating an invitation for a personal org (return a
  clear error). Implemented via the org plugin's hook/access API — verify the
  exact mechanism against the installed better-auth (1.4.22), like SP1.
- **Delete guard.** Reject deleting a personal org via the plugin's delete API.
- **Account deletion → delete personal org.** A `databaseHooks.user.delete` (or
  the equivalent) removes the user's personal org, whose `organizationId`-cascade
  removes its resources. Verify the delete-hook API against the installed version.
- **Tests:** inviting into a personal org is rejected; deleting a personal org is
  rejected; a team org (created via `createOrganization`) allows both; deleting a
  user removes their personal org + its resources.

## Part B — Resource re-homing

### Data model

- `LinkedInAccount`, `CreatorProfile`, `FeedSource`, `FeedItem` each gain
  `organizationId String` (FK → Organization, `onDelete: Cascade`) and change
  `userId` → `createdBy String?` (FK → User, `onDelete: SetNull`).
- Unique constraints move to the org: `LinkedInAccount @@unique([userId,
  memberUrn])` → `@@unique([organizationId, memberUrn])`; `FeedSource
  @@unique([userId, url])` → `@@unique([organizationId, url])`.
- Indexes that lead with `userId` (e.g. `FeedItem @@index([userId, status,
  publishedAt])`, `CreatorProfile @@index([userId])`) move to `organizationId`.
- `FeedItem` gets `organizationId` directly (denormalized, mirroring today's
  `userId`), set from its source's org.
- Migration hand-crafted + `prisma migrate deploy` (checksum drift — never
  `migrate dev`); keep `resource_chunk_embedding_hnsw` intact.

### Data migration (backfill)

- For each resource row: `organizationId` = the personal org of the current
  `userId` (look up via `Member` — every user has exactly one org after SP1);
  `createdBy` = the old `userId`. `FeedItem.organizationId` = its source's org.
- Run as a one-off migration/script after the columns exist; idempotent.

### Repos + routes (the seam), per domain: LinkedIn → Profile → Feed

- The ~142 ownership checks live in 11 route/repo files
  (`repos/linkedin-account.ts`, `repos/profile.ts`, `repos/post.ts`,
  `repos/feed.ts`, `repos/schedule.ts`; `routes/linkedin.ts`, `routes/profile.ts`,
  `routes/studio.ts`, `routes/feed.ts`, `routes/schedule.ts`, `routes/resources.ts`).
- **Repos:** change the scoping parameter from `userId` to `orgId` and the `where`
  clause from `{ …, userId }` to `{ …, organizationId: orgId }`. On create, set
  `organizationId` (from context) + `createdBy` (the acting `user.id`).
- **Routes:** pass `c.get("orgId")` where they previously passed `user.id` for
  ownership; the redundant `acct.userId !== user.id` post-checks become
  `acct.organizationId !== orgId` (or drop them — the repo `where` already scopes).
  `user.id` is still used where genuinely user-level (e.g. `createdBy`, `/me`,
  OAuth state signing).
- **Nested lookups** already keyed off the parent resource (e.g. `Post`/`Draft` →
  `LinkedInAccount`, `ResourceChunk` → `Resource`) stay as-is once the parent is
  org-scoped — no per-child `organizationId` needed.

### Active-org guard

- Resource routes require an active org: add a guard so a request with `orgId ===
  null` on the `/linkedin`, `/profiles`, `/studio`, `/feed`, `/schedule` groups
  returns 403 (after the existing `user` check). After SP1 every session has an
  active org, so this is defense-in-depth.

## Tests

- The ~35 test files that create accounts/profiles/feeds must set
  `organizationId` (use the acting user's personal org) + `createdBy`. Prefer a
  shared test helper (`signUpWithOrg()` → returns `{ cookie, user, orgId }`) to
  avoid touching every setup by hand where possible.
- **Cross-org isolation:** for each domain, a resource owned by org A is NOT
  visible/mutable to a session whose active org is B (real second-org test, not a
  bogus id).
- Data migration: an existing resource with `userId` gets the right
  `organizationId` + `createdBy` after backfill.
- Personal-org rule tests (Part A).
- No real network / real SMTP / real LinkedIn in any test.

## Out of scope (SP2)

- **Org management UI** (switcher, create-org, member list, invite dialog,
  accept-invitation page, account-deletion UI) — that's SP3. SP2 is API + schema +
  migration + enforcement.
- Per-resource roles/permissions beyond org membership (any member of the org can
  use the org's resources in SP2; finer-grained ACLs are future work).
