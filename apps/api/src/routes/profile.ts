// apps/api/src/routes/profile.ts
import { Hono } from "hono";
import { nextTurn, synthesizeProfile, analyzePosts } from "@outreach/ai";
import type { ChatMessage, DerivedInsights } from "@outreach/ai";
import type { AppEnv } from "../app.js";
import { getAccountSummary } from "../repos/linkedin-account.js";
import { listPosts } from "../repos/post.js";
import {
  listProfiles,
  createProfile,
  getProfileById,
  updateProfileById,
  deleteProfileById,
  assignProfileToAccount,
  unassignProfileFromAccount,
  getOrCreateInterview,
  appendInterviewMessage,
  completeInterview,
} from "../repos/profile.js";

// NOTE on ownership: mirrors the prior /profile routes -- Hono's generics
// make a standalone middleware function awkward to type against a
// parameterized route, so we inline the owner-check at the top of every
// handler instead. `getProfileById`/`getAccountSummary` are single indexed
// lookups, so the per-handler cost is negligible.
export function profileRoutes() {
  const r = new Hono<AppEnv>();

  async function requireProfile(id: string, userId: string) {
    return getProfileById(id, userId);
  }

  r.get("/", async (c) => {
    const user = c.get("user")!;
    return c.json({ profiles: await listProfiles(user.id) });
  });

  r.post("/", async (c) => {
    const user = c.get("user")!;
    const { name } = await c.req.json<{ name?: string }>().catch(() => ({}) as { name?: string });
    return c.json({ profile: await createProfile(user.id, name) });
  });

  r.get("/:id", async (c) => {
    const user = c.get("user")!;
    const id = c.req.param("id");
    const profile = await requireProfile(id, user.id);
    if (!profile) return c.json({ error: "not_found" }, 404);
    return c.json({ profile });
  });

  r.patch("/:id", async (c) => {
    const user = c.get("user")!;
    const id = c.req.param("id");
    const profile = await requireProfile(id, user.id);
    if (!profile) return c.json({ error: "not_found" }, 404);

    const body = await c.req.json();
    return c.json({ profile: await updateProfileById(id, user.id, body) });
  });

  r.delete("/:id", async (c) => {
    const user = c.get("user")!;
    const id = c.req.param("id");
    const profile = await requireProfile(id, user.id);
    if (!profile) return c.json({ error: "not_found" }, 404);

    await deleteProfileById(id, user.id);
    return c.json({ ok: true });
  });

  r.post("/:id/interview/start", async (c) => {
    const user = c.get("user")!;
    const id = c.req.param("id");
    const profile = await requireProfile(id, user.id);
    if (!profile) return c.json({ error: "not_found" }, 404);

    const body = await c.req.json<{ locale?: string }>().catch(() => ({}) as { locale?: string });
    const language = langName(body.locale);
    const iv = await getOrCreateInterview(id);
    if (iv.messages.length === 0) {
      const derived = profile.derived as unknown as DerivedInsights | undefined;
      const opener = await nextTurn([{ role: "user", content: "(start the interview)" }], {
        seed: derivedSeed(derived),
        language,
      });
      await appendInterviewMessage(iv.id, { role: "assistant", content: opener });
      return c.json({ messages: [{ role: "assistant", content: opener }] });
    }
    return c.json({ messages: iv.messages });
  });

  r.post("/:id/interview/reply", async (c) => {
    const user = c.get("user")!;
    const id = c.req.param("id");
    const profile = await requireProfile(id, user.id);
    if (!profile) return c.json({ error: "not_found" }, 404);

    const { message, locale } = await c.req.json<{ message: string; locale?: string }>();
    const iv = await getOrCreateInterview(id);
    await appendInterviewMessage(iv.id, { role: "user", content: message });
    const derived = profile.derived as unknown as DerivedInsights | undefined;
    const reply = await nextTurn([...iv.messages, { role: "user", content: message }], {
      seed: derivedSeed(derived),
      language: langName(locale),
    });
    await appendInterviewMessage(iv.id, { role: "assistant", content: reply });
    return c.json({ reply });
  });

  r.post("/:id/interview/finalize", async (c) => {
    const user = c.get("user")!;
    const id = c.req.param("id");
    const profile = await requireProfile(id, user.id);
    if (!profile) return c.json({ error: "not_found" }, 404);

    const iv = await getOrCreateInterview(id);
    const derived = profile.derived as unknown as DerivedInsights | undefined;
    const synthesized = await synthesizeProfile(iv.messages as ChatMessage[], { derived });
    const updated = await updateProfileById(id, user.id, { ...synthesized, status: "ready" });
    await completeInterview(iv.id);
    return c.json({ profile: updated });
  });

  r.post("/:id/analyze", async (c) => {
    const user = c.get("user")!;
    const id = c.req.param("id");
    const profile = await requireProfile(id, user.id);
    if (!profile) return c.json({ error: "not_found" }, 404);

    const { accountId } = await c.req.json<{ accountId: string }>();
    const acct = await getAccountSummary(accountId, user.id);
    if (!acct) return c.json({ error: "not_found" }, 404);

    const posts = await listPosts(accountId);
    if (posts.length === 0) return c.json({ error: "no_posts" }, 409);
    const derived = await analyzePosts(
      posts.map((p) => ({
        text: p.text,
        publishedAt: p.publishedAt.toISOString(),
        metrics: p.metrics as { impressions?: number; reactions?: number; comments?: number } | null,
      })),
    );
    await updateProfileById(id, user.id, { derived, derivedAt: new Date() });
    return c.json({ derived });
  });

  r.post("/:id/assign", async (c) => {
    const user = c.get("user")!;
    const id = c.req.param("id");
    const { accountId } = await c.req.json<{ accountId: string }>();
    const ok = await assignProfileToAccount(id, accountId, user.id);
    if (!ok) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  });

  r.post("/:id/unassign", async (c) => {
    const user = c.get("user")!;
    const { accountId } = await c.req.json<{ accountId: string }>();
    const ok = await unassignProfileFromAccount(accountId, user.id);
    if (!ok) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  });

  return r;
}

const LANGUAGES: Record<string, string> = { en: "English", de: "German" };
function langName(locale?: string): string | undefined {
  return locale ? (LANGUAGES[locale] ?? locale) : undefined;
}

function derivedSeed(derived?: DerivedInsights): string | undefined {
  if (!derived) return undefined;
  return `Voice: ${derived.voiceSummary}. Themes: ${derived.themes.join(", ")}. What performs: ${derived.topPatterns.join("; ")}.`;
}
