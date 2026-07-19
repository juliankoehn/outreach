"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { CalendarViewType } from "./calendar-view";

const VIEWS: readonly CalendarViewType[] = ["month", "week", "day"];

function parseView(v: string | null): CalendarViewType {
  return VIEWS.includes(v as CalendarViewType) ? (v as CalendarViewType) : "month";
}

function parseCursor(v: string | null): Date {
  if (v) {
    // Interpret the `date` param as a local calendar day.
    const d = new Date(`${v}T00:00:00`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

function toDateParam(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Calendar view + cursor synced to URL query params (`?view=&date=`), so the
 * calendar is shareable, bookmarkable, and survives reload. The URL is the
 * single source of truth; `cursor` is memoised by the raw `date` param so it
 * stays referentially stable across renders (avoids refetch loops).
 */
export function useCalendarState(): {
  view: CalendarViewType;
  cursor: Date;
  setView: (v: CalendarViewType) => void;
  setCursor: (d: Date) => void;
} {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const viewParam = params.get("view");
  const dateParam = params.get("date");
  const view = useMemo(() => parseView(viewParam), [viewParam]);
  const cursor = useMemo(() => parseCursor(dateParam), [dateParam]);

  const sync = useCallback(
    (nextView: CalendarViewType, nextCursor: Date) => {
      const sp = new URLSearchParams(params.toString());
      sp.set("view", nextView);
      sp.set("date", toDateParam(nextCursor));
      router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  const setView = useCallback((v: CalendarViewType) => sync(v, cursor), [sync, cursor]);
  const setCursor = useCallback((d: Date) => sync(view, d), [sync, view]);

  return { view, cursor, setView, setCursor };
}
