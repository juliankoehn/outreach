# Content Calendar + Scheduling (v1) — Design

**Status:** approved (brainstorm)
**Date:** 2026-07-19

## Goal

Let a creator schedule a draft for a future date/time from the studio, and see
all scheduled posts on a calendar (month / week / day) — global (all their
LinkedIn accounts) or filtered to one account. The calendar view is a single
reusable component used in both places.

## Scope

**In this build (v1):**
- Schedule / unschedule a draft (set `scheduledAt`, `status = scheduled`).
- Reusable `CalendarView` component — month, week, and day views, shadcn-styled.
- Global calendar page at `/schedule` (all of the user's accounts).
- Per-account calendar tab at `/accounts/[id]/schedule` (same component, filtered).
- Schedule from the studio (a "Planen" control) + drag-to-reschedule on the calendar.

**Explicitly NOT in this build (next build):**
- Actual publishing to LinkedIn. No worker runs yet, so a scheduled post does
  **not** go live automatically. The UI must make this honest (a clear "Publishing
  folgt / not published yet" indicator on scheduled posts) so the creator is not
  misled. When the publishing engine + worker land, that indicator is removed and
  the scheduled time becomes a real trigger.

## Non-goals / constraints (global)

- **No new dependencies.** Use native `Date` math for the grid, native
  `<input type="datetime-local">` for the picker (inside the existing shadcn
  `Dialog`), and native HTML5 drag-and-drop for reschedule. No date-fns / dayjs /
  react-day-picker / dnd library.
- **shadcn design system**, not the reference's indigo/heroicons/headlessui: use
  lucide icons, shadcn `DropdownMenu`/`Dialog`/`Badge`/`Button`, and the app's
  colour tokens (`bg-card`, `border`, `primary`, `muted-foreground`, `accent`).
  Keep the layout/structure of the pasted Tailwind month/week/day views.
- **Timezone:** store `scheduledAt` in UTC (Prisma `DateTime`). Pick and display
  in the browser's local timezone. Never schedule in the past (validate server-side).
- **Ownership:** every endpoint checks the account/draft belongs to the user,
  mirroring the existing studio/feed routes (per-handler inline check).

## Data model

No schema change. `Draft` already has:
- `scheduledAt DateTime?` — the planned publish instant (UTC).
- `status String` — `draft | scheduled | published`.
- `publishedAt`, `externalId` — reserved for the publishing build.
- `linkedinAccountId`, relation to `LinkedInAccount` (has `displayName`, `avatarUrl`).

Scheduling a draft: `scheduledAt = <future>`, `status = "scheduled"`.
Unscheduling: `scheduledAt = null`, `status = "draft"`.

## API (apps/api)

New repo `repos/schedule.ts`:
- `scheduleDraft(draftId, accountId, scheduledAt: Date)` — sets `scheduledAt` +
  `status = "scheduled"`; caller guarantees the account is the user's.
- `unscheduleDraft(draftId, accountId)` — clears `scheduledAt`, `status = "draft"`.
- `listScheduledDrafts(userId, from: Date, to: Date, accountId?: string)` —
  returns scheduled drafts whose `scheduledAt` is in `[from, to)`, across all the
  user's accounts (or one when `accountId` is given), each with
  `{ id, text, imageUrl, scheduledAt, status, account: { id, displayName, avatarUrl } }`.
  Implemented via a Prisma query joining `Draft -> LinkedInAccount` filtered by
  `account.userId = userId` (and `account.id = accountId` when provided).

Endpoints on the studio route (`routes/studio.ts`), account-scoped like the rest:
- `POST /:accountId/drafts/:id/schedule` body `{ scheduledAt: string /* ISO */ }`
  → 400 if missing/invalid/in the past; else schedules, returns `{ draft }`.
- `POST /:accountId/drafts/:id/unschedule` → returns `{ draft }`.

New route `routes/schedule.ts` (mounted at `/api/schedule`, user-scoped, no
`:accountId`):
- `GET /calendar?from=<ISO>&to=<ISO>&accountId=<optional>` → `{ events }` where
  each event is the shape from `listScheduledDrafts`. `from`/`to` required and
  clamped to a sane max span (e.g. 62 days) to bound the query.

## Scheduling from the studio

In the studio draft toolbar (`app/(app)/studio/[id]/page.tsx`, next to Save/Delete):
- A **"Planen"** button opens a shadcn `Dialog` with an `<input type="datetime-local">`
  (defaulted to the next round hour) and a confirm button → `POST .../schedule`.
- Once scheduled, show a chip "Geplant: <local date/time>" with an "Entplanen"
  action (→ `POST .../unschedule`). The existing status `Badge` already renders
  `scheduled`.
- The picker's local value is converted to a UTC ISO string before sending.

## Calendar component (reusable)

`app/(app)/schedule/calendar-view.tsx` — a pure, presentational component:

```
interface CalendarEvent {
  id: string;
  title: string;          // first non-empty line of the draft text (fallback: "Ohne Titel")
  scheduledAt: string;    // ISO UTC
  imageUrl?: string | null;
  account: { id: string; displayName: string; avatarUrl?: string | null };
}
interface CalendarViewProps {
  events: CalendarEvent[];
  view: "month" | "week" | "day";
  cursor: Date;                       // the focused date (drives which month/week/day)
  onView(v): void;
  onCursor(d: Date): void;            // prev / next / today
  onOpenEvent(id: string): void;      // click → open draft in studio
  onReschedule(id: string, next: Date): void;  // drag → new datetime
  onCreate?(at?: Date): void;         // "Neuer Post" (optionally for a slot)
  showAccountAvatar?: boolean;        // true on the global page, false per-account
}
```

- Header: title (current month / week range / day), prev/next/Today, a
  `DropdownMenu` view switcher (Monat/Woche/Tag), and a "Neuer Post" button.
- **Month:** 6×7 grid computed from `cursor` (Mon-first week). Each day cell lists
  up to 2 events (title + time) then "+N mehr". Today and out-of-month days styled
  via tokens. Events are `draggable`; a day cell is a drop target → `onReschedule`
  keeps the event's time-of-day, changes the date.
- **Week:** 7 day columns × hourly rows (00–23), computed from `cursor`'s week.
  A post is a point in time (no duration), so each event is a fixed-height block
  anchored at its start time, not a spanning range. Draggable to another day/hour
  slot → `onReschedule` with the new day+hour (minutes preserved).
- **Day:** single day, hourly rows; same event blocks + drag as week.
- Each event shows title + local time + (if `showAccountAvatar`) the account avatar.
- **Honesty indicator:** every event carries a small clock/"nicht veröffentlicht"
  marker (tooltip) while publishing isn't wired.

Small date utilities (`lib/calendar.ts`): `startOfMonthGrid(cursor)`,
`weekDays(cursor)`, `sameDay`, `addDays`, `setTimeOfDay`, `localInputValue(date)`,
`fromLocalInput(value)` — all native `Date`, pure, unit-tested.

## Pages wiring

- **Global:** `app/(app)/schedule/page.tsx` — owns `view`/`cursor` state, fetches
  `GET /api/schedule/calendar?from&to` for the visible range, renders
  `<CalendarView showAccountAvatar />`. `onReschedule` → the draft's account
  schedule endpoint; `onOpenEvent` → `/studio/[id]`; `onCreate` → studio create flow.
- **Per-account:** `app/(app)/accounts/[id]/schedule/page.tsx` — same, passing
  `accountId` to the feed and `showAccountAvatar={false}`. Add a `schedule` tab to
  the account layout tabs (`overview/posts/profile/resources/schedule/settings`).
- **Nav:** in `components/app-shell.tsx`, drop `soon: true` from the `/schedule`
  item so it becomes a real link.
- i18n: add a `schedule.*` block (title, views, today, plan/unplan, "Publishing
  folgt", weekday abbreviations, "+N mehr", "Neuer Post") to `messages/en.json`
  and `messages/de.json`.

## Error handling

- Schedule endpoint rejects missing/unparseable/past datetimes with 400 and a
  clear message; the dialog surfaces it inline.
- Calendar feed clamps the range and returns `[]` for an empty window; a fetch
  failure shows a non-blocking error state, not a crash.
- Drag that resolves to a past slot is rejected client-side (snap back) and never
  hits the server.

## Testing

- **api:** `repos/schedule.test.ts` (schedule sets scheduled+future, unschedule
  resets, `listScheduledDrafts` respects range + userId ownership + optional
  accountId). `routes/schedule` / studio schedule endpoints: 400 on past/invalid,
  ownership 404, happy path.
- **web:** `lib/calendar.test.ts` for the pure date utils (month grid size/offsets,
  week days, time-of-day preservation on reschedule, local↔UTC input conversion).
  The views themselves are presentational and covered lightly.

## Open follow-ups (next builds)

1. **Publishing engine** — post a draft to LinkedIn now (Posts API: text, image
   upload, optional source link as first comment). Scope `w_member_social` is
   already granted.
2. **Publish worker** — pg-boss job (`send` with `startAfter`, or a minute-cron
   sweep of due scheduled drafts) that publishes at `scheduledAt`, sets
   `status=published` + `publishedAt` + `externalId`, retries on failure. Removes
   the "not published yet" indicator.
