"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import {
  draggable,
  dropTargetForElements,
  monitorForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";
import {
  addDays,
  monthGrid,
  sameDay,
  weekDays,
  withHour,
  withTimeOfDay,
} from "@/lib/calendar";

// Deterministic per-account hue so each account's scheduled posts read as one
// colour across the calendar (stable for a given account id).
function accountHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 360;
}
function accountColors(id: string): { stripe: string; tint: string; dot: string } {
  const hue = accountHue(id);
  return {
    stripe: `hsl(${hue} 60% 50%)`,
    tint: `hsl(${hue} 65% 50% / 0.12)`,
    dot: `hsl(${hue} 60% 50%)`,
  };
}

/** Data attached to a draggable `EventButton` via `getInitialData`. */
interface EventDragData {
  [key: string]: unknown;
  eventId: string;
  at: Date;
}

/** Data attached to a month day-cell drop target via `getData`. */
interface DayDropData {
  [key: string]: unknown;
  [key: symbol]: unknown;
  kind: "day";
  date: Date;
}

/** Data attached to a week/day hour-slot drop target via `getData`. */
interface SlotDropData {
  [key: string]: unknown;
  [key: symbol]: unknown;
  kind: "slot";
  date: Date;
  hour: number;
}

type DropData = DayDropData | SlotDropData;

export interface CalendarEvent {
  id: string;
  title: string;
  scheduledAt: string; // ISO UTC — the event's time (publish time for published)
  imageUrl?: string | null;
  status?: string; // scheduled | published | failed
  externalId?: string | null; // LinkedIn post URN, when published
  metrics?: { impressions?: number; reactions?: number; comments?: number } | null;
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
const HOURS = Array.from({ length: 24 }, (_, i) => i);

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

function EventButton({
  ev,
  locale,
  t,
  showAccountAvatar,
  onOpenEvent,
}: {
  ev: CalendarEvent;
  locale: string;
  t: ReturnType<typeof useTranslations>;
  showAccountAvatar?: boolean;
  onOpenEvent(id: string): void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return draggable({
      element: el,
      getInitialData: (): EventDragData => ({
        eventId: ev.id,
        at: new Date(ev.scheduledAt),
      }),
      onDragStart: () => setIsDragging(true),
      onDrop: () => setIsDragging(false),
    });
  }, [ev.id, ev.scheduledAt]);

  const colors = accountColors(ev.account.id);
  const when = new Date(ev.scheduledAt);
  const time = when.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const status = ev.status ?? "scheduled";
  const marker =
    status === "published"
      ? { Icon: CheckCircle2, cls: "text-success", label: t("schedule.publishedMarker") }
      : status === "failed"
        ? { Icon: AlertTriangle, cls: "text-destructive", label: t("schedule.failedMarker") }
        : { Icon: Clock, cls: "text-muted-foreground", label: t("schedule.notPublished") };
  const MarkerIcon = marker.Icon;

  return (
    <HoverCard openDelay={120} closeDelay={60}>
      <HoverCardTrigger asChild>
        <button
          ref={ref}
          type="button"
          onClick={() => onOpenEvent(ev.id)}
          style={{ borderLeftColor: colors.stripe, backgroundColor: colors.tint }}
          className={cn(
            "flex w-full items-center gap-1 rounded-sm border-l-[3px] px-1 py-0.5 text-left text-[11px] transition-shadow hover:ring-1 hover:ring-inset hover:ring-border",
            isDragging && "opacity-50",
          )}
        >
          <MarkerIcon className={cn("size-3 shrink-0", marker.cls)} aria-label={marker.label}>
            <title>{marker.label}</title>
          </MarkerIcon>
          {showAccountAvatar && <EventAvatar account={ev.account} />}
          <span className="min-w-0 truncate text-foreground">{ev.title}</span>
          <span className="ml-auto shrink-0 text-muted-foreground">{time}</span>
        </button>
      </HoverCardTrigger>
      <HoverCardContent side="right" align="start" className="w-72">
        <div className="flex items-center gap-2">
          <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: colors.dot }} />
          <span className="truncate text-xs font-medium text-muted-foreground">{ev.account.displayName}</span>
        </div>
        <p className="mt-2 line-clamp-4 text-sm">{ev.title}</p>
        {ev.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={ev.imageUrl} alt="" className="mt-2 max-h-32 w-full rounded-md object-cover" />
        )}
        <div className="mt-2 flex items-center gap-1.5 border-t pt-2 text-xs text-muted-foreground">
          <MarkerIcon className={cn("size-3.5", marker.cls)} />
          <span>
            {when.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" })} · {time}
          </span>
          {status === "published" && ev.externalId ? (
            <a
              href={`https://www.linkedin.com/feed/update/${ev.externalId}`}
              target="_blank"
              rel="noreferrer"
              className="text-primary ml-auto hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {t("schedule.viewOnLinkedin")}
            </a>
          ) : (
            <span className={cn("ml-auto", marker.cls)}>{marker.label}</span>
          )}
        </div>
        {status === "published" && ev.metrics && (
          <div className="text-muted-foreground mt-1.5 flex gap-3 text-xs">
            <span>{(ev.metrics.impressions ?? 0).toLocaleString(locale)} {t("schedule.impressions")}</span>
            <span>{(ev.metrics.reactions ?? 0).toLocaleString(locale)} {t("schedule.reactions")}</span>
            <span>{(ev.metrics.comments ?? 0).toLocaleString(locale)} {t("schedule.comments")}</span>
          </div>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}

/** Month day cell: registers itself as a drop target for `EventButton` drags. */
function DayCell({
  cellDate,
  className,
  children,
}: {
  cellDate: Date;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [isOver, setIsOver] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return dropTargetForElements({
      element: el,
      getData: (): DayDropData => ({ kind: "day", date: cellDate }),
      onDragEnter: () => setIsOver(true),
      onDragLeave: () => setIsOver(false),
      onDrop: () => setIsOver(false),
    });
  }, [cellDate]);

  return (
    <div ref={ref} className={cn(className, isOver && "bg-accent")}>
      {children}
    </div>
  );
}

/** Week/day hour slot cell: registers itself as a drop target for `EventButton` drags. */
function HourSlotCell({
  dayDate,
  hour,
  className,
  children,
}: {
  dayDate: Date;
  hour: number;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [isOver, setIsOver] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return dropTargetForElements({
      element: el,
      getData: (): SlotDropData => ({ kind: "slot", date: dayDate, hour }),
      onDragEnter: () => setIsOver(true),
      onDragLeave: () => setIsOver(false),
      onDrop: () => setIsOver(false),
    });
  }, [dayDate, hour]);

  return (
    <div ref={ref} className={cn(className, isOver && "bg-accent")}>
      {children}
    </div>
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
    onReschedule,
    onCreate,
    showAccountAvatar,
  } = props;
  const t = useTranslations();
  const locale = useLocale();

  const days = view === "day" ? [cursor] : weekDays(cursor);

  useEffect(() => {
    return monitorForElements({
      onDrop({ source, location }) {
        const target = location.current.dropTargets[0];
        if (!target) return;

        const { eventId, at } = source.data as unknown as EventDragData;
        const data = target.data as unknown as DropData;

        const next =
          data.kind === "day"
            ? withTimeOfDay(data.date, at)
            : withHour(data.date, data.hour, at.getMinutes());

        if (next.getTime() <= Date.now()) return;
        onReschedule(eventId, next);
      },
    });
  }, [onReschedule]);

  function step(delta: number): Date {
    if (view === "month") return stepMonth(cursor, delta);
    if (view === "week") return addDays(cursor, delta * 7);
    return addDays(cursor, delta);
  }

  const title =
    view === "month"
      ? cursor.toLocaleDateString(locale, { month: "long", year: "numeric" })
      : view === "week"
        ? `${days[0]!.toLocaleDateString(locale, { day: "numeric", month: "short" })} – ${days[6]!.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })}`
        : cursor.toLocaleDateString(locale, {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
          });

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
              aria-label={t("schedule.prev")}
              onClick={() => onCursor(step(-1))}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label={t("schedule.next")}
              onClick={() => onCursor(step(1))}
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
                <DayCell
                  key={i}
                  cellDate={cellDate}
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
                      <EventButton
                        key={ev.id}
                        ev={ev}
                        locale={locale}
                        t={t}
                        showAccountAvatar={showAccountAvatar}
                        onOpenEvent={onOpenEvent}
                      />
                    ))}
                    {hiddenCount > 0 && (
                      <span className="px-1 text-[11px] text-muted-foreground">
                        {t("schedule.moreCount", { count: hiddenCount })}
                      </span>
                    )}
                  </div>
                </DayCell>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col overflow-hidden">
          {view === "week" && (
            <div className="flex border-b">
              <div className="w-12 shrink-0 border-r" />
              {days.map((d, i) => {
                const isToday = sameDay(d, new Date());
                return (
                  <div
                    key={i}
                    className="flex flex-1 flex-col items-center gap-1 border-r py-2 last:border-r-0"
                  >
                    <span className="text-xs font-medium text-muted-foreground">
                      {weekdayLabels[i]}
                    </span>
                    <span
                      className={cn(
                        "flex size-6 items-center justify-center rounded-full text-xs",
                        isToday
                          ? "bg-primary font-semibold text-primary-foreground"
                          : "text-foreground",
                      )}
                    >
                      {d.getDate()}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            {HOURS.map((h) => (
              <div key={h} className="flex min-h-16 border-b last:border-b-0">
                <div className="w-12 shrink-0 border-r px-1 pt-1 text-right text-[10px] text-muted-foreground">
                  {String(h).padStart(2, "0")}:00
                </div>
                {days.map((day, i) => {
                  const cellEvents = events.filter((ev) => {
                    const evDate = new Date(ev.scheduledAt);
                    return sameDay(evDate, day) && evDate.getHours() === h;
                  });
                  return (
                    <HourSlotCell
                      key={i}
                      dayDate={day}
                      hour={h}
                      className="flex min-w-0 flex-1 flex-col gap-0.5 border-r p-0.5 last:border-r-0"
                    >
                      {cellEvents.map((ev) => (
                        <EventButton
                          key={ev.id}
                          ev={ev}
                          locale={locale}
                          t={t}
                          showAccountAvatar={showAccountAvatar}
                          onOpenEvent={onOpenEvent}
                        />
                      ))}
                    </HourSlotCell>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
