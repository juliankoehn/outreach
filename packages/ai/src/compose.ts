import { generateText, generateImage as genImage, type LanguageModel, type ImageModel } from "ai";
import { openai } from "@ai-sdk/openai";
import { getTextModel } from "./provider.js";

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

export function getImageModel(): ImageModel {
  const provider = process.env.AI_PROVIDER ?? "openai";
  if (provider !== "openai") throw new Error(`Image generation supports only openai (got ${provider}).`);
  return openai.image(process.env.AI_IMAGE_MODEL ?? "gpt-image-1");
}

// LinkedIn-friendly output dimensions. Portrait is the feed default (takes the
// most vertical space on mobile); square/landscape are opt-in.
const SIZE_MAP = { portrait: "1024x1536", square: "1024x1024", landscape: "1536x1024" } as const;

export async function generateImage(
  prompt: string,
  opts?: {
    model?: ImageModel;
    postText?: string;
    visualStyle?: string;
    size?: "portrait" | "square" | "landscape";
    referenceHint?: string;
  },
): Promise<{ base64: string; mediaType: string }> {
  const model = opts?.model ?? getImageModel();
  // Give the image model the post it accompanies (so the visual is on-topic) and
  // the creator's learned visual language (so it looks like their brand).
  const parts: string[] = [];
  if (opts?.postText) {
    parts.push(
      `Create an image to accompany this LinkedIn post. Make it visually relevant to the post's message; no text or captions in the image unless asked.\n\nLinkedIn post:\n"""${opts.postText}"""`,
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
  parts.push(`Image direction: ${prompt}`);
  const fullPrompt = parts.length > 1 ? parts.join("\n\n") : prompt;
  const { image } = await genImage({ model, prompt: fullPrompt, size: SIZE_MAP[opts?.size ?? "portrait"] });
  return { base64: image.base64, mediaType: image.mediaType ?? "image/png" };
}
