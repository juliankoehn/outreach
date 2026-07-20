import { generateText, generateObject, generateImage as genImage, type LanguageModel, type ImageModel } from "ai";
import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";
import { z } from "zod";
import { getTextModel } from "./provider.js";

export type ImageProviderId = "openai" | "google";

// The image models a user can pick from (when the provider's API key is set).
// `envKey` is the env var whose presence marks the provider "enabled".
export const IMAGE_PROVIDERS: ReadonlyArray<{
  id: ImageProviderId;
  model: string;
  label: string;
  envKey: string;
}> = [
  { id: "openai", model: "gpt-image-2", label: "OpenAI · gpt-image-2", envKey: "OPENAI_API_KEY" },
  { id: "google", model: "gemini-3.1-flash-image", label: "Google · Nano Banana", envKey: "GOOGLE_GENERATIVE_AI_API_KEY" },
];

// The image providers the operator has enabled — those whose API key is present
// in the environment. The UI only offers these; server code only honours these.
export function enabledImageProviders(): Array<{ id: ImageProviderId; label: string }> {
  return IMAGE_PROVIDERS.filter((p) => !!process.env[p.envKey]).map((p) => ({ id: p.id, label: p.label }));
}

// True when `id` is a provider the operator has enabled (a real, keyed provider).
export function isImageProviderEnabled(id: string | null | undefined): id is ImageProviderId {
  return !!id && enabledImageProviders().some((p) => p.id === id);
}

const GOOGLE_ASPECT = { portrait: "4:5", square: "1:1", landscape: "16:9" } as const;

// Google Gemini image models (Nano Banana) return images via generateText's
// `files`, not the image() interface — a different code path from OpenAI.
async function generateImageGoogle(
  prompt: string,
  size: "portrait" | "square" | "landscape",
  model?: string,
): Promise<{ base64: string; mediaType: string }> {
  const { files } = await generateText({
    model: google(model ?? process.env.AI_IMAGE_MODEL_GOOGLE ?? "gemini-3.1-flash-image"),
    providerOptions: {
      google: {
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio: GOOGLE_ASPECT[size], imageOutputOptions: { mimeType: "image/png" } },
      },
    },
    prompt,
  });
  const img = files.find((f) => f.mediaType?.startsWith("image/"));
  if (!img) throw new Error("Gemini returned no image");
  return { base64: img.base64, mediaType: img.mediaType };
}

// LinkedIn renders plain text — Markdown would show its raw symbols. The prompt
// asks for plain text, but models slip (especially when fed Markdown context),
// so every post text is deterministically stripped of Markdown as a guarantee.
export function stripMarkdown(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```[^\n]*\n?/g, "").replace(/```/g, "")) // code fences → contents
    .replace(/^#{1,6}[ \t]+/gm, "") // # headings
    .replace(/^\s{0,3}>[ \t]?/gm, "") // > blockquotes
    .replace(/^\s*([*_-])\1{2,}\s*$/gm, "") // --- *** ___ horizontal rules
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // ![alt](url) → alt
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // [text](url) → text
    .replace(/(\*\*|__)(.*?)\1/g, "$2") // **bold** __bold__
    .replace(/(?<![*\w])(\*|_)(?!\s)(.+?)(?<!\s)\1(?![*\w])/g, "$2") // *italic* _italic_
    .replace(/`([^`]+)`/g, "$1") // `inline code`
    .replace(/^[ \t]*[*+][ \t]+/gm, "- ") // normalise -/*/+ bullets to a plain dash
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Deterministically enforce the mechanically-removable no-gos (the prompt asks,
// but models slip). Emojis and em/en-dashes can be stripped for real; semantic
// no-gos (buzzwords etc.) stay the prompt's job.
export function enforceNoGos(input: string, noGos?: string[]): string {
  if (!noGos?.length) return input;
  const lc = noGos.map((n) => n.toLowerCase());
  let out = input;
  if (lc.some((n) => n.includes("emoji"))) {
    out = out.replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}️‍]/gu, "");
  }
  if (lc.some((n) => n.includes("dash"))) {
    out = out.replace(/\s*[—–]\s*/g, " - "); // em/en-dash → spaced hyphen
  }
  return out
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

// Distilled playbook from top LinkedIn creators — injected into every draft so
// posts follow what actually performs on the platform, in the creator's voice.
export const LINKEDIN_PLAYBOOK = `How top LinkedIn creators write (apply these, adapted to the creator's voice):
- DELIVER REAL VALUE — this is the whole point of the post. Every post must give the reader ONE thing they can actually use or a genuinely fresh, non-obvious point of view: a concrete insight, a counter-intuitive lesson, a specific takeaway, a small actionable framework, or a sharp opinion backed by a reason. RUTHLESSLY avoid generic filler — "X is important", "stay vigilant", "the landscape is changing", "here's a new threat", "innovation brings challenges" — that says nothing. When writing from an article, find the ONE most surprising, specific, or actionable detail in it and build the post around THAT (a specific mechanism, number, tactic, or consequence), not a vague summary. A reader should finish thinking "huh, I didn't know that" or "I'm going to do that". If you genuinely have nothing specific to say, ask the creator for their angle instead of shipping fluff.
- NO CORPORATE BLOAT — this is a hard ban, not a preference. Never write hollow, self-important filler or fake-profound contrast constructions. BANNED patterns (do not write these or anything like them): pompous signposts ("Ein entscheidender Punkt:", "Doch der wahre Schutz liegt in …", "Hier liegt unser strategischer Vorteil", "In der heutigen Zeit", "Es ist wichtig zu verstehen, dass"); grand empty abstractions ("strategischer Vorteil", "ganzheitlicher Ansatz", "nachhaltige Lösung", "in einer Welt, in der …"); and empty "nicht X, sondern Y" reveals that state nothing concrete. Litmus test: if a sentence would fit, unchanged, in ANY company's post on ANY topic, DELETE it — it carries zero information. Replace it with one concrete, checkable statement (a number, a name, a mechanism, a real consequence). Write like a sharp person talking to a peer over coffee, never like a press release or a keynote.
- Hook in the first line: a bold claim, a specific number, a contrarian take, or an open loop that stops the scroll. The first 1-2 lines are all a reader sees before "…more".
- One idea per post. Front-load the payoff; don't bury the lede.
- Short lines and generous whitespace — most sentences on their own line, no dense paragraphs.
- Write like you talk: plain words, "you", concrete specifics over abstractions and buzzwords.
- Tell it through a story, a lesson learned, or a small framework/list — people remember narratives and steps.
- No outbound links in the body (they suppress reach) and hashtags only if genuinely on-brand (0-3).
- End with a light CTA or a genuine question that invites comments.
- Be useful or be honest — earn the reader's attention, never clickbait a promise the post doesn't keep.
- MATCH THE BRAND BRIEF'S REGISTER EXACTLY. If the brief is written informally (German "du" / first-name, casual English), address the reader that way too — never switch to formal "Sie". If the brief is formal ("Sie"), stay formal. When the brief uses "du", the post MUST use "du" and its forms (dein/dir/dich), never "Sie/Ihr/Ihnen". This is not optional.
- Write PLAIN TEXT, never Markdown — LinkedIn renders it literally, so it would show the raw symbols. No **bold**, no ##/# headings, no backticks, no [label](url) links, no Markdown bullet/numbered lists (\`-\`, \`*\`, \`1.\`). Use plain line breaks, and if a list genuinely helps, plain characters (a dash typed as part of the sentence, • , or an emoji) — not Markdown syntax.`;

const POST_INSTRUCTIONS = `Write a single LinkedIn post in the creator's authentic voice, following the brand brief exactly. Output only the post text as PLAIN TEXT (no Markdown formatting) — no preamble, no surrounding quotes.`;

// The creator's explicit no-gos, rendered as hard rules. Kept identical to the
// studio agent's phrasing so both paths honour "no emojis / no em-dashes" etc.
function noGoBlock(noGos?: string[], toneWords?: string[]): string {
  const tone = toneWords?.length ? `\n\nVOICE & TONE — write in exactly this register: ${toneWords.join(", ")}.` : "";
  if (!noGos?.length) return tone;
  return `${tone}\n\nHARD NO-GOS — never violate ANY of these, no exceptions:\n${noGos
    .map((n) => `- ${n}`)
    .join("\n")}\nRead them literally: "Emojis" → ZERO emoji; "Em-Dashes" → no "—"; "Buzzwords"/"Füllwörter" → plain, specific words only.`;
}

export async function draftPost(
  brandBrief: string,
  opts?: { topic?: string; model?: LanguageModel; noGos?: string[]; toneWords?: string[] },
): Promise<string> {
  const model = opts?.model ?? getTextModel();
  const { text } = await generateText({
    model,
    system: `${brandBrief}${noGoBlock(opts?.noGos, opts?.toneWords)}\n\n${LINKEDIN_PLAYBOOK}\n\n${POST_INSTRUCTIONS}`,
    prompt: opts?.topic ? `Topic / angle: ${opts.topic}` : "Write a strong post on one of the creator's core pillars.",
  });
  return enforceNoGos(stripMarkdown(text), opts?.noGos);
}

export async function refinePost(
  brandBrief: string,
  currentText: string,
  instruction: string,
  opts?: { model?: LanguageModel; noGos?: string[]; toneWords?: string[] },
): Promise<string> {
  const model = opts?.model ?? getTextModel();
  const { text } = await generateText({
    model,
    system: `${brandBrief}${noGoBlock(opts?.noGos, opts?.toneWords)}\n\n${LINKEDIN_PLAYBOOK}\n\nYou are revising an existing LinkedIn post draft in the creator's voice, per the user's instruction. Keep what already works; change only what the instruction asks. Output only the revised post text — no preamble, no surrounding quotes.`,
    prompt: `Current draft:\n"""${currentText}"""\n\nInstruction: ${instruction}`,
  });
  return enforceNoGos(stripMarkdown(text), opts?.noGos);
}

const REVIEW_SCHEMA = z.object({
  verdict: z.enum(["pass", "revise"]).describe("'pass' if the post clears the bar; 'revise' if it has defects the writer must fix."),
  issues: z
    .array(z.string())
    .describe("Concrete, actionable defects for the writer to fix, each a short phrase (quote the offending text when useful), written in the SAME language as the draft post. Empty when verdict is 'pass'."),
});

export interface PostReview {
  verdict: "pass" | "revise";
  issues: string[];
}

// The REVIEWER role in the writer↔reviewer loop. A strict LinkedIn editor that
// only JUDGES — it does not rewrite. It checks the draft against the brand
// brief, hard no-gos, tone, the playbook, on-topic-ness (when drafted from an
// article), plain-text, and above all bans corporate bloat / generic filler,
// and returns a verdict plus a concrete list of defects for the writer to fix.
export async function reviewPost(opts: {
  text: string;
  brandBrief?: string;
  noGos?: string[];
  toneWords?: string[];
  // Title + excerpt of the source article, when the post was drafted from one —
  // lets the reviewer catch off-topic drift.
  article?: string;
  model?: LanguageModel;
}): Promise<PostReview> {
  const text = opts.text.trim();
  if (!text) return { verdict: "pass", issues: [] };

  const brief = opts.brandBrief?.trim() ? `CREATOR BRAND BRIEF:\n${opts.brandBrief.trim()}` : "No brand brief provided.";
  const noGoLine = opts.noGos?.length ? `\nHARD NO-GOS (must not appear): ${opts.noGos.join("; ")}.` : "";
  const toneLine = opts.toneWords?.length ? `\nREQUIRED TONE/REGISTER: ${opts.toneWords.join(", ")}.` : "";
  const articleLine = opts.article?.trim()
    ? `\nThe post was drafted from THIS article and MUST stay on its topic (flag any drift into unrelated subjects):\n"""${opts.article.trim()}"""`
    : "";

  const { object } = await generateObject({
    model: opts.model ?? getTextModel(),
    schema: REVIEW_SCHEMA,
    system: `You are a ruthless LinkedIn editor gating a post before it reaches the creator's canvas. You do NOT rewrite — you judge and hand the writer a precise list of what to fix. Check the draft for these defects, in order:
1. CORPORATE BLOAT / generic filler — pompous signposts ("Ein entscheidender Punkt:", "Hier liegt unser strategischer Vorteil", "In der heutigen Zeit"), grand empty abstractions ("strategischer Vorteil", "ganzheitlicher Ansatz"), and hollow "nicht X, sondern Y" reveals. This is the top priority: any sentence that would fit unchanged in any company's post on any topic is a defect — name it and quote it.
2. NO REAL VALUE — the post gives the reader nothing specific to use or think. It must carry at least one concrete, checkable point (a number, a mechanism, a named tactic, a real consequence).
3. WRONG REGISTER — violates the required tone (e.g. uses formal "Sie" when "du" is required, or vice versa).
4. NO-GO VIOLATIONS — anything on the hard no-go list.
5. OFF-TOPIC — drifts away from the source article's subject (only when an article is given).
6. MARKDOWN — any Markdown syntax (LinkedIn renders plain text only).

Be strict but fair: if the post genuinely clears the bar, set verdict "pass" with empty "issues" — do NOT invent nitpicks to justify another round. Otherwise set verdict "revise" and list each concrete defect as a short, actionable instruction the writer can act on (quote the offending phrase where it helps).
LANGUAGE OF ISSUES: the ENTIRE text of every issue — the description, not just a quoted snippet — MUST be written in the SAME language as the draft post; these are shown to the creator in the UI. Do NOT use the English defect category names above ("Corporate Bloat", "No real value", etc.); describe the problem in the post's own language. For a German post, write fully German issues, e.g. "Corporate-Floskel: '…' sagt nichts Konkretes" or "Kein greifbarer Mehrwert — nenne eine konkrete Maßnahme".
${brief}${noGoLine}${toneLine}${articleLine}`,
    prompt: `Review this draft post:\n"""${text}"""`,
  });
  return object;
}

// The WRITER role in the writer↔reviewer loop. Given the current draft and the
// reviewer's list of defects, it rewrites the post in the creator's voice to
// fix EVERY listed defect while preserving the substance, angle, and voice.
// Reuses the same brand brief / no-go / tone / playbook framing as draftPost.
export async function rewriteForReview(opts: {
  text: string;
  issues: string[];
  brandBrief?: string;
  noGos?: string[];
  toneWords?: string[];
  article?: string;
  model?: LanguageModel;
}): Promise<string> {
  const model = opts.model ?? getTextModel();
  const brief = opts.brandBrief?.trim() ?? "Infer a professional, credible LinkedIn voice.";
  const articleLine = opts.article?.trim()
    ? `\n\nThe post is based on THIS article and must stay on its topic:\n"""${opts.article.trim()}"""`
    : "";
  const issueList = opts.issues.length ? opts.issues.map((i) => `- ${i}`).join("\n") : "- Tighten and sharpen the post.";
  const { text } = await generateText({
    model,
    system: `${brief}${noGoBlock(opts.noGos, opts.toneWords)}\n\n${LINKEDIN_PLAYBOOK}\n\nYou are the writer revising your own LinkedIn post after a strict editor flagged problems. Fix EVERY flagged problem while keeping the post's substance, angle, and authentic voice — do not blandify, do not drop real content, do not add new claims. Output only the revised post as PLAIN TEXT — no preamble, no surrounding quotes.${articleLine}`,
    prompt: `Current draft:\n"""${opts.text.trim()}"""\n\nThe editor flagged these problems — fix all of them:\n${issueList}`,
  });
  return enforceNoGos(stripMarkdown(text), opts.noGos);
}

export function getImageModel(): ImageModel {
  const provider = process.env.AI_PROVIDER ?? "openai";
  if (provider !== "openai") throw new Error(`Image generation supports only openai (got ${provider}).`);
  // gpt-image-2 is markedly more photorealistic / less "AI-render" than
  // gpt-image-1 for the same brief. Override via AI_IMAGE_MODEL.
  return openai.image(process.env.AI_IMAGE_MODEL ?? "gpt-image-2");
}

// LinkedIn-friendly output dimensions. Portrait is the feed default (takes the
// most vertical space on mobile); square/landscape are opt-in.
const SIZE_MAP = { portrait: "1024x1536", square: "1024x1024", landscape: "1536x1024" } as const;

// Steers image generation away from the tell-tale "AI slop" look toward what a
// tasteful creator would actually post on LinkedIn. Shared by the art-director
// brief step and the raw renderer.
const IMAGE_AESTHETIC =
  "AESTHETIC (this is the TOP priority, above cleverly illustrating the topic) — this runs on a real LinkedIn feed and must look like a real photo or a tasteful editorial illustration, NOT AI-generated concept art. It must read as a believable REAL-WORLD scene: real people, real workplaces, real objects, natural light. HARD BAN, no exceptions even for security/tech topics: glowing or holographic padlocks, locks, keyholes, shields, fortresses, or any floating security icon; neon circuit boards; futuristic sci-fi cityscapes; holograms or HUD overlays; glossy 3D-render blobs; hexagon grids or honeycomb patterns; robot hands; binary-code rain; over-saturated 'digital tech' collages; and any abstract 'technology/innovation' visual metaphor. Do NOT illustrate an abstract concept as a glowing symbol — show a concrete real scene instead (e.g. for security: a person at a workstation, a real data-center aisle, an office at night — never a glowing lock). Restrained natural palette, real lighting, understated over flashy. Render NO readable text, words, labels, or logos anywhere (image models garble them); any screens or signage stay unlabeled/illegible.";

// The canonical preset ids (tuple form for z.enum / exhaustive typing).
export const VISUAL_PRESET_IDS = ["natural", "editorial", "minimal", "monochrome", "analog"] as const;
export type VisualPresetId = (typeof VISUAL_PRESET_IDS)[number];

// User-selectable image "look" presets. Each id maps to a strong, concrete
// prompt fragment that pushes generation toward a natural, believable photo and
// away from the glossy AI-render look. The web owns localized labels keyed by id;
// this is the server-side source of truth for the actual prompt wording.
export const VISUAL_PRESETS: ReadonlyArray<{ id: VisualPresetId; prompt: string }> = [
  {
    id: "natural",
    prompt:
      "candid documentary photography shot on a real 35mm lens, natural available light, muted realistic colours, subtle film grain, unstaged real-world moments — never glossy or over-produced",
  },
  {
    id: "editorial",
    prompt:
      "clean editorial magazine photography, deliberate composition, natural light, restrained and polished but unmistakably real, no synthetic gloss or 3D-render sheen",
  },
  {
    id: "minimal",
    prompt:
      "minimalist composition with generous negative space, a single real subject, soft natural daylight, calm muted palette",
  },
  {
    id: "monochrome",
    prompt: "black-and-white documentary photography, natural film grain, real light and shadow, no colour",
  },
  {
    id: "analog",
    prompt: "shot on 35mm analog film, visible grain, slightly faded natural colours, imperfect real-world framing",
  },
];

// Resolve a preset id to its prompt fragment; unknown/empty id → "".
export function visualPresetPrompt(id: string | null | undefined): string {
  return VISUAL_PRESETS.find((p) => p.id === id)?.prompt ?? "";
}

// Build the combined visual directive fed to image generation. The creator's
// manual setting (preset + free-text refinement) leads and is the priority; the
// auto-derived style from past posts is appended as secondary context that must
// not override the explicit choice. Returns "" when nothing is set.
export function composeVisualLanguage(opts: {
  preset?: string | null;
  direction?: string | null;
  derived?: string | null;
}): string {
  const manualParts: string[] = [];
  const presetPrompt = visualPresetPrompt(opts.preset);
  if (presetPrompt) manualParts.push(presetPrompt);
  if (opts.direction?.trim()) manualParts.push(opts.direction.trim());
  const manual = manualParts.join("; ");
  const derived = opts.derived?.trim() ?? "";
  if (manual && derived) {
    return `${manual} (this look takes priority). Established style cues from past posts, secondary and only where they don't conflict: ${derived}`;
  }
  return manual || derived;
}

export async function generateImage(
  prompt: string,
  opts?: {
    model?: ImageModel;
    // Which image provider/model to use. Defaults to AI_IMAGE_PROVIDER env, or
    // "openai". A test that passes an explicit `model` implies the openai path.
    provider?: ImageProviderId;
    googleModel?: string;
    postText?: string;
    // The source article the post is based on — so the visual depicts the
    // article's actual subject, not a generic stock image.
    articleContext?: string;
    visualStyle?: string;
    size?: "portrait" | "square" | "landscape";
    referenceHint?: string;
  },
): Promise<{ base64: string; mediaType: string }> {
  // Give the image model the post it accompanies (so the visual is on-topic) and
  // the creator's learned visual language (so it looks like their brand).
  const parts: string[] = [];
  if (opts?.postText) {
    parts.push(
      `Create an image to accompany this LinkedIn post. Make it visually relevant to the post's message; no text or captions in the image unless asked.\n\nLinkedIn post:\n"""${opts.postText}"""`,
    );
  }
  if (opts?.articleContext?.trim()) {
    parts.push(
      `This post is about the following article — the image MUST clearly and specifically depict THIS subject (its concrete concepts, setting, or metaphor), not a generic stock visual:\n"""${opts.articleContext.trim()}"""`,
    );
  }
  if (opts?.visualStyle?.trim()) {
    parts.push(`Match this creator's established visual language: ${opts.visualStyle.trim()}`);
  }
  if (opts?.referenceHint?.trim()) {
    parts.push(
      `If a person appears, resemble this reference (style/subject guidance, not an exact likeness): ${opts.referenceHint.trim()}`,
    );
  }
  parts.push(IMAGE_AESTHETIC);
  parts.push(`Image direction: ${prompt}`);
  const fullPrompt = parts.length > 1 ? parts.join("\n\n") : prompt;
  const size = opts?.size ?? "portrait";

  const provider: ImageProviderId =
    opts?.provider ?? (opts?.model ? "openai" : ((process.env.AI_IMAGE_PROVIDER as ImageProviderId) || "openai"));
  if (provider === "google") {
    return generateImageGoogle(fullPrompt, size, opts?.googleModel);
  }

  const model = opts?.model ?? getImageModel();
  const { image } = await genImage({ model, prompt: fullPrompt, size: SIZE_MAP[size] });
  return { base64: image.base64, mediaType: image.mediaType ?? "image/png" };
}

const FORMAT_HINT = {
  portrait: "a vertical 4:5 portrait frame (fills a mobile feed) — compose for tall framing",
  square: "a square 1:1 frame — compose with a centered, balanced subject",
  landscape: "a wide 16:9 landscape frame — compose horizontally",
} as const;

// Art-director step: image models write poor prompts for themselves, so we run a
// focused text step first that turns the post + source article + the creator's
// visual language into ONE concrete, on-topic image brief. The result is fed to
// generateImage as its direction, so feed-drafted posts get an image that
// actually depicts the article's subject rather than a generic stock visual.
const IMAGE_BRIEF_REVIEW_SCHEMA = z.object({
  verdict: z.enum(["pass", "revise"]).describe("'pass' if the brief is a believable real-world scene; 'revise' if it has AI-slop or readable text."),
  issues: z.array(z.string()).describe("Concrete slop/text problems for the art director to fix. Empty when verdict is 'pass'."),
});

// Guard on the image brief BEFORE it's rendered: a strict art director that
// rejects the tell-tale AI-slop / stock-cliché look (glowing symbols, holograms,
// hexagons, floating tech metaphors) and any readable text. Same judge→rewrite
// pattern as the post review loop, so images don't gamble on the prompt alone.
export async function reviewImageBrief(
  brief: string,
  opts?: { model?: LanguageModel },
): Promise<{ verdict: "pass" | "revise"; issues: string[] }> {
  const text = brief.trim();
  if (!text) return { verdict: "pass", issues: [] };
  const { object } = await generateObject({
    model: opts?.model ?? getTextModel(),
    schema: IMAGE_BRIEF_REVIEW_SCHEMA,
    system: `You are a strict art director gating an image brief before it is rendered for a LinkedIn post. REJECT it (verdict "revise") if it describes ANY of the AI-slop / stock cliché look: glowing or holographic symbols (padlocks, locks, keyholes, shields, fortresses), holograms or HUD overlays, neon circuit boards, hexagon/honeycomb grids, futuristic sci-fi cityscapes, robot hands, binary-code rain, floating abstract "technology/innovation" metaphors, an over-saturated synthetic "digital tech" look, OR any readable text, words, labels, or signage. PASS (verdict "pass", empty issues) only if it describes a believable real-world scene — real people, real places, real objects, natural light — with nothing meant to be read. List each concrete problem in "issues".`,
    prompt: `Image brief to check:\n"""${text}"""`,
  });
  return object;
}

export async function composeImageBrief(opts: {
  seed?: string; // the agent's / creator's rough visual idea, if any
  postText?: string;
  article?: string; // title + excerpt of the source article
  visualStyle?: string;
  referenceHint?: string;
  noGos?: string[];
  size?: "portrait" | "square" | "landscape";
  model?: LanguageModel;
}): Promise<string> {
  const model = opts.model ?? getTextModel();
  const ctx: string[] = [];
  if (opts.article?.trim()) ctx.push(`SOURCE ARTICLE (the image MUST depict THIS subject concretely):\n"""${opts.article.trim()}"""`);
  if (opts.postText?.trim()) ctx.push(`THE POST THE IMAGE ACCOMPANIES:\n"""${opts.postText.trim()}"""`);
  if (opts.visualStyle?.trim()) ctx.push(`THE CREATOR'S VISUAL LANGUAGE (match it): ${opts.visualStyle.trim()}`);
  if (opts.referenceHint?.trim()) ctx.push(`IF A PERSON APPEARS, resemble this reference (guidance, not exact likeness): ${opts.referenceHint.trim()}`);
  if (opts.seed?.trim()) ctx.push(`ROUGH IDEA FROM THE CREATOR (refine, don't just repeat): ${opts.seed.trim()}`);
  const noGoLine = opts.noGos?.length
    ? `\nHARD NO-GOS (obey literally): ${opts.noGos.join("; ")}.`
    : "";
  // Image models render any text as garbled nonsense, so the brief must never
  // ask for readable words — describe screens/maps/signage as unlabeled.
  const noTextLine =
    "\nNO READABLE TEXT: image generators turn text into garbled gibberish, so your brief must NOT describe any words, letters, labels, captions, headlines, signage, place/map names, logos, or on-screen UI copy. If screens, monitors, maps, or dashboards appear, describe them as abstract glowing graphics, unlabeled shapes, dot patterns, or softly blurred/illegible content — nothing meant to be read.";
  const system = `You are an art director for a professional LinkedIn creator. From the context, write ONE vivid, concrete image brief (2-4 sentences, English) for an image generator. Describe a specific scene, subject, composition, lighting, and mood that concretely represents the post's actual topic — never a generic abstract "technology" or "business" stock visual. It is for ${FORMAT_HINT[opts.size ?? "portrait"]}.\n${IMAGE_AESTHETIC}${noTextLine}${noGoLine}\nOutput only the brief, no preamble or quotes.`;
  const promptBase = ctx.join("\n\n") || "Write a strong, on-brand image brief for this creator's post.";

  const gen = async (extra?: string): Promise<string> => {
    const { text } = await generateText({ model, system, prompt: extra ? `${promptBase}\n\n${extra}` : promptBase });
    return text.trim();
  };

  // Judge→rewrite guard: prompt rules alone don't reliably keep image models off
  // the slop look, so we review the brief and rewrite it until it passes (or the
  // round budget runs out).
  const MAX_BRIEF_REVISIONS = 2;
  let brief = await gen();
  for (let i = 0; i < MAX_BRIEF_REVISIONS; i++) {
    const review = await reviewImageBrief(brief, { model });
    if (review.verdict === "pass") break;
    brief = await gen(
      `The previous brief was REJECTED for looking AI-generated / stock: ${review.issues.join("; ")}. Rewrite it as a believable real-world scene that fixes EVERY problem — no glowing or holographic symbols, no padlocks/shields/fortresses, no hexagons, no floating tech metaphors, no readable text. Show a concrete real scene instead.\nPrevious brief:\n"""${brief}"""`,
    );
  }
  return brief;
}
