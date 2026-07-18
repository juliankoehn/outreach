import { Hono } from "hono";
import { draftPost, refinePost, generateImage } from "@outreach/ai";
import type { AppEnv } from "../app.js";
import { getAccountSummary } from "../repos/linkedin-account.js";
import { getProfile } from "../repos/profile.js";
import { createDraft, listDrafts, getDraft, updateDraft, deleteDraft } from "../repos/draft.js";
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

    const { prompt, postText } = await c.req
      .json<{ prompt?: string; postText?: string }>()
      .catch(() => ({ prompt: undefined, postText: undefined }));
    if (!prompt) return c.json({ error: "invalid_body" }, 400);
    const { base64, mediaType } = await generateImage(prompt, { postText });
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

  r.get("/:accountId/drafts/:id", async (c) => {
    const user = c.get("user")!;
    const accountId = c.req.param("accountId");
    if (!(await requireAccount(accountId, user.id))) return c.json({ error: "not_found" }, 404);
    const draft = await getDraft(c.req.param("id"), accountId);
    if (!draft) return c.json({ error: "not_found" }, 404);
    return c.json({ draft });
  });

  r.post("/:accountId/drafts", async (c) => {
    const user = c.get("user")!;
    const accountId = c.req.param("accountId");
    const acct = await requireAccount(accountId, user.id);
    if (!acct) return c.json({ error: "not_found" }, 404);

    // A new draft may start empty (workspace-first flow); text is optional.
    const body = await c
      .req.json<{ text?: string; imageUrl?: string; imagePrompt?: string }>()
      .catch(() => ({}) as { text?: string; imageUrl?: string; imagePrompt?: string });
    return c.json({ draft: await createDraft(accountId, { ...body, text: body.text ?? "" }) });
  });

  // Refine the current draft via a natural-language instruction (canvas chat).
  r.post("/:accountId/drafts/:id/chat", async (c) => {
    const user = c.get("user")!;
    const accountId = c.req.param("accountId");
    if (!(await requireAccount(accountId, user.id))) return c.json({ error: "not_found" }, 404);
    const draft = await getDraft(c.req.param("id"), accountId);
    if (!draft) return c.json({ error: "not_found" }, 404);

    const { instruction } = await c.req
      .json<{ instruction?: string }>()
      .catch(() => ({ instruction: undefined }));
    if (!instruction) return c.json({ error: "invalid_body" }, 400);

    const profile = await getProfile(accountId);
    const text = await refinePost(profile?.brandBrief ?? "", draft.text, instruction);
    const chat = [
      ...(Array.isArray(draft.chat) ? draft.chat : []),
      { role: "user", content: instruction },
      { role: "assistant", content: text },
    ];
    return c.json({ draft: await updateDraft(c.req.param("id"), accountId, { text, chat }) });
  });

  // Regenerate the draft text from scratch (needs a ready profile).
  r.post("/:accountId/drafts/:id/regenerate", async (c) => {
    const user = c.get("user")!;
    const accountId = c.req.param("accountId");
    if (!(await requireAccount(accountId, user.id))) return c.json({ error: "not_found" }, 404);
    const draft = await getDraft(c.req.param("id"), accountId);
    if (!draft) return c.json({ error: "not_found" }, 404);

    const profile = await getProfile(accountId);
    if (!profile || profile.status !== "ready" || !profile.brandBrief) {
      return c.json({ error: "no_profile" }, 400);
    }
    const { topic } = await c.req.json<{ topic?: string }>().catch(() => ({ topic: undefined }));
    const text = await draftPost(profile.brandBrief, { topic });
    return c.json({ draft: await updateDraft(c.req.param("id"), accountId, { text }) });
  });

  r.patch("/:accountId/drafts/:id", async (c) => {
    const user = c.get("user")!;
    const accountId = c.req.param("accountId");
    const acct = await requireAccount(accountId, user.id);
    if (!acct) return c.json({ error: "not_found" }, 404);

    const body = await c.req.json().catch(() => ({}));
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
