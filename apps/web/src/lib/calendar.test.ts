import { describe, it, expect } from "vitest";
import { monthGrid, weekDays, mondayOf, withTimeOfDay, withHour, toLocalInputValue, fromLocalInputValue, sameDay } from "./calendar";

describe("calendar utils", () => {
  it("monthGrid returns 42 days, Monday-first, covering the month", () => {
    const grid = monthGrid(new Date(2022, 0, 15)); // Jan 2022
    expect(grid).toHaveLength(42);
    expect(grid[0]!.getDay()).toBe(1); // Monday
    expect(grid.some((d) => d.getMonth() === 0 && d.getDate() === 1)).toBe(true);
    expect(grid.some((d) => d.getMonth() === 0 && d.getDate() === 31)).toBe(true);
  });

  it("weekDays returns Mon..Sun of the cursor's week", () => {
    const days = weekDays(new Date(2022, 0, 12)); // a Wednesday
    expect(days).toHaveLength(7);
    expect(days[0]!.getDay()).toBe(1);
    expect(sameDay(days[0]!, mondayOf(new Date(2022, 0, 12)))).toBe(true);
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
