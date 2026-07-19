# Content Calendar + Scheduling (v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Schedule a draft for a future time from the studio, and see all scheduled posts on a reusable month/week/day calendar — global (all accounts) or per-account.

**Architecture:** No schema change (Draft already has `scheduledAt`/`status`). New `repos/schedule.ts` + schedule/unschedule endpoints on the studio route + a user-scoped `routes/schedule.ts` calendar feed. A pure presentational `<CalendarView>` (month/week/day) reused on a global `/schedule` page and a per-account `/accounts/[id]/schedule` tab. Scheduling from the studio via a dialog; drag-to-reschedule via `@atlaskit/pragmatic-drag-and-drop`.

**Tech Stack:** Hono + Prisma 7 (api), Next 16 + shadcn + next-intl (web), vitest (real-DB integration tests for api, pure unit tests for web utils), `@atlaskit/pragmatic-drag-and-drop`.

## Global Constraints

- Publishing is NOT built here. Scheduled posts do not auto-publish; every scheduled event shows an honest "Publishing folgt / not published yet" indicator.
- `scheduledAt` stored as UTC `DateTime`; picked and displayed in the browser's local timezone. Never schedule in the past — validate server-side (400) and client-side (snap back).
- shadcn design system only: lucide icons, shadcn `Dialog`/`DropdownMenu`/`Badge`/`Button`, app tokens (`bg-card`, `border`, `primary`, `muted-foreground`, `accent`). No indigo/heroicons/headlessui. Keep the pasted Tailwind month/week/day layout structure.
- Weeks are Monday-first.
- Only one new dependency: `@atlaskit/pragmatic-drag-and-drop`. No date-fns/dayjs/react-day-picker.
- Ownership: api handlers verify the account/draft belongs to `c.get("user")`, mirroring `routes/studio.ts` (`requireAccount` = `getAccountSummary(accountId, userId)`); the calendar feed filters by `account.userId`.
- Repo mutations use `prisma.draft.updateMany({ where: { id, linkedinAccountId } })` then re-read, exactly like `repos/draft.ts`.
- All new user-facing strings go through next-intl (`messages/en.json` + `messages/de.json`), under a new `schedule.*` block.

---

### Task 1: Schedule repo

**Files:**
- Create: `apps/api/src/repos/schedule.ts`
- Test: `apps/api/src/repos/schedule.test.ts`

**Interfaces:**
- Produces:
  - `scheduleDraft(draftId: string, accountId: string, scheduledAt: Date): Promise<Draft>`
  - `unscheduleDraft(draftId: string, accountId: string): Promise<Draft>`
  - `listScheduledDrafts(userId: string, from: Date, to: Date, accountId?: string): Promise<ScheduledEvent[]>` where
    `ScheduledEvent = { id: string; text: string; imageUrl: string | null; scheduledAt: Date; status: string; account: { id: string; displayName: string; avatarUrl: string | null } }`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/repos/schedule.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@outreach/db";
import { scheduleDraft, unscheduleDraft, listScheduledDrafts } from "./schedule.js";

const userId = `u_sched_${Date.now()}`;
const otherUserId = `u_sched_other_${Date.now()}`;
let accountId = "";
let otherAccountId = "";
let draftId = "";

beforeAll(async () => {
  await prisma.user.create({ data: { id: userId, email: `${userId}@ex.com` } });
  const a = await prisma.linkedInAccount.create({
    data: { userId, memberUrn: `urn:${userId}`, displayName: "Sched Acct", accessToken: "x", scopes: [] },
  });
  accountId = a.id;
  await prisma.user.create({ data: { id: otherUserId, email: `${otherUserId}@ex.com` } });
  const o = await prisma.linkedInAccount.create({
    data: { userId: otherUserId, memberUrn: `urn:${otherUserId}`, displayName: "Other", accessToken: "x", scopes: [] },
  });
  otherAccountId = o.id;
  const d = await prisma.draft.create({ data: { linkedinAccountId: accountId, text: "Hello world\nsecond line" } });
  draftId = d.id;
});

afterAll(async () => {
  await prisma.user.delete({ where: { id: userId } });
  await prisma.user.delete({ where: { id: otherUserId } });
  await prisma.$disconnect();
});

describe("schedule repo", () => {
  const when = new Date(Date.now() + 24 * 3600 * 1000);

  it("scheduleDraft sets scheduledAt + status", async () => {
    const d = await scheduleDraft(draftId, accountId, when);
    expect(d.status).toBe("scheduled");
    expect(d.scheduledAt?.getTime()).toBe(when.getTime());
  });

  it("listScheduledDrafts returns the event in range for the owner, with account info", async () => {
    const events = await listScheduledDrafts(userId, new Date(Date.now() - 3600e3), new Date(Date.now() + 7 * 86400e3));
    const ev = events.find((e) => e.id === draftId);
    expect(ev).toBeTruthy();
    expect(ev!.account.displayName).toBe("Sched Acct");
    expect(ev!.text).toContain("Hello world");
  });

  it("listScheduledDrafts excludes other users and out-of-range", async () => {
    const foreign = await listScheduledDrafts(otherUserId, new Date(Date.now() - 3600e3), new Date(Date.now() + 7 * 86400e3));
    expect(foreign.find((e) => e.id === draftId)).toBeUndefined();
    const outOfRange = await listScheduledDrafts(userId, new Date(Date.now() + 30 * 86400e3), new Date(Date.now() + 40 * 86400e3));
    expect(outOfRange.find((e) => e.id === draftId)).toBeUndefined();
  });

  it("listScheduledDrafts honours the accountId filter", async () => {
    const other = await listScheduledDrafts(userId, new Date(Date.now() - 3600e3), new Date(Date.now() + 7 * 86400e3), otherAccountId);
    expect(other.find((e) => e.id === draftId)).toBeUndefined();
  });

  it("unscheduleDraft resets to draft", async () => {
    const d = await unscheduleDraft(draftId, accountId);
    expect(d.status).toBe("draft");
    expect(d.scheduledAt).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @outreach/api exec vitest run src/repos/schedule.test.ts`
Expected: FAIL — `./schedule.js` has no such exports.

- [ ] **Step 3: Write the implementation**

```ts
// apps/api/src/repos/schedule.ts
import { prisma } from "@outreach/db";

export interface ScheduledEvent {
  id: string;
  text: string;
  imageUrl: string | null;
  scheduledAt: Date;
  status: string;
  account: { id: string; displayName: string; avatarUrl: string | null };
}

// Set/clear the schedule. updateDraft() deliberately whitelists out status +
// scheduledAt, so scheduling gets its own account-scoped writer.
export async function scheduleDraft(draftId: string, accountId: string, scheduledAt: Date) {
  await prisma.draft.updateMany({
    where: { id: draftId, linkedinAccountId: accountId },
    data: { scheduledAt, status: "scheduled" },
  });
  return prisma.draft.findFirstOrThrow({ where: { id: draftId, linkedinAccountId: accountId } });
}

export async function unscheduleDraft(draftId: string, accountId: string) {
  await prisma.draft.updateMany({
    where: { id: draftId, linkedinAccountId: accountId },
    data: { scheduledAt: null, status: "draft" },
  });
  return prisma.draft.findFirstOrThrow({ where: { id: draftId, linkedinAccountId: accountId } });
}

// Scheduled drafts across the user's accounts (or one) whose scheduledAt ∈ [from, to).
export async function listScheduledDrafts(
  userId: string,
  from: Date,
  to: Date,
  accountId?: string,
): Promise<ScheduledEvent[]> {
  const rows = await prisma.draft.findMany({
    where: {
      status: "scheduled",
      scheduledAt: { gte: from, lt: to },
      account: { userId, ...(accountId ? { id: accountId } : {}) },
    },
    orderBy: { scheduledAt: "asc" },
    select: {
      id: true,
      text: true,
      imageUrl: true,
      scheduledAt: true,
      status: true,
      account: { select: { id: true, displayName: true, avatarUrl: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    text: r.text,
    imageUrl: r.imageUrl,
    scheduledAt: r.scheduledAt!,
    status: r.status,
    account: r.account,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @outreach/api exec vitest run src/repos/schedule.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/repos/schedule.ts apps/api/src/repos/schedule.test.ts
git commit -m "feat(schedule): schedule/unschedule + listScheduledDrafts repo"
```

---

### Task 2: Studio schedule/unschedule endpoints

**Files:**
- Modify: `apps/api/src/routes/studio.ts`
- Test: `apps/api/src/routes/studio.test.ts` (append)

**Interfaces:**
- Consumes: `scheduleDraft`, `unscheduleDraft` (Task 1); existing `requireAccount`, `getDraft`.
- Produces: `POST /:accountId/drafts/:id/schedule { scheduledAt }`, `POST /:accountId/drafts/:id/unschedule`.

- [ ] **Step 1: Write the failing test** — append to `studio.test.ts`, matching its existing app-bootstrap style (reuse its helper that builds the Hono app + seeds a user/account/draft; follow the file's existing pattern for authenticated requests).

```ts
// in apps/api/src/routes/studio.test.ts — add a describe block
describe("schedule endpoints", () => {
  it("schedules a draft in the future", async () => {
    const when = new Date(Date.now() + 86400e3).toISOString();
    const res = await authed(`/studio/${accountId}/drafts/${draftId}/schedule`, "POST", { scheduledAt: when });
    expect(res.status).toBe(200);
    const { draft } = await res.json();
    expect(draft.status).toBe("scheduled");
  });

  it("rejects a past schedule with 400", async () => {
    const past = new Date(Date.now() - 86400e3).toISOString();
    const res = await authed(`/studio/${accountId}/drafts/${draftId}/schedule`, "POST", { scheduledAt: past });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid datetime with 400", async () => {
    const res = await authed(`/studio/${accountId}/drafts/${draftId}/schedule`, "POST", { scheduledAt: "not-a-date" });
    expect(res.status).toBe(400);
  });

  it("unschedules back to draft", async () => {
    const res = await authed(`/studio/${accountId}/drafts/${draftId}/unschedule`, "POST", {});
    expect(res.status).toBe(200);
    const { draft } = await res.json();
    expect(draft.status).toBe("draft");
  });
});
```

> NOTE to implementer: `authed`/`accountId`/`draftId` here stand for whatever the existing `studio.test.ts` already uses to issue authenticated requests and seed fixtures. Reuse the file's existing harness verbatim; do not invent a new one. If `studio.test.ts` has no such harness, add these as a sibling `routes/schedule.test.ts` using the same app-bootstrap approach the other route tests use.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @outreach/api exec vitest run src/routes/studio.test.ts`
Expected: FAIL — endpoints 404.

- [ ] **Step 3: Add the endpoints** in `routes/studio.ts` (import `scheduleDraft, unscheduleDraft` from `../repos/schedule.js`), placed next to the other `drafts/:id` routes:

```ts
r.post("/:accountId/drafts/:id/schedule", async (c) => {
  const user = c.get("user")!;
  const accountId = c.req.param("accountId");
  if (!(await requireAccount(accountId, user.id))) return c.json({ error: "not_found" }, 404);
  const draft = await getDraft(c.req.param("id"), accountId);
  if (!draft) return c.json({ error: "not_found" }, 404);

  const { scheduledAt } = await c.req.json<{ scheduledAt?: string }>().catch(() => ({ scheduledAt: undefined }));
  const when = scheduledAt ? new Date(scheduledAt) : null;
  if (!when || Number.isNaN(when.getTime())) return c.json({ error: "invalid_datetime" }, 400);
  if (when.getTime() <= Date.now()) return c.json({ error: "must_be_future" }, 400);

  return c.json({ draft: await scheduleDraft(c.req.param("id"), accountId, when) });
});

r.post("/:accountId/drafts/:id/unschedule", async (c) => {
  const user = c.get("user")!;
  const accountId = c.req.param("accountId");
  if (!(await requireAccount(accountId, user.id))) return c.json({ error: "not_found" }, 404);
  const draft = await getDraft(c.req.param("id"), accountId);
  if (!draft) return c.json({ error: "not_found" }, 404);
  return c.json({ draft: await unscheduleDraft(c.req.param("id"), accountId) });
});
```

- [ ] **Step 4: Run tests** — `pnpm --filter @outreach/api exec vitest run src/routes/studio.test.ts` → PASS. Also `pnpm --filter @outreach/api lint`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/studio.ts apps/api/src/routes/studio.test.ts
git commit -m "feat(schedule): studio schedule/unschedule endpoints (future-only)"
```

---

### Task 3: Calendar feed route

**Files:**
- Create: `apps/api/src/routes/schedule.ts`
- Modify: `apps/api/src/app.ts` (mount)
- Test: `apps/api/src/routes/schedule.test.ts`

**Interfaces:**
- Consumes: `listScheduledDrafts` (Task 1).
- Produces: `GET /schedule/calendar?from=&to=&accountId=` → `{ events: ScheduledEvent[] }` (mounted at `/api/schedule`).

- [ ] **Step 1: Write the failing test** — a `routes/schedule.test.ts` that boots the app the same way the other route tests do, seeds a scheduled draft, and asserts:
  - `GET /schedule/calendar?from&to` returns the event (200, `events[]` contains it);
  - out-of-range `from/to` returns `events: []`;
  - `accountId` filter works;
  - missing `from`/`to` → 400.

- [ ] **Step 2: Run to verify it fails** — route 404 / not mounted.

- [ ] **Step 3: Implement the route**

```ts
// apps/api/src/routes/schedule.ts
import { Hono } from "hono";
import type { AppEnv } from "../app.js";
import { listScheduledDrafts } from "../repos/schedule.js";

const MAX_SPAN_MS = 62 * 86400e3; // clamp the query window

export function scheduleRoutes() {
  const r = new Hono<AppEnv>();

  r.get("/calendar", async (c) => {
    const user = c.get("user")!;
    const fromRaw = c.req.query("from");
    const toRaw = c.req.query("to");
    const from = fromRaw ? new Date(fromRaw) : null;
    let to = toRaw ? new Date(toRaw) : null;
    if (!from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
      return c.json({ error: "invalid_range" }, 400);
    }
    if (to.getTime() - from.getTime() > MAX_SPAN_MS) to = new Date(from.getTime() + MAX_SPAN_MS);
    const accountId = c.req.query("accountId") || undefined;
    const events = await listScheduledDrafts(user.id, from, to, accountId);
    return c.json({ events });
  });

  return r;
}
```

Mount in `app.ts` (inside the protected group, next to the other `app.route(...)` calls), importing `scheduleRoutes`:

```ts
app.route("/schedule", scheduleRoutes());
```

- [ ] **Step 4: Run tests** — `pnpm --filter @outreach/api exec vitest run src/routes/schedule.test.ts` → PASS. `pnpm --filter @outreach/api lint`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/schedule.ts apps/api/src/routes/schedule.test.ts apps/api/src/app.ts
git commit -m "feat(schedule): GET /schedule/calendar feed (global + per-account)"
```

---

### Task 4: Web calendar date utilities

**Files:**
- Create: `apps/web/src/lib/calendar.ts`
- Test: `apps/web/src/lib/calendar.test.ts`

**Interfaces:**
- Produces (all pure, native `Date`, local timezone):
  - `addDays(d: Date, n: number): Date`
  - `sameDay(a: Date, b: Date): boolean`
  - `startOfDay(d: Date): Date`
  - `mondayOf(d: Date): Date` — Monday of d's week
  - `weekDays(cursor: Date): Date[]` — 7 days Mon..Sun
  - `monthGrid(cursor: Date): Date[]` — 42 days (6 weeks) starting the Monday on/before the 1st
  - `withTimeOfDay(date: Date, from: Date): Date` — date's Y/M/D + from's H/M
  - `withHour(date: Date, hour: number, minutes: number): Date`
  - `toLocalInputValue(d: Date): string` — `YYYY-MM-DDTHH:mm` for `datetime-local`
  - `fromLocalInputValue(v: string): Date`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/lib/calendar.test.ts
import { describe, it, expect } from "vitest";
import { monthGrid, weekDays, mondayOf, withTimeOfDay, withHour, toLocalInputValue, fromLocalInputValue, sameDay } from "./calendar";

describe("calendar utils", () => {
  it("monthGrid returns 42 days, Monday-first, covering the month", () => {
    const grid = monthGrid(new Date(2022, 0, 15)); // Jan 2022
    expect(grid).toHaveLength(42);
    expect(grid[0].getDay()).toBe(1); // Monday
    expect(grid.some((d) => d.getMonth() === 0 && d.getDate() === 1)).toBe(true);
    expect(grid.some((d) => d.getMonth() === 0 && d.getDate() === 31)).toBe(true);
  });

  it("weekDays returns Mon..Sun of the cursor's week", () => {
    const days = weekDays(new Date(2022, 0, 12)); // a Wednesday
    expect(days).toHaveLength(7);
    expect(days[0].getDay()).toBe(1);
    expect(sameDay(days[0], mondayOf(new Date(2022, 0, 12)))).toBe(true);
  });

  it("withTimeOfDay keeps the target date but the source clock", () => {
    const out = withTimeOfDay(new Date(2022, 0, 20), new Date(2022, 5, 1, 9, 30));
    expect(out.getDate()).toBe(20);
    expect(out.getHours()).toBe(9);
    expect(out.getMinutes()).toBe(30);
  });

  it("withHour sets the hour, keeps minutes", () => {
    const out = withHour(new Date(2022, 0, 20, 8, 45), 14, 45);
    expect(out.getHours()).toBe(14);
    expect(out.getMinutes()).toBe(45);
  });

  it("local input value round-trips", () => {
    const d = new Date(2022, 0, 22, 15, 5);
    expect(fromLocalInputValue(toLocalInputValue(d)).getTime()).toBe(d.getTime());
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter web exec vitest run src/lib/calendar.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** `apps/web/src/lib/calendar.ts` with the functions above. Key logic:
  - `mondayOf`: `const day = (d.getDay() + 6) % 7; return addDays(startOfDay(d), -day);`
  - `monthGrid`: `mondayOf(new Date(y, m, 1))` then 42 `addDays`.
  - `toLocalInputValue`: build from local getters, zero-pad, `` `${y}-${mm}-${dd}T${hh}:${mi}` ``.
  - `fromLocalInputValue`: `new Date(v)` (a `datetime-local` value parses as local time).

- [ ] **Step 4: Run to verify it passes** — → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/calendar.ts apps/web/src/lib/calendar.test.ts
git commit -m "feat(schedule): pure calendar date utilities"
```

---

### Task 5: Install DnD + CalendarView shell and Month view

**Files:**
- Modify: `apps/web/package.json` (add `@atlaskit/pragmatic-drag-and-drop`)
- Create: `apps/web/src/app/(app)/schedule/calendar-view.tsx`
- Modify: `apps/web/messages/en.json`, `apps/web/messages/de.json` (add `schedule.*`)

**Interfaces:**
- Produces: `CalendarView` (props exactly as the spec's `CalendarViewProps`), `CalendarEvent` type, exported for the pages (Tasks 8-9). This task delivers the header (title, prev/next/Today, view `DropdownMenu`, "Neuer Post") and the **month** grid; week/day render a placeholder until Task 6; DnD lands in Task 7.

- [ ] **Step 1: Install the dependency**

Run: `pnpm --filter web add @atlaskit/pragmatic-drag-and-drop`
Expected: added to `apps/web/package.json` dependencies.

- [ ] **Step 2: Add i18n keys** to both `messages/en.json` and `messages/de.json` under a new `"schedule"` block: `title`, `today`, `month`, `week`, `day`, `newPost`, `moreCount` (`"+{count} mehr"` / `"+{count} more"`), `notPublished` ("Publishing folgt" / "Not published yet"), `plan`, `unplan`, `planTitle`, `planConfirm`, `scheduledFor` (`"Geplant: {when}"`), `weekdayMon`..`weekdaySun` (single letters M/D/M/D/F/S/S de, M/T/W/T/F/S/S en), `emptyDay`. Keep keys consistent across both files.

- [ ] **Step 3: Implement `calendar-view.tsx`** — a `"use client"` component. Use the pasted **month** Tailwind view as the layout skeleton, converted to shadcn: replace heroicons with lucide (`ChevronLeft`, `ChevronRight`, `ChevronDown`, `Clock`), replace the headlessui `Menu` with shadcn `DropdownMenu` for the view switcher, and replace `indigo-*`/`gray-*` with tokens (`bg-card`, `bg-muted`, `border`, `text-muted-foreground`, `bg-primary text-primary-foreground` for "today", `hover:bg-accent`). Compute the grid with `monthGrid(cursor)` (Task 4); bucket `events` by `sameDay`. Render up to 2 events/cell (title + local `HH:mm` via `toLocaleTimeString`) then `t("schedule.moreCount", { count })`. Each event is a button calling `onOpenEvent(id)`; show the `Clock` "notPublished" marker. Header title = `cursor.toLocaleDateString(locale, { month: "long", year: "numeric" })`. Prev/next call `onCursor(addDays(...))`/month step; Today calls `onCursor(new Date())` — but note `new Date()` is fine in the browser. The view `DropdownMenu` calls `onView`. "Neuer Post" calls `onCreate?.()`. For `view !== "month"`, render a simple placeholder `<div>` for now.

- [ ] **Step 4: Typecheck** — `pnpm --filter web exec tsc --noEmit` → clean. (No unit test; presentational. The date logic it relies on is covered by Task 4.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/package.json apps/web/pnpm-lock.yaml apps/web/src/app/\(app\)/schedule/calendar-view.tsx apps/web/messages/en.json apps/web/messages/de.json
git commit -m "feat(schedule): CalendarView shell + month view (shadcn)"
```

---

### Task 6: Week and Day views

**Files:**
- Modify: `apps/web/src/app/(app)/schedule/calendar-view.tsx`

**Interfaces:**
- Consumes: `weekDays` (Task 4), the `CalendarViewProps` from Task 5.
- Produces: functioning `view === "week"` and `view === "day"` renders.

- [ ] **Step 1: Implement week + day** using the pasted **week** and **day** Tailwind views as skeletons, converted to shadcn tokens/lucide (same rules as Task 5). Hourly rows 00–23 (use a static list). A post is a point in time: render each event as a fixed-height block positioned in its hour row/day column (compute row from `scheduledAt.getHours()`, column from the matching `weekDays` index; day view is a single column). Block shows title + local time + (if `showAccountAvatar`) the account avatar, and the "notPublished" marker; click → `onOpenEvent(id)`. Header title: week → `"{firstDay} – {lastDay}"` (localized), day → full localized date. Prev/next step by 7 days (week) or 1 day (day).

- [ ] **Step 2: Typecheck** — `pnpm --filter web exec tsc --noEmit` → clean.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\(app\)/schedule/calendar-view.tsx
git commit -m "feat(schedule): week + day calendar views"
```

---

### Task 7: Drag-to-reschedule (pragmatic-drag-and-drop)

**Files:**
- Modify: `apps/web/src/app/(app)/schedule/calendar-view.tsx`

**Interfaces:**
- Consumes: `withTimeOfDay`, `withHour` (Task 4); `onReschedule` prop.
- Produces: dragging an event onto a day cell (month) or hour slot (week/day) calls `onReschedule(id, next)`.

- [ ] **Step 1: Wire DnD.** Import from the element adapter:
  `import { draggable } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";`
  `import { dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";`
  `import { monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";`
  - Event block: a `ref` + `useEffect(() => draggable({ element: ref.current!, getInitialData: () => ({ eventId: ev.id, at: ev.scheduledAt }) }), [ev.id])` (return the cleanup).
  - Drop targets: month day cell → `dropTargetForElements({ element, getData: () => ({ kind: "day", date: cellDate }) })`; week/day hour slot → `getData: () => ({ kind: "slot", date: dayDate, hour })`. Toggle a highlight class on `onDragEnter`/`onDragLeave`.
  - One `monitorForElements({ onDrop({ source, location }) { ... } })` in a top-level effect: read `source.data.eventId` + `source.data.at` (Date) and the innermost drop target's `data`; compute `next` = `withTimeOfDay(target.date, at)` for `kind: "day"`, or `withHour(target.date, target.hour, at.getMinutes())` for `kind: "slot"`. If `next.getTime() <= Date.now()`, ignore (snap back). Else `onReschedule(source.data.eventId, next)`.

- [ ] **Step 2: Typecheck + manual sanity** — `pnpm --filter web exec tsc --noEmit` → clean. (DnD is verified live during the whole-branch review / by the controller, not unit-tested.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\(app\)/schedule/calendar-view.tsx
git commit -m "feat(schedule): drag-to-reschedule via pragmatic-drag-and-drop"
```

---

### Task 8: Global /schedule page + nav

**Files:**
- Create: `apps/web/src/app/(app)/schedule/page.tsx`
- Modify: `apps/web/src/components/app-shell.tsx` (flip `/schedule` off `soon`)

**Interfaces:**
- Consumes: `CalendarView` (Tasks 5-7), `GET /api/schedule/calendar`, schedule endpoints (Task 2).

- [ ] **Step 1: Implement the page** — a `"use client"` page owning `view` + `cursor` state. Derive the visible range from `view`+`cursor` (month → `monthGrid` first/last; week → `weekDays` first/last+1d; day → cursor..+1d) and `fetch('/api/schedule/calendar?from=&to=', { credentials: "include" })` on range change. Map API events → `CalendarEvent` (title = first non-empty line of `text` or the `emptyDay`/"Ohne Titel" fallback). Render `<CalendarView showAccountAvatar events view cursor onView onCursor onOpenEvent onReschedule onCreate />`:
  - `onOpenEvent(id)` → `router.push('/studio/' + id)`.
  - `onReschedule(id, next)` → find the event's `account.id`, `POST /api/studio/{accountId}/drafts/{id}/schedule { scheduledAt: next.toISOString() }`, then refetch. Optimistically update local state first; roll back on non-200.
  - `onCreate()` → `router.push('/studio')` (the studio create dialog picks the account).

- [ ] **Step 2: Flip the nav** — in `app-shell.tsx`, change the `/schedule` item to drop `soon: true` so it renders as a real link.

- [ ] **Step 3: Typecheck** — `pnpm --filter web exec tsc --noEmit` → clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/\(app\)/schedule/page.tsx apps/web/src/components/app-shell.tsx
git commit -m "feat(schedule): global /schedule calendar page + nav link"
```

---

### Task 9: Per-account schedule tab

**Files:**
- Create: `apps/web/src/app/(app)/accounts/[id]/schedule/page.tsx`
- Modify: `apps/web/src/app/(app)/accounts/[id]/layout.tsx` (add tab)

**Interfaces:**
- Consumes: `CalendarView`; the calendar feed with `accountId`.

- [ ] **Step 1: Add the tab** — in the account `layout.tsx` `tabs` array, insert `{ key: "schedule", href: \`/accounts/${id}/schedule\` }` (before `settings`). Add the `accounts.tabs.schedule` (or the file's existing tab-label key convention) i18n string in both message files.

- [ ] **Step 2: Implement the page** — same as Task 8's page but reads `id` from `useParams`/props, passes `accountId={id}` into the feed query (`?accountId=`) and `showAccountAvatar={false}`. `onCreate()` → `router.push('/studio')` (or the account's create flow if one exists).

- [ ] **Step 3: Typecheck** — `pnpm --filter web exec tsc --noEmit` → clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/\(app\)/accounts/\[id\]/schedule/page.tsx apps/web/src/app/\(app\)/accounts/\[id\]/layout.tsx apps/web/messages/en.json apps/web/messages/de.json
git commit -m "feat(schedule): per-account schedule tab (reuses CalendarView)"
```

---

### Task 10: Schedule control in the studio

**Files:**
- Create: `apps/web/src/app/(app)/studio/[id]/schedule-dialog.tsx`
- Modify: `apps/web/src/app/(app)/studio/[id]/page.tsx`

**Interfaces:**
- Consumes: `toLocalInputValue`/`fromLocalInputValue` (Task 4); schedule/unschedule endpoints (Task 2); the loaded `draft` (has `scheduledAt`, `status`).

- [ ] **Step 1: Implement `schedule-dialog.tsx`** — a shadcn `Dialog` with an `<input type="datetime-local">` (default `toLocalInputValue(nextRoundHour)`), a confirm button, and inline error text. Props: `{ open, onOpenChange, initial?: string, onConfirm(when: Date) }`. Confirm parses via `fromLocalInputValue`, rejects past/invalid inline, else `onConfirm`.

- [ ] **Step 2: Wire into the studio toolbar** in `page.tsx` next to Save/Delete:
  - A **"Planen"** `Button` opening the dialog. `onConfirm(when)` → `POST /api/studio/{accountId}/drafts/{id}/schedule { scheduledAt: when.toISOString() }`; on 200 update local `draft`.
  - When `draft.scheduledAt`, render a chip `t("schedule.scheduledFor", { when: <local> })` with an **"Entplanen"** action → `POST .../unschedule`; on 200 update local `draft`. The existing status `Badge` already shows `scheduled`.

- [ ] **Step 3: Typecheck** — `pnpm --filter web exec tsc --noEmit` → clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/\(app\)/studio/\[id\]/schedule-dialog.tsx apps/web/src/app/\(app\)/studio/\[id\]/page.tsx
git commit -m "feat(schedule): plan/unplan control in the studio"
```

---

## Self-Review

- **Spec coverage:** data model (no change) ✓ T1; schedule/unschedule API ✓ T2; calendar feed global+per-account ✓ T3; date utils ✓ T4; reusable CalendarView month/week/day ✓ T5-6; DnD via pragmatic ✓ T7; global page + nav ✓ T8; per-account tab ✓ T9; studio plan control ✓ T10; honesty indicator ✓ (T5 "notPublished" marker, carried through views); timezone UTC↔local ✓ (T4 utils, T2 validation).
- **Type consistency:** `ScheduledEvent` (api, T1) ↔ `CalendarEvent` (web, T5) are mapped explicitly in the pages (T8/T9), not shared — intentional (web must not depend on the api package). `scheduleDraft/unscheduleDraft` signatures match across T1→T2.
- **No placeholders:** api tasks carry full code; web UI tasks point at the user-provided Tailwind views as the exact layout source plus explicit shadcn-conversion rules and the precise data/DnD wiring — the novel logic (date math, DnD, data flow) is fully specified; the JSX skeleton is supplied by the reference rather than restated.
