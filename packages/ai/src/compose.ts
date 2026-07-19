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

// Distilled playbook from top LinkedIn creators — injected into every draft so
// posts follow what actually performs on the platform, in the creator's voice.
export const LINKEDIN_PLAYBOOK = `How top LinkedIn creators write (apply these, adapted to the creator's voice):
- Hook in the first line: a bold claim, a specific number, a contrarian take, or an open loop that stops the scroll. The first 1-2 lines are all a reader sees before "…more".
- One idea per post. Front-load the payoff; don't bury the lede.
- Short lines and generous whitespace — most sentences on their own line, no dense paragraphs.
- Write like you talk: plain words, "you", concrete specifics over abstractions and buzzwords.
- Tell it through a story, a lesson learned, or a small framework/list — people remember narratives and steps.
- No outbound links in the body (they suppress reach) and hashtags only if genuinely on-brand (0-3).
- End with a light CTA or a genuine question that invites comments.
- Be useful or be honest — earn the reader's attention, never clickbait a promise the post doesn't keep.
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
  return stripMarkdown(text);
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
  return stripMarkdown(text);
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
