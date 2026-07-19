// apps/api/src/routes/profile.ts
import { Hono } from "hono";
import {
  nextTurn,
  streamInterview,
  synthesizeProfile,
  refineProfile,
  analyzePosts,
  suggestFacets,
  streamProfileStudio,
  generateImage,
} from "@outreach/ai";
import type {
  ChatMessage,
  DerivedInsights,
  ProfileFacet,
  FacetKind,
  UIMessage,
  ProfilePatch,
  SynthesizedProfile,
} from "@outreach/ai";
import type { AppEnv } from "../app.js";
import { saveImage } from "../images.js";
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
  setInterviewMessages,
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
    const stored = iv.messages as unknown[];
    // Resume if the session already holds streaming UI messages.
    if (stored.length > 0 && isUiMessage(stored[0])) {
      return c.json({ messages: stored });
    }
    // Otherwise generate the opener as an assistant UI message.
    const derived = profile.derived as unknown as DerivedInsights | undefined;
    const opener = await nextTurn([{ role: "user", content: "(start the interview)" }], {
      seed: derivedSeed(derived),
      language,
    });
    const openerMsg: UIMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      parts: [{ type: "text", text: opener }],
    };
    await setInterviewMessages(iv.id, [openerMsg]);
    return c.json({ messages: [openerMsg] });
  });

  // Streaming interview turn with the buildProfile tool. Mirrors the studio agent.
  r.post("/:id/interview/agent", async (c) => {
    const user = c.get("user")!;
    const id = c.req.param("id");
    const profile = await requireProfile(id, user.id);
    if (!profile) return c.json({ error: "not_found" }, 404);

    const { messages, locale } = await c.req
      .json<{ messages: UIMessage[]; locale?: string }>()
      .catch(() => ({ messages: [] as UIMessage[], locale: undefined }));
    const derived = profile.derived as unknown as DerivedInsights | undefined;
    const iv = await getOrCreateInterview(id);

    return streamInterview({
      messages,
      language: langName(locale),
      seed: derivedSeed(derived),
      handlers: {
        buildProfile: async () => {
          const synth = await synthesizeProfile(uiToChat(messages), { derived });
          await updateProfileById(id, user.id, { ...synth, status: "ready" });
          await completeInterview(iv.id);
        },
      },
      onFinish: (final) => {
        void setInterviewMessages(iv.id, final);
      },
    });
  });

  // Streaming Profile Studio: the AI leads a profile-building conversation and
  // is the single writer of profile fields via the updateProfile tool
  // (proposeConfirm/proposeOptions/writeExamplePost are UI-only). Mirrors the
  // studio agent's shape (see routes/studio.ts, drafts/:id/agent).
  r.post("/:id/studio", async (c) => {
    const user = c.get("user")!;
    const id = c.req.param("id");
    const profile = await requireProfile(id, user.id);
    if (!profile) return c.json({ error: "not_found" }, 404);

    const { messages, locale } = await c.req
      .json<{ messages: UIMessage[]; locale?: string }>()
      .catch(() => ({ messages: [] as UIMessage[], locale: undefined }));
    const derived = profile.derived as unknown as DerivedInsights | null | undefined;
    const iv = await getOrCreateInterview(id);

    const insights = derived
      ? `Voice: ${derived.voiceSummary} Recurring themes: ${derived.themes.join(", ")}. Style traits: ${derived.styleTraits.join(", ")}. What drives engagement: ${derived.topPatterns.join("; ")}.`
      : undefined;

    const current: ProfilePatch = {
      toneWords: profile.toneWords,
      pillars: profile.pillars,
      audience: profile.audience || undefined,
      positioning: profile.positioning || undefined,
      noGos: profile.noGos,
      brandBrief: profile.brandBrief || undefined,
      visualStyle: derived?.visualStyle,
    };

    // In-memory accumulator (like the studio's currentText): each updateProfile
    // call merges into this shared object synchronously — avoids the read-modify-
    // write race when the AI fires several updateProfile calls in one turn.
    const acc = {
      toneWords: [...profile.toneWords],
      pillars: [...profile.pillars],
      noGos: [...profile.noGos],
      brandBrief: profile.brandBrief,
      audience: profile.audience,
      positioning: profile.positioning,
    };
    const mergeInto = (arr: string[], values?: string[]) => {
      for (const v of values ?? []) {
        const val = v.trim();
        if (val && !arr.some((x) => x.toLowerCase() === val.toLowerCase())) arr.push(val);
      }
    };

    return streamProfileStudio({
      messages,
      current,
      insights,
      language: langName(locale),
      handlers: {
        // The CreatorProfile row has no `voice`/`visualStyle` column. Mapping
        // decisions (documented per the plan's Global Constraints):
        // - patch.voice folds into toneWords as an extra descriptive entry
        //   (merged case-insensitively) — there's no dedicated column, and a
        //   voice description is itself a tone signal.
        // - patch.visualStyle is appended to brandBrief as a "Visual: …"
        //   note, mirroring the existing convention in POST /:id/facets.
        // - toneWords/pillars/noGos MERGE with the current values (dedupe,
        //   case-insensitive) instead of replacing — the AI sends
        //   incremental patches turn by turn, not full snapshots.
        // - audience/positioning/brandBrief replace outright — they're prose
        //   fields the AI (re)writes wholesale once it updates them.
        updateProfile: async (patch: ProfilePatch) => {
          // Merge synchronously into the accumulator (no await before the merge,
          // so concurrent calls can't interleave mid-merge).
          mergeInto(acc.toneWords, patch.toneWords);
          mergeInto(acc.pillars, patch.pillars);
          mergeInto(acc.noGos, patch.noGos);
          if (patch.brandBrief !== undefined) acc.brandBrief = patch.brandBrief;
          // `voice` is a prose description (not a short chip) → brand-brief note.
          const addNote = (label: string, value?: string) => {
            if (!value?.trim()) return;
            const note = `${label}: ${value.trim()}`;
            if (!acc.brandBrief.includes(note)) acc.brandBrief = acc.brandBrief ? `${acc.brandBrief}\n\n${note}` : note;
          };
          addNote("Voice", patch.voice);
          addNote("Visual", patch.visualStyle);
          if (patch.audience !== undefined) acc.audience = patch.audience;
          if (patch.positioning !== undefined) acc.positioning = patch.positioning;

          const update: Partial<SynthesizedProfile> = {
            toneWords: [...acc.toneWords],
            pillars: [...acc.pillars],
            noGos: [...acc.noGos],
            brandBrief: acc.brandBrief,
            audience: acc.audience,
            positioning: acc.positioning,
          };
          await updateProfileById(id, user.id, update);
        },
        // Reuse the draft studio's image pipeline: generate a visual for the
        // example post in the creator's visual style, persist it, hand back a
        // servable URL for the canvas preview.
        createExampleImage: async ({ postText, direction }) => {
          const { base64, mediaType } = await generateImage(
            direction ?? "A clean, on-brand visual that fits this post.",
            { postText, visualStyle: derived?.visualStyle },
          );
          const { url } = await saveImage(base64, mediaType);
          return { imageUrl: url };
        },
      },
      onFinish: (finalMessages) => {
        void setInterviewMessages(iv.id, finalMessages);
      },
    });
  });

  // Manual fallback: build the profile from the conversation on demand.
  r.post("/:id/interview/finalize", async (c) => {
    const user = c.get("user")!;
    const id = c.req.param("id");
    const profile = await requireProfile(id, user.id);
    if (!profile) return c.json({ error: "not_found" }, 404);

    const iv = await getOrCreateInterview(id);
    const derived = profile.derived as unknown as DerivedInsights | undefined;
    const synthesized = await synthesizeProfile(uiToChat(iv.messages as unknown[]), { derived });
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
        mediaType: p.mediaType,
        imageUrl: p.imageUrl,
        metrics: p.metrics as { impressions?: number; reactions?: number; comments?: number } | null,
      })),
    );
    await updateProfileById(id, user.id, { derived, derivedAt: new Date() });
    return c.json({ derived });
  });

  // Refine the profile from its analysis — folds voice, visual style, themes and
  // what performs back into the editable fields + brandBrief. Needs a prior analyze.
  r.post("/:id/refine", async (c) => {
    const user = c.get("user")!;
    const id = c.req.param("id");
    const profile = await requireProfile(id, user.id);
    if (!profile) return c.json({ error: "not_found" }, 404);

    const derived = profile.derived as unknown as DerivedInsights | null | undefined;
    if (!derived) return c.json({ error: "no_analysis" }, 409);

    const current = {
      goals: profile.goals,
      audience: profile.audience,
      pillars: profile.pillars,
      noGos: profile.noGos,
      toneWords: profile.toneWords,
      languages: profile.languages,
      positioning: profile.positioning,
      brandBrief: profile.brandBrief,
    };
    const refined = await refineProfile(current, derived);
    const updated = await updateProfileById(id, user.id, refined);
    return c.json({ profile: updated });
  });

  // Fine-tuning: suggest discrete facets the creator accepts/rejects.
  r.post("/:id/suggest", async (c) => {
    const user = c.get("user")!;
    const id = c.req.param("id");
    const profile = await requireProfile(id, user.id);
    if (!profile) return c.json({ error: "not_found" }, 404);

    const derived = profile.derived as unknown as DerivedInsights | null | undefined;
    const exclude = [...profile.toneWords, ...profile.pillars, ...profile.noGos];
    const facets = await suggestFacets({
      profile: {
        audience: profile.audience,
        positioning: profile.positioning,
        pillars: profile.pillars,
        toneWords: profile.toneWords,
        noGos: profile.noGos,
        brandBrief: profile.brandBrief,
      },
      derived,
      exclude,
    });
    return c.json({ facets });
  });

  // Apply the creator's decisions. Accepted facets merge into the matching
  // field; rejected ones go to noGos so they're never suggested again and the
  // ghostwriter avoids them.
  r.post("/:id/facets", async (c) => {
    const user = c.get("user")!;
    const id = c.req.param("id");
    const profile = await requireProfile(id, user.id);
    if (!profile) return c.json({ error: "not_found" }, 404);

    const body = await c.req
      .json<{ accepted?: ProfileFacet[]; rejected?: ProfileFacet[] }>()
      .catch(() => ({}) as { accepted?: ProfileFacet[]; rejected?: ProfileFacet[] });
    const accepted = (body.accepted ?? []).filter(isFacet);
    const rejected = (body.rejected ?? []).filter(isFacet);

    const toneWords = [...profile.toneWords];
    const pillars = [...profile.pillars];
    const noGos = [...profile.noGos];
    const briefAdds: string[] = [];

    const add = (arr: string[], v: string) => {
      const val = v.trim();
      if (val && !arr.some((x) => x.toLowerCase() === val.toLowerCase())) arr.push(val);
    };

    for (const f of accepted) {
      if (f.kind === "tone") add(toneWords, f.value);
      else if (f.kind === "pillar") add(pillars, f.value);
      else if (f.kind === "dont") add(noGos, f.value);
      else if (f.kind === "do") briefAdds.push(`Do: ${f.value.trim()}`);
      else if (f.kind === "visual") briefAdds.push(`Visual: ${f.value.trim()}`);
    }
    // Rejections become negative signals (and are thus excluded from future suggestions).
    for (const f of rejected) add(noGos, f.value);

    const brandBrief = briefAdds.length > 0 ? `${profile.brandBrief}\n\n${briefAdds.join("\n")}`.trim() : profile.brandBrief;
    const updated = await updateProfileById(id, user.id, { toneWords, pillars, noGos, brandBrief });
    return c.json({ profile: updated });
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

function isUiMessage(m: unknown): boolean {
  return !!m && typeof m === "object" && Array.isArray((m as { parts?: unknown }).parts);
}

// Flatten AI-SDK UI messages (or legacy {role,content}) into interview transcript.
function uiToChat(messages: unknown[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of messages) {
    const mm = m as { role?: string; content?: string; parts?: Array<{ type?: string; text?: string }> };
    if (mm.role !== "user" && mm.role !== "assistant") continue;
    let text = "";
    if (Array.isArray(mm.parts)) {
      text = mm.parts.filter((p) => p.type === "text").map((p) => p.text ?? "").join("").trim();
    } else if (typeof mm.content === "string") {
      text = mm.content.trim();
    }
    if (text) out.push({ role: mm.role, content: text });
  }
  return out;
}

const FACET_KIND_SET = new Set<FacetKind>(["tone", "pillar", "visual", "do", "dont"]);
function isFacet(f: unknown): f is ProfileFacet {
  if (!f || typeof f !== "object") return false;
  const v = (f as ProfileFacet).value;
  return typeof v === "string" && v.trim().length > 0 && FACET_KIND_SET.has((f as ProfileFacet).kind);
}

const LANGUAGES: Record<string, string> = { en: "English", de: "German" };
function langName(locale?: string): string | undefined {
  return locale ? (LANGUAGES[locale] ?? locale) : undefined;
}

function derivedSeed(derived?: DerivedInsights): string | undefined {
  if (!derived) return undefined;
  return `Voice: ${derived.voiceSummary}. Themes: ${derived.themes.join(", ")}. What performs: ${derived.topPatterns.join("; ")}.`;
}
