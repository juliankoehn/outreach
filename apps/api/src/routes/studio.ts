import { Hono } from "hono";
import { draftPost, refinePost, generateImage, streamStudioAgent } from "@outreach/ai";
import type { UIMessage, DerivedInsights } from "@outreach/ai";
import type { AppEnv } from "../app.js";
import { getAccountSummary } from "../repos/linkedin-account.js";
import { getAccountProfile } from "../repos/profile.js";
import { createDraft, listDrafts, getDraft, updateDraft, deleteDraft } from "../repos/draft.js";
import { findSimilarPosts } from "../repos/post.js";
import { imageReferenceHint } from "../repos/resource.js";
import { retrieveKnowledge } from "../repos/knowledge.js";
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

    const profile = await getAccountProfile(accountId);
    if (!profile || profile.status !== "ready" || !profile.brandBrief) {
      return c.json({ error: "no_profile" }, 400);
    }
    const { topic } = await c.req.json<{ topic?: string }>().catch(() => ({ topic: undefined }));
    const text = await draftPost(profile.brandBrief, { topic, noGos: profile.noGos, toneWords: profile.toneWords });
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
    const profile = await getAccountProfile(accountId);
    const visualStyle = (profile?.derived as unknown as DerivedInsights | null | undefined)?.visualStyle;
    const referenceHint = await imageReferenceHint(accountId);
    const { base64, mediaType } = await generateImage(prompt, {
      postText,
      visualStyle,
      size: "square",
      referenceHint,
    });
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

    const profile = await getAccountProfile(accountId);
    const text = await refinePost(profile?.brandBrief ?? "", draft.text, instruction, { noGos: profile?.noGos, toneWords: profile?.toneWords });
    const chat = [
      ...(Array.isArray(draft.chat) ? draft.chat : []),
      { role: "user", content: instruction },
      { role: "assistant", content: text },
    ];
    return c.json({ draft: await updateDraft(c.req.param("id"), accountId, { text, chat }) });
  });

  // Streaming agent chat: the model talks in the chat pane and edits the canvas
  // via the updatePost / generateImage tools. Returns an AI-SDK UI message stream.
  r.post("/:accountId/drafts/:id/agent", async (c) => {
    const user = c.get("user")!;
    const accountId = c.req.param("accountId");
    if (!(await requireAccount(accountId, user.id))) return c.json({ error: "not_found" }, 404);
    const draftId = c.req.param("id");
    const draft = await getDraft(draftId, accountId);
    if (!draft) return c.json({ error: "not_found" }, 404);

    const { messages } = await c.req
      .json<{ messages: UIMessage[] }>()
      .catch(() => ({ messages: [] as UIMessage[] }));

    const profile = await getAccountProfile(accountId);
    const derived = profile?.derived as unknown as DerivedInsights | null | undefined;
    const insights = derived
      ? `Voice: ${derived.voiceSummary} Recurring themes: ${derived.themes.join(", ")}. Style traits: ${derived.styleTraits.join(", ")}. What drives engagement: ${derived.topPatterns.join("; ")}.`
      : undefined;

    // Track the live post text so a generateImage call after an updatePost call
    // in the same turn sees the fresh copy, not the stale draft snapshot.
    let currentText = draft.text;
    const referenceHint = await imageReferenceHint(accountId);

    return streamStudioAgent({
      messages,
      brandBrief: profile?.brandBrief ?? undefined,
      toneWords: profile?.toneWords,
      pillars: profile?.pillars,
      noGos: profile?.noGos,
      insights,
      currentText,
      handlers: {
        updatePost: async (text) => {
          currentText = text;
          await updateDraft(draftId, accountId, { text });
        },
        createImage: async (prompt) => {
          const { base64, mediaType } = await generateImage(prompt, {
            postText: currentText,
            visualStyle: derived?.visualStyle,
            size: "square",
            referenceHint,
          });
          const { url } = await saveImage(base64, mediaType);
          await updateDraft(draftId, accountId, { imageUrl: url, imagePrompt: prompt });
          return { imageUrl: url };
        },
        findSimilar: (query) => findSimilarPosts(accountId, query, { excludeDraftId: draftId }),
        searchKnowledge: (query) =>
          retrieveKnowledge(accountId, query).then((hits) =>
            hits.map((h) => ({ content: h.content, section: h.section, resourceName: h.resourceName })),
          ),
      },
      onFinish: async (finalMessages) => {
        // Merge into the persisted chat by message id rather than overwriting:
        // if messages are sent in quick succession the client's snapshot can
        // miss an in-flight assistant turn, and a blind overwrite would drop it
        // (tool cards vanished after reload). Keep every message we've ever seen.
        const current = await getDraft(draftId, accountId);
        const existing = ((current?.chat as unknown as UIMessage[] | null) ?? []).filter(
          (m) => !!m && typeof m.id === "string",
        );
        const incoming = new Map(finalMessages.map((m) => [m.id, m]));
        const seen = new Set(existing.map((m) => m.id));
        const merged = [
          ...existing.map((m) => incoming.get(m.id) ?? m), // update in place if re-sent
          ...finalMessages.filter((m) => !seen.has(m.id)), // append genuinely new turns
        ];
        await updateDraft(draftId, accountId, { chat: merged });
      },
    });
  });

  // Regenerate the draft text from scratch (needs a ready profile).
  r.post("/:accountId/drafts/:id/regenerate", async (c) => {
    const user = c.get("user")!;
    const accountId = c.req.param("accountId");
    if (!(await requireAccount(accountId, user.id))) return c.json({ error: "not_found" }, 404);
    const draft = await getDraft(c.req.param("id"), accountId);
    if (!draft) return c.json({ error: "not_found" }, 404);

    const profile = await getAccountProfile(accountId);
    if (!profile || profile.status !== "ready" || !profile.brandBrief) {
      return c.json({ error: "no_profile" }, 400);
    }
    const { topic } = await c.req.json<{ topic?: string }>().catch(() => ({ topic: undefined }));
    const text = await draftPost(profile.brandBrief, { topic, noGos: profile.noGos, toneWords: profile.toneWords });
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
