import {
  streamText,
  convertToModelMessages,
  tool,
  stepCountIs,
  type LanguageModel,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { getTextModel } from "./provider.js";
import { LINKEDIN_PLAYBOOK } from "./compose.js";

// The side-effecting handlers the route wires in. The agent decides WHEN to
// call these; the route decides WHAT they do (persist to the draft, save the
// image file, keep the "current text" in sync for the image prompt).
export interface SimilarPostMatch {
  source: "published" | "draft";
  similarity: number;
  publishedAt: string;
  excerpt: string;
}

export interface KnowledgePassage {
  content: string;
  section: string | null;
  resourceName: string;
}

export interface StudioAgentHandlers {
  updatePost(text: string): Promise<void> | void;
  createImage(prompt: string): Promise<{ imageUrl: string }>;
  findSimilar(query: string): Promise<SimilarPostMatch[]>;
  searchKnowledge(query: string): Promise<KnowledgePassage[]>;
}

export interface StudioAgentOptions {
  messages: UIMessage[];
  brandBrief?: string;
  // The creator's tone/voice words, content pillars, and hard no-gos — the
  // structured profile the post MUST obey (no-gos especially, e.g. "no emojis").
  toneWords?: string[];
  pillars?: string[];
  noGos?: string[];
  // A short summary of what the analysis of the creator's past posts found
  // (voice, themes, what drives engagement). Grounds generation in reality.
  insights?: string;
  currentText: string;
  // When the draft was started from a Feed article — the full article (Markdown)
  // the creator wants to write their own take on.
  sourceArticle?: { title: string; url: string; content: string };
  handlers: StudioAgentHandlers;
  model?: LanguageModel;
  // Called once the turn finishes with the full updated message list, so the
  // caller can persist the conversation.
  onFinish?: (messages: UIMessage[]) => void;
}

interface StudioSystemInput {
  brandBrief?: string;
  currentText: string;
  insights?: string;
  toneWords?: string[];
  pillars?: string[];
  noGos?: string[];
  sourceArticle?: { title: string; url: string; content: string };
}

function studioSystem(input: StudioSystemInput): string {
  const brief = input.brandBrief?.trim()
    ? input.brandBrief.trim()
    : "No creator profile is set yet, so infer a professional, credible LinkedIn voice from the conversation.";
  const draft = input.currentText.trim()
    ? `The canvas currently holds this draft:\n"""${input.currentText.trim()}"""`
    : "The canvas is empty — there is no draft yet.";
  const learned = input.insights?.trim()
    ? `\nWHAT ACTUALLY WORKS FOR THIS CREATOR (learned from analysing their past posts — lean on this)\n${input.insights.trim()}\n`
    : "";
  const tone = input.toneWords?.length
    ? `\nVOICE & TONE — write in exactly this register, every time: ${input.toneWords.join(", ")}.`
    : "";
  const pillars = input.pillars?.length ? `\nCONTENT PILLARS (what this creator posts about): ${input.pillars.join(", ")}.` : "";
  const noGos = input.noGos?.length
    ? `\n\nHARD NO-GOS — the creator's explicit rules. NEVER violate ANY of these, in the post text OR the image, no exceptions:\n${input.noGos
        .map((n) => `- ${n}`)
        .join("\n")}\nRead them literally: "Emojis" → use ZERO emoji characters; "Em-Dashes" → no "—" characters; "Buzzwords"/"Füllwörter" → plain, specific words only. When in doubt, comply.`
    : "";

  const article = input.sourceArticle
    ? `\n\nSOURCE ARTICLE — the creator wants a LinkedIn post inspired by this article. Use it as the factual basis and write THEIR OWN take / point of view — do NOT summarise or rehash it, and do NOT copy its wording. It is given in Markdown for your reading only; the post itself is PLAIN TEXT with no Markdown.\nTitle: ${input.sourceArticle.title}\nURL: ${input.sourceArticle.url}\nArticle:\n"""${input.sourceArticle.content}"""`
    : "";

  return `You are the creator's LinkedIn writing partner inside a studio. You work on a single post that lives on a canvas to the right of this chat.

CREATOR BRAND BRIEF
${brief}${tone}${pillars}${noGos}
${learned}${article}
${LINKEDIN_PLAYBOOK}

HOW YOU WORK
- The canvas is the source of truth for the post. The chat is where you and the creator talk about it.
- Before writing a brand-new post on a topic, call "findSimilarPosts" to check whether the creator has already posted something similar. If a close match exists, tell them and offer a fresh angle instead of repeating it.
- Whenever you write or revise the post, you MUST call the "updatePost" tool with the FULL post text. Never paste the post into the chat instead — the creator reads it on the canvas.
- When the creator asks for a visual, an image, or a graphic, call "generateImage" with a concrete visual direction.
- After a tool call, reply in chat with ONE short, warm plain sentence about what you changed and why. In the chat, never write Markdown (no #, **, ◆, bullet lists, or outlines), never paste the post, and never list out its structure — just talk normally. Match the creator's language.
- One idea per post. Keep the creator's authentic voice. Don't invent facts about them; if you need a detail, ask.
- You can call searchKnowledge to pull passages from the creator's uploaded documents (norms, guidelines). When you use them, ground your writing on the retrieved passages — but NEVER put citations, source names, section numbers, or quotes-with-attribution in the post text itself. The post must read clean; the sources are shown to the user separately in the UI.

${draft}`;
}

export async function streamStudioAgent(opts: StudioAgentOptions): Promise<Response> {
  const result = streamText({
    model: opts.model ?? getTextModel(),
    system: studioSystem({
      brandBrief: opts.brandBrief,
      currentText: opts.currentText,
      insights: opts.insights,
      toneWords: opts.toneWords,
      pillars: opts.pillars,
      noGos: opts.noGos,
      sourceArticle: opts.sourceArticle,
    }),
    messages: await convertToModelMessages(opts.messages),
    stopWhen: stepCountIs(6),
    tools: {
      updatePost: tool({
        description:
          "Replace the LinkedIn post on the canvas with new text. Call this every time you write or revise the post. Pass the complete post, not a diff.",
        inputSchema: z.object({
          text: z.string().describe("The complete post text to show on the canvas."),
        }),
        execute: async ({ text }) => {
          await opts.handlers.updatePost(text);
          return { ok: true };
        },
      }),
      generateImage: tool({
        description:
          "Generate an image for the post and place it on the canvas. Use when the creator wants a visual.",
        inputSchema: z.object({
          prompt: z.string().describe("Concrete visual direction for the image (subject, style, mood)."),
        }),
        execute: async ({ prompt }) => {
          return await opts.handlers.createImage(prompt);
        },
      }),
      findSimilarPosts: tool({
        description:
          "Search the creator's already-published posts and existing drafts for content similar to a topic, to avoid duplicates. Call before writing a new post on a topic.",
        inputSchema: z.object({
          query: z.string().describe("The topic or a short summary of the post you're about to write."),
        }),
        execute: async ({ query }) => {
          const matches = await opts.handlers.findSimilar(query);
          return { matches, count: matches.length };
        },
      }),
      searchKnowledge: tool({
        description:
          "Search the creator's uploaded documents (norms, guidelines) for passages relevant to a query. Use to ground the post, but never cite sources in the post text — sources are shown to the user separately.",
        inputSchema: z.object({
          query: z.string().describe("What to search for in the creator's uploaded documents."),
        }),
        execute: async ({ query }) => opts.handlers.searchKnowledge(query),
      }),
    },
  });

  return result.toUIMessageStreamResponse({
    originalMessages: opts.messages,
    onFinish: ({ messages }) => opts.onFinish?.(messages),
  });
}
