"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { RefreshCw } from "lucide-react";
import { CalendarView, type CalendarEvent, type CalendarViewType } from "./calendar-view";
import { useCalendarState } from "./use-calendar-state";
import { addDays, monthGrid, startOfDay, weekDays } from "@/lib/calendar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface ScheduledEventAccount {
  id: string;
  displayName: string;
  avatarUrl?: string | null;
}

interface ScheduledEvent {
  id: string;
  text: string;
  imageUrl?: string | null;
  scheduledAt: string;
  status: string;
  account: ScheduledEventAccount;
}

function firstNonEmptyLine(text: string): string {
  return (text.split("\n").find((line) => line.trim().length > 0) ?? "").trim();
}

/** The [from, to) window to fetch for the current view + cursor. */
function rangeFor(view: CalendarViewType, cursor: Date): { from: Date; to: Date } {
  if (view === "month") {
    const grid = monthGrid(cursor);
    return { from: grid[0]!, to: addDays(grid[41]!, 1) };
  }
  if (view === "week") {
    const days = weekDays(cursor);
    return { from: days[0]!, to: addDays(days[0]!, 7) };
  }
  const from = startOfDay(cursor);
  return { from, to: addDays(from, 1) };
}

export default function SchedulePage() {
  const t = useTranslations();
  const router = useRouter();

  const { view, cursor, setView, setCursor } = useCalendarState();
  const [events, setEvents] = useState<ScheduledEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  const { from, to } = useMemo(() => rangeFor(view, cursor), [view, cursor]);

  const load = useCallback(async () => {
    setError(false);
    const res = await fetch(
      `/api/schedule/calendar?from=${from.toISOString()}&to=${to.toISOString()}`,
      { credentials: "include" },
    ).catch(() => null);
    if (!res) {
      setError(true);
      setLoaded(true);
      return;
    }
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (!res.ok) {
      setError(true);
      setLoaded(true);
      return;
    }
    const data = (await res.json()) as { events: ScheduledEvent[] };
    setEvents(data.events);
    setLoaded(true);
  }, [from, to, router]);

  useEffect(() => {
    setLoaded(false);
    void load();
  }, [load]);

  const calendarEvents: CalendarEvent[] = useMemo(
    () =>
      events.map((ev) => ({
        id: ev.id,
        title: firstNonEmptyLine(ev.text) || t("schedule.untitled"),
        scheduledAt: ev.scheduledAt,
        imageUrl: ev.imageUrl,
        account: ev.account,
      })),
    [events, t],
  );

  // Optimistic drag-to-reschedule: patch local state immediately, roll back
  // and refetch the range if the server call doesn't come back 2xx.
  async function handleReschedule(id: string, next: Date) {
    const target = events.find((ev) => ev.id === id);
    if (!target) return;
    const prevEvents = events;
    setEvents((prev) =>
      prev.map((ev) => (ev.id === id ? { ...ev, scheduledAt: next.toISOString() } : ev)),
    );
    const res = await fetch(`/api/studio/${target.account.id}/drafts/${id}/schedule`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduledAt: next.toISOString() }),
    }).catch(() => null);
    if (!res || !res.ok) {
      setEvents(prevEvents);
      void load();
    }
  }

  if (!loaded) {
    return (
      <div className="flex h-full flex-col gap-3 p-4">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="flex-1 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="grid h-full place-items-center p-8">
        <div className="max-w-xs text-center">
          <p className="text-sm font-medium">{t("schedule.loadError")}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => void load()}>
            <RefreshCw className="size-4" />
            {t("schedule.retry")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <CalendarView
      showAccountAvatar
      events={calendarEvents}
      view={view}
      cursor={cursor}
      onView={setView}
      onCursor={setCursor}
      onOpenEvent={(id) => router.push(`/studio/${id}`)}
      onReschedule={handleReschedule}
      onCreate={() => router.push("/studio")}
    />
  );
}
