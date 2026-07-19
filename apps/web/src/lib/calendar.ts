/**
 * Pure, native-`Date` calendar utilities. All functions operate in the
 * browser's LOCAL timezone (using local `Date` getters/setters), not UTC.
 * Weeks are Monday-first.
 */

export function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

/** Monday of d's week. */
export function mondayOf(d: Date): Date {
  const day = (d.getDay() + 6) % 7;
  return addDays(startOfDay(d), -day);
}

/** 7 days, Mon..Sun, of the cursor's week. */
export function weekDays(cursor: Date): Date[] {
  const monday = mondayOf(cursor);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** 42 days (6 weeks) starting the Monday on/before the 1st of cursor's month. */
export function monthGrid(cursor: Date): Date[] {
  const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start = mondayOf(firstOfMonth);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** date's Y/M/D + from's H/M. */
export function withTimeOfDay(date: Date, from: Date): Date {
  const out = new Date(date);
  out.setHours(from.getHours(), from.getMinutes(), from.getSeconds(), from.getMilliseconds());
  return out;
}

export function withHour(date: Date, hour: number, minutes: number): Date {
  const out = new Date(date);
  out.setHours(hour, minutes, 0, 0);
  return out;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** `YYYY-MM-DDTHH:mm` for `datetime-local` inputs, in local time. */
export function toLocalInputValue(d: Date): string {
  const y = d.getFullYear();
  const mo = pad(d.getMonth() + 1);
  const da = pad(d.getDate());
  const h = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${y}-${mo}-${da}T${h}:${mi}`;
}

/** Parse a `datetime-local` value as local time. */
export function fromLocalInputValue(v: string): Date {
  return new Date(v);
}
