// apps/api/src/routes/feed.test.ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("../feed/fetch.js", () => ({
  fetchFeed: vi.fn(async () => ({
    title: "Ex",
    items: [{ guid: "g1", title: "Item 1", url: "https://example.com/1", excerpt: "e1" }],
  })),
}));

import { prisma } from "@outreach/db";
import { createApp } from "../app.js";

let userId = "", cookie = "";
const app = createApp();

async function authedCookie(): Promise<{ cookie: string; email: string }> {
  const email = `f${Date.now() + Math.floor(Math.random() * 1e9)}-${Math.random().toString(36).slice(2)}@ex.com`;
  const res = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: process.env.WEB_ORIGIN! },
    body: JSON.stringify({ email, password: "password-1234", name: "F" }),
  });
  return { cookie: res.headers.get("set-cookie")!.split(";")[0]!, email };
}

beforeAll(async () => {
  const signup = await authedCookie();
  cookie = signup.cookie;
  const u = await prisma.user.findFirstOrThrow({ where: { email: signup.email } });
  userId = u.id;
});
afterAll(async () => { await prisma.user.delete({ where: { id: userId } }); await prisma.$disconnect(); });

describe("feed routes", () => {
  it("creates a source with seeded items, rejects duplicates, lists/updates items scoped to the user, and deletes", async () => {
    const url = `https://example.com/feed-${Date.now()}.xml`;

    const create = await app.request("/feed/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ url }),
    });
    expect(create.status).toBe(200);
    const { source } = (await create.json()) as { source: { id: string; title: string; url: string } };
    expect(source.title).toBe("Ex");
    expect(source.url).toBe(url);

    const dup = await app.request("/feed/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ url }),
    });
    expect(dup.status).toBe(409);
    expect((await dup.json()) as { error: string }).toEqual({ error: "duplicate" });

    const list = await app.request("/feed/items", { headers: { Cookie: cookie } });
    expect(list.status).toBe(200);
    const { items } = (await list.json()) as { items: Array<{ id: string; status: string; guid: string }> };
    const seeded = items.find((i) => i.guid === "g1");
    expect(seeded).toBeTruthy();
    expect(seeded!.status).toBe("new");

    const other = await authedCookie();
    const otherList = await app.request("/feed/items", { headers: { Cookie: other.cookie } });
    expect(otherList.status).toBe(200);
    expect(((await otherList.json()) as { items: unknown[] }).items).toHaveLength(0);

    const crossPatch = await app.request(`/feed/items/${seeded!.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: other.cookie },
      body: JSON.stringify({ status: "read" }),
    });
    expect(crossPatch.status).toBe(404);
    await prisma.user.delete({ where: { id: (await prisma.user.findFirstOrThrow({ where: { email: other.email } })).id } });

    const patch = await app.request(`/feed/items/${seeded!.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ status: "read" }),
    });
    expect(patch.status).toBe(200);
    const { item } = (await patch.json()) as { item: { status: string } };
    expect(item.status).toBe("read");

    const del = await app.request(`/feed/sources/${source.id}`, {
      method: "DELETE",
      headers: { Cookie: cookie },
    });
    expect(del.status).toBe(200);
    expect((await del.json()) as { ok: boolean }).toEqual({ ok: true });
  });
});
