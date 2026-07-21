# Multi-Tenancy SP1 — Org & Membership Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce organizations (better-auth `organization` plugin): a personal org on sign-up, create/switch orgs, invite members with roles, an SMTP mailer for invites, and the active org exposed in the API context — without changing resource ownership yet (SP2).

**Architecture:** better-auth bumped to latest 1.x + the `organization` plugin manages Organization/Member/Invitation + `Session.activeOrganizationId`. A `databaseHooks.user.create.after` hook auto-creates a personal org. A nodemailer SMTP mailer (with a log fallback) sends invite emails. The `*` session middleware also exposes `orgId`.

**Tech Stack:** better-auth (org plugin), Prisma 7 (pg adapter), Hono, nodemailer, vitest.

## Global Constraints

- **Verify better-auth against the INSTALLED version — do not guess.** The exact org-plugin schema (Organization/Member/Invitation field names) and the org-creation / set-active / invitation APIs are version-specific. Get the schema from the official CLI (`npx @better-auth/cli@latest generate`) and the APIs from the installed version's docs/types. Where this plan shows better-auth calls, treat them as the shape to RECONCILE against the installed version, exactly like verifying an external API.
- **Migrations:** hand-crafted SQL + `prisma migrate deploy` — NEVER `prisma migrate dev` (repo checksum drift resets the dev DB). Keep the `resource_chunk_embedding_hnsw` index intact. `DATABASE_URL="postgresql://outreach:outreach@localhost:5544/outreach"`.
- **SP1 does NOT touch domain resources.** `LinkedInAccount`/`CreatorProfile`/`FeedSource`/`FeedItem` stay `userId`-owned. `orgId` is exposed in context but not yet used for authorization.
- **No real SMTP and no real network in any test.** The mailer transport is injectable; tests inject a fake. Existing auth tests must stay green.
- **Mailer graceful:** when `SMTP_HOST` is unset, `sendEmail` logs (subject + primary link) and does NOT throw — dev without a mailer keeps working, invites still yield a usable accept link in the logs.
- **Roles:** the plugin defaults `owner`/`admin`/`member`; the personal-org creator is `owner`.

---

### Task 1: Bump better-auth + add the organization plugin + schema + migration

**Files:**
- Modify: `apps/api/package.json` (bump `better-auth`, add `@better-auth/cli` devDep)
- Modify: `apps/api/src/auth.ts`
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<ts>_org_plugin/migration.sql`

**Interfaces:**
- Produces: `auth` with the `organization` plugin enabled; `Organization`, `Member`, `Invitation` tables; `Session.activeOrganizationId`.

- [ ] **Step 1: Bump better-auth + install the CLI**

In `apps/api/package.json`, set `"better-auth": "^1.3.0"` (or the current latest 1.x) and add `"@better-auth/cli": "^1.3.0"` to devDependencies. Run `pnpm install`. Confirm the installed version: `pnpm --filter @outreach/api exec better-auth --version` (or read `node_modules/.pnpm` — record the exact version in the report).

- [ ] **Step 2: Add the organization plugin to auth.ts**

```ts
import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "@outreach/db";
import { env } from "./env.js";

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  emailAndPassword: { enabled: true },
  trustedOrigins: [env.WEB_ORIGIN],
  plugins: [organization()],
});

export type AuthUser = typeof auth.$Infer.Session.user;
```
(Reconcile the import path + plugin name against the installed version's docs.)

- [ ] **Step 3: Generate the required schema from better-auth**

Run the official CLI to get the exact Prisma models the org plugin needs:
```bash
cd apps/api && DATABASE_URL="postgresql://outreach:outreach@localhost:5544/outreach" pnpm exec @better-auth/cli generate --config src/auth.ts
```
It prints/writes the additional models (`Organization`, `Member`, `Invitation`) and the `Session.activeOrganizationId` field. **Copy those exact models/fields** into `packages/db/prisma/schema.prisma` (add relations to `User` where the generated schema indicates). Do not invent field names — use the CLI output verbatim. If the CLI can't run, take the models from the installed version's org-plugin schema docs and note that in the report.

- [ ] **Step 4: Hand-craft the migration + apply**

Diff the added models into SQL by hand (CREATE TABLE for the new tables + ALTER TABLE "Session" ADD COLUMN "activeOrganizationId"...). Create `packages/db/prisma/migrations/<YYYYMMDDHHMMSS>_org_plugin/migration.sql`. Apply:
```bash
export DATABASE_URL="postgresql://outreach:outreach@localhost:5544/outreach"
pnpm --filter @outreach/db exec prisma migrate deploy
pnpm --filter @outreach/db exec prisma generate
psql "$DATABASE_URL" -tAc "SELECT indexname FROM pg_indexes WHERE indexname='resource_chunk_embedding_hnsw';"
psql "$DATABASE_URL" -tAc "SELECT table_name FROM information_schema.tables WHERE table_name IN ('Organization','Member','Invitation') ORDER BY 1;"
psql "$DATABASE_URL" -tAc "SELECT column_name FROM information_schema.columns WHERE table_name='Session' AND column_name='activeOrganizationId';"
```
Expected: HNSW present; the 3 tables present; the Session column present.

- [ ] **Step 5: Smoke test — the app + auth still boot**

Run the existing api suite: `pnpm --filter @outreach/api exec vitest run` — must stay green (sign-up/session still work with the plugin added). Fix any adapter/typing fallout. `pnpm --filter @outreach/api lint`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/src/auth.ts packages/db/prisma
git commit -m "feat(auth): bump better-auth + add organization plugin (org/member/invitation tables)"
```

---

### Task 2: Personal org on sign-up

**Files:**
- Modify: `apps/api/src/auth.ts`
- Test: `apps/api/src/auth-org.test.ts`

**Interfaces:**
- Consumes: `auth`, the org tables (Task 1).
- Produces: after any sign-up, a personal `Organization` exists, the user is its `owner` `Member`, and the session's `activeOrganizationId` is that org.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/auth-org.test.ts` — sign up via `app.request("/api/auth/sign-up/email", …)` (mirror the pattern in `apps/api/src/routes/studio.test.ts`), then assert against the DB with `prisma`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@outreach/db";
import { createApp } from "./app.js";

const app = createApp();
const created: string[] = [];

async function signUp() {
  const email = `o${Date.now()}${Math.floor(Math.random() * 1e6)}@ex.com`;
  const res = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: process.env.WEB_ORIGIN! },
    body: JSON.stringify({ email, password: "password-1234", name: "Owner Person" }),
  });
  const cookie = res.headers.get("set-cookie")!.split(";")[0]!;
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  created.push(user.id);
  return { cookie, user };
}

afterAll(async () => { for (const id of created) await prisma.user.delete({ where: { id } }).catch(() => {}); });

describe("personal org on sign-up", () => {
  it("creates a personal org with the user as owner and sets it active", async () => {
    const { user } = await signUp();
    const members = await prisma.member.findMany({ where: { userId: user.id }, include: { organization: true } });
    expect(members.length).toBe(1);
    expect(members[0]!.role).toBe("owner");
    const session = await prisma.session.findFirstOrThrow({ where: { userId: user.id } });
    expect(session.activeOrganizationId).toBe(members[0]!.organizationId);
  });
});
```
(Adjust `prisma.member` / field names to the CLI-generated schema from Task 1.)

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @outreach/api exec vitest run src/auth-org.test.ts`
Expected: FAIL — no member/org created on sign-up.

- [ ] **Step 3: Add the sign-up hook**

In `auth.ts`, add a `databaseHooks.user.create.after` hook that creates the org + owner member + sets active. Use the installed version's supported mechanism — verify against docs. The documented pattern (reconcile names):

```ts
export const auth = betterAuth({
  // …existing config + plugins: [organization()] …
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          const org = await auth.api.createOrganization({
            body: { name: user.name || user.email, slug: `u-${user.id}` },
            // create on behalf of the just-created user
            headers: undefined,
          });
          // ensure owner membership + set active — via the plugin API / adapter,
          // per the installed version's docs (createOrganization may already add
          // the creator as owner; setting the *active* org on the fresh session
          // may need setActiveOrganization or a session-create hook).
        },
      },
    },
  },
});
```
If `createOrganization` requires a request context the after-hook can't provide, fall back to writing the `Organization` + `Member(role:"owner")` rows via `prisma` directly and setting `Session.activeOrganizationId` in a `databaseHooks.session.create.before/after` hook. Whichever path the installed version supports, the end state MUST match the test. Document the chosen mechanism in the report.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @outreach/api exec vitest run src/auth-org.test.ts && pnpm --filter @outreach/api lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth.ts apps/api/src/auth-org.test.ts
git commit -m "feat(auth): auto-create a personal org (owner) on sign-up + set active"
```

---

### Task 3: Expose the active org in the API context (+ `/me`)

**Files:**
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/src/routes/me.test.ts`

**Interfaces:**
- Consumes: the session's `activeOrganizationId` (Task 1/2).
- Produces: `AppEnv.Variables.orgId: string | null`, set by the `*` middleware; `GET /me` → `{ user: { id, email, name }, orgId }`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/routes/me.test.ts`: sign up (as in Task 2), then `GET /me` with the cookie, assert `200` and that `orgId` is non-null and equals the user's member org.

- [ ] **Step 2: Run it to verify it fails** — `GET /me` 404s.

- [ ] **Step 3: Implement**

In `app.ts`:
```ts
export type AppEnv = { Variables: { user: AuthUser | null; orgId: string | null } };
```
In the `app.use("*")` session middleware, set both:
```ts
const session = await auth.api.getSession({ headers: c.req.raw.headers });
c.set("user", session?.user ?? null);
c.set("orgId", session?.session?.activeOrganizationId ?? null);
```
Add a `GET /me` route (after the session middleware) guarded by `c.get("user")`:
```ts
app.get("/me", (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "unauthorized" }, 401);
  return c.json({ user: { id: user.id, email: user.email, name: user.name }, orgId: c.get("orgId") });
});
```
(Reconcile `session.session.activeOrganizationId` with the installed version's session shape.)

- [ ] **Step 4: Run tests to verify they pass** — `pnpm --filter @outreach/api exec vitest run src/routes/me.test.ts && pnpm --filter @outreach/api lint`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/app.ts apps/api/src/routes/me.test.ts
git commit -m "feat(api): expose active orgId in context + GET /me"
```

---

### Task 4: SMTP mailer

**Files:**
- Modify: `apps/api/package.json` (add `nodemailer` + `@types/nodemailer`)
- Modify: `apps/api/src/env.ts`
- Create: `apps/api/src/mailer.ts`
- Modify: `.env.example`
- Test: `apps/api/src/mailer.test.ts`

**Interfaces:**
- Produces: `sendEmail(msg, deps?): Promise<void>` where `msg = { to, subject, html?, text? }` and `deps?.transport` is injectable.

- [ ] **Step 1: Add env vars**

In `apps/api/src/env.ts` schema, add (all optional):
```ts
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_SECURE: z.coerce.boolean().default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default("Outreach <no-reply@localhost>"),
```

- [ ] **Step 2: Write the failing test**

Create `apps/api/src/mailer.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { sendEmail } from "./mailer.js";

describe("sendEmail", () => {
  it("sends via the injected transport", async () => {
    const sendMail = vi.fn(async () => ({ messageId: "1" }));
    await sendEmail({ to: "a@b.com", subject: "Hi", text: "yo" }, { transport: { sendMail } as never });
    expect(sendMail).toHaveBeenCalledOnce();
    expect(sendMail.mock.calls[0]![0]).toMatchObject({ to: "a@b.com", subject: "Hi" });
  });

  it("logs instead of throwing when no transport and SMTP is unconfigured", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(sendEmail({ to: "a@b.com", subject: "Invite", text: "link: https://x/y" })).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
```

- [ ] **Step 3: Run it to verify it fails** — module missing.

- [ ] **Step 4: Implement `mailer.ts`**

```ts
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "./env.js";

export interface EmailMessage {
  to: string;
  subject: string;
  html?: string;
  text?: string;
}

let cached: Transporter | null = null;
function defaultTransport(): Transporter | null {
  if (!env.SMTP_HOST) return null;
  if (!cached) {
    cached = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT ?? 587,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
  }
  return cached;
}

// Send an email. With no configured SMTP (and no injected transport) it logs the
// message instead of throwing, so dev without a mailer keeps working.
export async function sendEmail(msg: EmailMessage, deps?: { transport?: Transporter }): Promise<void> {
  const transport = deps?.transport ?? defaultTransport();
  if (!transport) {
    console.log(`[mailer:log-only] to=${msg.to} subject=${msg.subject}\n${msg.text ?? msg.html ?? ""}`);
    return;
  }
  await transport.sendMail({ from: env.SMTP_FROM, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text });
}
```

- [ ] **Step 5: Document env** — add the `SMTP_*` block to `.env.example` (all optional; empty `SMTP_HOST` = log fallback).

- [ ] **Step 6: Run tests + lint** — `pnpm --filter @outreach/api exec vitest run src/mailer.test.ts && pnpm --filter @outreach/api lint`.

- [ ] **Step 7: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/src/env.ts apps/api/src/mailer.ts apps/api/src/mailer.test.ts .env.example
git commit -m "feat(api): SMTP mailer (nodemailer) with log fallback"
```

---

### Task 5: Wire invitation emails through the mailer

**Files:**
- Modify: `apps/api/src/auth.ts`
- Test: `apps/api/src/auth-invite.test.ts`

**Interfaces:**
- Consumes: `sendEmail` (Task 4), the org plugin's invitation API (Task 1).
- Produces: `organization({ sendInvitationEmail })` renders the invite (inviter, org, role, accept URL from `WEB_ORIGIN` + invitation id) and calls `sendEmail`. Invitation is injectable-mailer for tests.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/auth-invite.test.ts`: sign up user A (owner of personal org), invite `b@ex.com` via the plugin's invite API (`auth.api.createInvitation({ body: { email, role: "member", organizationId }, headers })` — reconcile against the installed version), and assert the mailer was called with an accept URL. Use a module mock or an injected mailer: mock `./mailer.js`'s `sendEmail` with `vi.mock` and assert it received the invite email containing `WEB_ORIGIN` + the invitation id. Then accept the invitation (create user B, `auth.api.acceptInvitation({ body: { invitationId }, headers: bCookie })`) and assert B is now a `member` of A's org.

- [ ] **Step 2: Run it to verify it fails** — `sendInvitationEmail` not wired (mailer not called).

- [ ] **Step 3: Implement**

Configure the plugin (reconcile the callback signature against the installed version):
```ts
plugins: [
  organization({
    sendInvitationEmail: async (data) => {
      const acceptUrl = `${env.WEB_ORIGIN}/accept-invitation/${data.id}`;
      await sendEmail({
        to: data.email,
        subject: `${data.inviter?.user?.name ?? "Someone"} invited you to ${data.organization?.name ?? "an organization"}`,
        text: `You've been invited as ${data.role}. Accept: ${acceptUrl}`,
        html: `<p>You've been invited as <b>${data.role}</b>.</p><p><a href="${acceptUrl}">Accept the invitation</a></p>`,
      });
    },
  }),
],
```
Reconcile `data` field names (`id`, `email`, `role`, `inviter`, `organization`) with the installed version's `sendInvitationEmail` payload.

- [ ] **Step 4: Run tests + lint** — `pnpm --filter @outreach/api exec vitest run src/auth-invite.test.ts && pnpm --filter @outreach/api lint`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth.ts apps/api/src/auth-invite.test.ts
git commit -m "feat(auth): invitation emails via the SMTP mailer (accept link)"
```

---

### Task 6: Backfill personal orgs for existing users

**Files:**
- Create: `apps/api/src/scripts/backfill-personal-orgs.ts`
- Test: `apps/api/src/scripts/backfill-personal-orgs.test.ts`

**Interfaces:**
- Produces: `backfillPersonalOrgs(): Promise<{ created: number; skipped: number }>` — for every `User` with no `Member` row, create an `Organization` + `owner` `Member`, and set the user's sessions' `activeOrganizationId`. Idempotent.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/scripts/backfill-personal-orgs.test.ts`: create a `User` directly via `prisma` with NO org/member; run `backfillPersonalOrgs()`; assert an `Organization` + `owner` `Member` now exist for them. Run it a SECOND time and assert `created` is 0 (idempotent). Tear down.

- [ ] **Step 2: Run it to verify it fails** — module missing.

- [ ] **Step 3: Implement**

```ts
import { prisma } from "@outreach/db";

export async function backfillPersonalOrgs(): Promise<{ created: number; skipped: number }> {
  const users = await prisma.user.findMany({ select: { id: true, name: true, email: true } });
  let created = 0, skipped = 0;
  for (const u of users) {
    const existing = await prisma.member.findFirst({ where: { userId: u.id } });
    if (existing) { skipped++; continue; }
    const org = await prisma.organization.create({
      data: { name: u.name || u.email, slug: `u-${u.id}`, createdAt: new Date() },
    });
    await prisma.member.create({ data: { organizationId: org.id, userId: u.id, role: "owner", createdAt: new Date() } });
    await prisma.session.updateMany({ where: { userId: u.id }, data: { activeOrganizationId: org.id } });
    created++;
  }
  return { created, skipped };
}

// Allow `pnpm exec tsx src/scripts/backfill-personal-orgs.ts` as a one-off.
if (import.meta.url === `file://${process.argv[1]}`) {
  backfillPersonalOrgs().then((r) => { console.log("backfill:", r); process.exit(0); });
}
```
(Reconcile `prisma.member`/`prisma.organization` field names with the CLI-generated schema.)

- [ ] **Step 4: Run tests + lint** — `pnpm --filter @outreach/api exec vitest run src/scripts/backfill-personal-orgs.test.ts && pnpm --filter @outreach/api lint`.

- [ ] **Step 5: Run the backfill against the dev DB (one-off)**

```bash
cd apps/api && pnpm exec tsx --env-file=../../.env src/scripts/backfill-personal-orgs.ts
```
Report the `{ created, skipped }` result.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/scripts/backfill-personal-orgs.ts apps/api/src/scripts/backfill-personal-orgs.test.ts
git commit -m "feat(auth): backfill personal orgs for existing users"
```

---

## Final verification (whole branch)

- `pnpm --filter @outreach/api exec vitest run` and `pnpm --filter @outreach/api lint` — green (existing auth/studio/etc. tests unaffected).
- **Live:** `pnpm dev`; sign up a fresh user → `GET /api/me` shows an `orgId`; create a second org and switch active (via the plugin API, e.g. `POST /api/auth/organization/set-active`) → `/api/me` reflects it; invite a member → the mailer logs (or sends) an accept link; accept it with a second account → that user is a `member` of the org.
- Confirm resources are untouched: an existing user's LinkedIn accounts / profiles / feeds still load exactly as before (SP1 changed no resource ownership).
