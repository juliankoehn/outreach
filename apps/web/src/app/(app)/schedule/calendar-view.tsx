"use client";

import { useLocale, useTranslations } from "next-intl";
import { ChevronDown, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { monthGrid, sameDay } from "@/lib/calendar";

export interface CalendarEvent {
  id: string;
  title: string;
  scheduledAt: string; // ISO UTC
  imageUrl?: string | null;
  account: { id: string; displayName: string; avatarUrl?: string | null };
}

export type CalendarViewType = "month" | "week" | "day";

export interface CalendarViewProps {
  events: CalendarEvent[];
  view: CalendarViewType;
  cursor: Date;
  onView(v: CalendarViewType): void;
  onCursor(d: Date): void;
  onOpenEvent(id: string): void;
  onReschedule(id: string, next: Date): void; // declared now; wired in a later task
  onCreate?(at?: Date): void;
  showAccountAvatar?: boolean;
}

const MAX_EVENTS_PER_CELL = 2;

function stepMonth(cursor: Date, delta: number): Date {
  return new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1);
}

function EventAvatar({ account }: { account: CalendarEvent["account"] }) {
  if (account.avatarUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={account.avatarUrl}
        alt=""
        className="size-4 shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-[9px] font-medium text-muted-foreground">
      {account.displayName.charAt(0).toUpperCase()}
    </span>
  );
}

export function CalendarView(props: CalendarViewProps) {
  const {
    events,
    view,
    cursor,
    onView,
    onCursor,
    onOpenEvent,
    onCreate,
    showAccountAvatar,
  } = props;
  const t = useTranslations();
  const locale = useLocale();

  const title = cursor.toLocaleDateString(locale, { month: "long", year: "numeric" });

  const weekdayLabels = [
    t("schedule.weekdayMon"),
    t("schedule.weekdayTue"),
    t("schedule.weekdayWed"),
    t("schedule.weekdayThu"),
    t("schedule.weekdayFri"),
    t("schedule.weekdaySat"),
    t("schedule.weekdaySun"),
  ];

  const viewLabels: Record<CalendarViewType, string> = {
    month: t("schedule.month"),
    week: t("schedule.week"),
    day: t("schedule.day"),
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold text-foreground">{title}</h1>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => onCursor(stepMonth(cursor, -1))}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => onCursor(stepMonth(cursor, 1))}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
          <Button variant="outline" size="sm" onClick={() => onCursor(new Date())}>
            {t("schedule.today")}
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1">
                {viewLabels[view]}
                <ChevronDown className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onView("month")}>
                {t("schedule.month")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onView("week")}>
                {t("schedule.week")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onView("day")}>
                {t("schedule.day")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button size="sm" onClick={() => onCreate?.()}>
            {t("schedule.newPost")}
          </Button>
        </div>
      </div>

      {view === "month" ? (
        <div className="flex flex-1 flex-col">
          <div className="grid grid-cols-7 border-b">
            {weekdayLabels.map((label, i) => (
              <div
                key={i}
                className="border-r py-2 text-center text-xs font-medium text-muted-foreground last:border-r-0"
              >
                {label}
              </div>
            ))}
          </div>

          <div className="grid flex-1 grid-cols-7 grid-rows-6">
            {monthGrid(cursor).map((cellDate, i) => {
              const isToday = sameDay(cellDate, new Date());
              const isCurrentMonth = cellDate.getMonth() === cursor.getMonth();
              const cellEvents = events.filter((ev) =>
                sameDay(new Date(ev.scheduledAt), cellDate),
              );
              const visibleEvents = cellEvents.slice(0, MAX_EVENTS_PER_CELL);
              const hiddenCount = cellEvents.length - visibleEvents.length;

              return (
                <div
                  key={i}
                  className={cn(
                    "flex min-h-24 flex-col gap-1 border-r border-b p-1.5 last:border-r-0",
                    !isCurrentMonth && "bg-muted/40",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={cn(
                        "flex size-6 items-center justify-center rounded-full text-xs",
                        isToday
                          ? "bg-primary font-semibold text-primary-foreground"
                          : isCurrentMonth
                            ? "text-foreground"
                            : "text-muted-foreground",
                      )}
                    >
                      {cellDate.getDate()}
                    </span>
                  </div>

                  <div className="flex flex-col gap-0.5">
                    {visibleEvents.map((ev) => (
                      <button
                        key={ev.id}
                        type="button"
                        onClick={() => onOpenEvent(ev.id)}
                        className="flex w-full items-center gap-1 rounded-sm bg-card px-1 py-0.5 text-left text-[11px] hover:bg-accent"
                      >
                        <Clock
                          className="size-3 shrink-0 text-muted-foreground"
                          aria-label={t("schedule.notPublished")}
                        >
                          <title>{t("schedule.notPublished")}</title>
                        </Clock>
                        {showAccountAvatar && <EventAvatar account={ev.account} />}
                        <span className="truncate text-foreground">{ev.title}</span>
                        <span className="ml-auto shrink-0 text-muted-foreground">
                          {new Date(ev.scheduledAt).toLocaleTimeString(locale, {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </button>
                    ))}
                    {hiddenCount > 0 && (
                      <span className="px-1 text-[11px] text-muted-foreground">
                        {t("schedule.moreCount", { count: hiddenCount })}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="p-8 text-sm text-muted-foreground">
          {viewLabels[view]} — coming soon.
        </div>
      )}
    </div>
  );
}
