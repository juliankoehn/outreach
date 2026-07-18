import { Hono } from "hono";
import { draftPost, generateImage } from "@outreach/ai";
import type { AppEnv } from "../app.js";
import { getAccountSummary } from "../repos/linkedin-account.js";
import { getProfile } from "../repos/profile.js";
import { createDraft, listDrafts, updateDraft, deleteDraft } from "../repos/draft.js";
import { saveImage } from "../images.js";

// NOTE on ownership: mirrors routes/profile.ts — the per-handler inline check
// (rather than a shared middleware) keeps each handler simply typed against
// Hono's generics. `getAccountSummary` is a single indexed lookup, so the
// per-handler cost is negligible.
export function studioRoutes() {
  const r = new Hono<AppEnv>();

  async function requireAccount(accountId: string, userId: string) {
    return getAccountSummary(accountId, userId);
  }

  r.post("/:accountId/draft-text", async (c) => {
    const user = c.get("user")!;
    const accountId = c.req.param("accountId");
    const acct = await requireAccount(accountId, user.id);
    if (!acct) return c.json({ error: "not_found" }, 404);

    const profile = await getProfile(accountId);
    if (!profile || profile.status !== "ready" || !profile.brandBrief) {
      return c.json({ error: "no_profile" }, 400);
    }
    const { topic } = await c.req.json<{ topic?: string }>().catch(() => ({ topic: undefined }));
    const text = await draftPost(profile.brandBrief, { topic });
    return c.json({ text });
  });

  r.post("/:accountId/draft-image", async (c) => {
    const user = c.get("user")!;
    const accountId = c.req.param("accountId");
    const acct = await requireAccount(accountId, user.id);
    if (!acct) return c.json({ error: "not_found" }, 404);

    const { prompt } = await c.req.json<{ prompt: string }>();
    const { base64, mediaType } = await generateImage(prompt);
    const { url } = await saveImage(base64, mediaType);
    return c.json({ imageUrl: url });
  });

  r.get("/:accountId/drafts", async (c) => {
    const user = c.get("user")!;
    const accountId = c.req.param("accountId");
    const acct = await requireAccount(accountId, user.id);
    if (!acct) return c.json({ error: "not_found" }, 404);

    return c.json({ drafts: await listDrafts(accountId) });
  });

  r.post("/:accountId/drafts", async (c) => {
    const user = c.get("user")!;
    const accountId = c.req.param("accountId");
    const acct = await requireAccount(accountId, user.id);
    if (!acct) return c.json({ error: "not_found" }, 404);

    const body = await c.req.json<{ text: string; imageUrl?: string; imagePrompt?: string }>();
    return c.json({ draft: await createDraft(accountId, body) });
  });

  r.patch("/:accountId/drafts/:id", async (c) => {
    const user = c.get("user")!;
    const accountId = c.req.param("accountId");
    const acct = await requireAccount(accountId, user.id);
    if (!acct) return c.json({ error: "not_found" }, 404);

    const body = await c.req.json();
    return c.json({ draft: await updateDraft(c.req.param("id"), accountId, body) });
  });

  r.delete("/:accountId/drafts/:id", async (c) => {
    const user = c.get("user")!;
    const accountId = c.req.param("accountId");
    const acct = await requireAccount(accountId, user.id);
    if (!acct) return c.json({ error: "not_found" }, 404);

    await deleteDraft(c.req.param("id"), accountId);
    return c.json({ ok: true });
  });

  return r;
}
