# Multi-Tenancy SP1 — Org & Membership Foundation

**Date:** 2026-07-21
**Status:** approved (brainstorm)
**Part of:** Multi-tenancy (SP1 of 3). SP2 = re-home resources to `organizationId`; SP3 = org management UI.

## Problem

Every domain resource is owned by a `User` (`userId` FK on `LinkedInAccount`,
`CreatorProfile`, `FeedSource`, `FeedItem`). There is no notion of an
organization, so the app can't be a multi-tenant SaaS: resources can't be shared
across a team, and a user can't belong to more than one workspace.

## Goal

Introduce organizations as the tenancy unit. Every user gets a personal
organization on sign-up; users can create more organizations (SaaS-style),
invite members with roles, and switch the active organization. This sub-project
builds the **auth/org/membership layer only** — resources stay user-owned until
SP2. The active org is exposed in the API context so SP2 can consume it.

## Decisions (locked in brainstorm)

- **Ownership model (for SP2):** resources will be owned by `organizationId`, and
  the existing `userId` is kept as `createdBy` (audit / "added by"). SP1 does not
  change resources yet, but the schema/design assumes this.
- **better-auth:** bump `^1.1.0` → latest `1.x` and add the official
  `organization` plugin. Verify breaking changes + the existing auth migration,
  and confirm the plugin/hook API against the installed version's docs during
  implementation (do not assume — verify, like we do with external APIs).
- **Roles:** the plugin defaults — `owner` / `admin` / `member`. The personal-org
  creator is `owner`.
- **Invitations:** real email via SMTP now (see Mailer), with the accept link;
  when SMTP is unconfigured, gracefully log the accept link instead of failing.
- **Personal org on sign-up:** always auto-created and set active.

## Auth / org plugin

- Add `organization()` to `betterAuth({ plugins: [...] })`.
- The plugin manages `Organization`, `Member`, `Invitation` and adds
  `activeOrganizationId` to `Session`. These are added to `schema.prisma` in the
  exact shape better-auth expects for the prisma adapter (generate/inspect the
  required fields against the installed version; do not hand-guess field names).
- **Personal org on sign-up:** a `databaseHooks.user.create.after` hook creates an
  organization (name from the user's name, unique slug), adds the user as an
  `owner` member, and sets it as the session's active organization. (Exact API —
  `auth.api.createOrganization` vs. adapter calls, and how to set active on the
  freshly-created session — is verified against the version's docs.)
- **Membership endpoints** come from the plugin: create org, list my orgs, set
  active org, invite member, accept/reject invite, list members, update role,
  remove member. No custom re-implementation.

## Active org in the API context

- The session already flows through the `app.use("*")` middleware that sets
  `c.set("user", …)`. Extend it to `c.set("orgId", session?.session?.activeOrganizationId ?? null)`.
- `AppEnv` gains `orgId: string | null` in its `Variables`.
- Nothing in SP1 reads `orgId` for authorization yet (resources are still
  user-scoped) — it's the seam SP2 builds on. A single smoke test asserts it's
  populated after sign-in.

## Mailer (SMTP)

- New `apps/api/src/mailer.ts`: `sendEmail({ to, subject, html, text })` via
  `nodemailer` using env config: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
  `SMTP_PASS`, `SMTP_SECURE`, `SMTP_FROM`.
- If `SMTP_HOST` is unset, `sendEmail` logs the message (subject + a key link)
  instead of sending — dev without a mailer still works, and invites still yield a
  usable accept link in the logs.
- The org plugin's `sendInvitationEmail` callback renders the invite (inviter,
  org name, role, accept URL built from `WEB_ORIGIN` + the invitation id) and
  calls `sendEmail`.
- The mailer is injectable so tests never hit real SMTP.
- `.env.example` documents the `SMTP_*` vars (all optional; empty = log fallback).

## Data migration (backfill existing users)

- For every existing `User` without a personal org: create an `Organization`
  (name from the user), add the user as `owner` member, and set the user's
  active organization to it. Idempotent.
- Hand-crafted SQL migration for the new org/member/invitation tables +
  `Session.activeOrganizationId`, applied with `prisma migrate deploy` (repo has
  checksum drift that makes `migrate dev` reset the DB — avoid). The
  `resource_chunk_embedding_hnsw` index must stay intact. The backfill runs as a
  one-off script (or SQL) after the tables exist.

## Testing

- **auth (integration):** sign-up → a personal org exists, the user is its `owner`
  member, and the session's `activeOrganizationId` points to it.
- create a second org → the user is `owner` of both; switching active org updates
  the session/context.
- invite a member → an `Invitation` is created and the (mocked) mailer is called
  with the accept URL; accepting adds the invitee as a `member` with the given
  role; a non-owner/admin cannot invite.
- context smoke test: after sign-in, `c.get("orgId")` is the active org.
- mailer: `sendEmail` uses the injected transport; unset `SMTP_HOST` → logs
  instead of throwing.
- No real SMTP and no real network in any test.

## Out of scope (SP1)

- **Re-homing resources to `organizationId`** and migrating the ~142 ownership
  checks — that's SP2.
- **Org management UI** (create/switch org, member list, role editor, invite
  dialog) — that's SP3. SP1 is API + migration only.
- Email verification / password reset (the mailer is built to enable them later).
