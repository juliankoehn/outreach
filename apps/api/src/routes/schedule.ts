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
