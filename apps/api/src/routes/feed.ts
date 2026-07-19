// apps/api/src/routes/feed.ts
import { Hono } from "hono";
import type { AppEnv } from "../app.js";
import { createSource, listSources, deleteSource, getSource, listItems, setItemStatus } from "../repos/feed.js";
import { fetchFeed } from "../feed/fetch.js";
import { enqueueFeedFetch } from "../queue.js";
import { insertItems } from "../repos/feed.js";

export function feedRoutes() {
  const r = new Hono<AppEnv>();

  r.get("/sources", async (c) => c.json({ sources: await listSources(c.get("user")!.id) }));

  r.post("/sources", async (c) => {
    const user = c.get("user")!;
    const { url } = await c.req.json<{ url?: string }>().catch(() => ({ url: undefined }));
    if (!url) return c.json({ error: "invalid_body" }, 400);
    let feed;
    try { feed = await fetchFeed(url); } catch { return c.json({ error: "unreachable" }, 400); }
    const source = await createSource({ userId: user.id, url, title: feed.title }).catch(() => null);
    if (!source) return c.json({ error: "duplicate" }, 409); // @@unique([userId, url])
    await insertItems(source.id, user.id, feed.items);
    void enqueueFeedFetch(source.id).catch(() => {});
    return c.json({ source });
  });

  r.delete("/sources/:id", async (c) => {
    const ok = await deleteSource(c.req.param("id"), c.get("user")!.id);
    return ok ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
  });

  r.post("/sources/:id/refresh", async (c) => {
    const s = await getSource(c.req.param("id"), c.get("user")!.id);
    if (!s) return c.json({ error: "not_found" }, 404);
    void enqueueFeedFetch(s.id).catch(() => {});
    return c.json({ ok: true });
  });

  r.get("/items", async (c) => {
    const status = c.req.query("status") ?? "new";
    const limit = Math.min(Math.max(Number(c.req.query("limit")) || 100, 1), 200);
    return c.json({ items: await listItems(c.get("user")!.id, status, limit) });
  });

  r.patch("/items/:id", async (c) => {
    const { status } = await c.req.json<{ status?: string }>().catch(() => ({ status: undefined }));
    if (!status || !["new", "read", "dismissed"].includes(status)) return c.json({ error: "invalid_body" }, 400);
    const updated = await setItemStatus(c.req.param("id"), c.get("user")!.id, status);
    return updated ? c.json({ item: updated }) : c.json({ error: "not_found" }, 404);
  });

  return r;
}
