// apps/api/src/routes/profile.ts
import { Hono } from "hono";
import { nextTurn, synthesizeProfile, analyzePosts } from "@outreach/ai";
import type { ChatMessage, DerivedInsights } from "@outreach/ai";
import type { AppEnv } from "../app.js";
import { getAccountSummary } from "../repos/linkedin-account.js";
import { listPosts } from "../repos/post.js";
import {
  getOrCreateInterview,
  appendInterviewMessage,
  completeInterview,
  getProfile,
  upsertProfile,
} from "../repos/profile.js";

// NOTE on ownership: the brief sketches a shared Hono middleware
// (`r.use("/:accountId/*", ownership)`) for the 404-if-not-owned check.
// Hono's generics make a standalone middleware function awkward to type
// against a parameterized route (the handler's `c` type differs per route
// signature), so we inline the check at the top of every handler instead.
// `getAccountSummary` is a single indexed lookup, so the per-handler cost is
// negligible, and each handler stays self-contained and simply typed.
export function profileRoutes() {
  const r = new Hono<AppEnv>();

  async function requireAccount(accountId: string, userId: string) {
    return getAccountSummary(accountId, userId);
  }

  r.get("/:accountId", async (c) => {
    const user = c.get("user")!;
    const accountId = c.req.param("accountId");
    const acct = await requireAccount(accountId, user.id);
    if (!acct) return c.json({ error: "not_found" }, 404);
    return c.json({ profile: await getProfile(accountId) });
  });

  r.post("/:accountId/interview/start", async (c) => {
    const user = c.get("user")!;
    const accountId = c.req.param("accountId");
    const acct = await requireAccount(accountId, user.id);
    if (!acct) return c.json({ error: "not_found" }, 404);

    const body = await c.req.json<{ locale?: string }>().catch(() => ({}) as { locale?: string });
    const language = langName(body.locale);
    const iv = await getOrCreateInterview(accountId);
    if (iv.messages.length === 0) {
      const derived = (await getProfile(accountId))?.derived as DerivedInsights | undefined;
      const opener = await nextTurn([{ role: "user", content: "(start the interview)" }], {
        seed: derivedSeed(derived),
        language,
      });
      await appendInterviewMessage(iv.id, { role: "assistant", content: opener });
      return c.json({ messages: [{ role: "assistant", content: opener }] });
    }
    return c.json({ messages: iv.messages });
  });

  r.post("/:accountId/interview/reply", async (c) => {
    const user = c.get("user")!;
    const accountId = c.req.param("accountId");
    const acct = await requireAccount(accountId, user.id);
    if (!acct) return c.json({ error: "not_found" }, 404);

    const { message, locale } = await c.req.json<{ message: string; locale?: string }>();
    const iv = await getOrCreateInterview(accountId);
    await appendInterviewMessage(iv.id, { role: "user", content: message });
    const derived = (await getProfile(accountId))?.derived as DerivedInsights | undefined;
    const reply = await nextTurn([...iv.messages, { role: "user", content: message }], {
      seed: derivedSeed(derived),
      language: langName(locale),
    });
    await appendInterviewMessage(iv.id, { role: "assistant", content: reply });
    return c.json({ reply });
  });

  r.post("/:accountId/interview/finalize", async (c) => {
    const user = c.get("user")!;
    const accountId = c.req.param("accountId");
    const acct = await requireAccount(accountId, user.id);
    if (!acct) return c.json({ error: "not_found" }, 404);

    const iv = await getOrCreateInterview(accountId);
    const derived = (await getProfile(accountId))?.derived as DerivedInsights | undefined;
    const synthesized = await synthesizeProfile(iv.messages as ChatMessage[], { derived });
    const profile = await upsertProfile(accountId, { ...synthesized, status: "ready" });
    await completeInterview(iv.id);
    return c.json({ profile });
  });

  r.patch("/:accountId", async (c) => {
    const user = c.get("user")!;
    const accountId = c.req.param("accountId");
    const acct = await requireAccount(accountId, user.id);
    if (!acct) return c.json({ error: "not_found" }, 404);

    const body = await c.req.json();
    const profile = await upsertProfile(accountId, body);
    return c.json({ profile });
  });

  r.post("/:accountId/analyze", async (c) => {
    const user = c.get("user")!;
    const accountId = c.req.param("accountId");
    const acct = await requireAccount(accountId, user.id);
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
    await upsertProfile(accountId, { derived, derivedAt: new Date() });
    return c.json({ derived });
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
