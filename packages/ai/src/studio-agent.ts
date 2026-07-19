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

export interface StudioAgentHandlers {
  updatePost(text: string): Promise<void> | void;
  createImage(prompt: string): Promise<{ imageUrl: string }>;
  findSimilar(query: string): Promise<SimilarPostMatch[]>;
}

export interface StudioAgentOptions {
  messages: UIMessage[];
  brandBrief?: string;
  // A short summary of what the analysis of the creator's past posts found
  // (voice, themes, what drives engagement). Grounds generation in reality.
  insights?: string;
  currentText: string;
  handlers: StudioAgentHandlers;
  model?: LanguageModel;
  // Called once the turn finishes with the full updated message list, so the
  // caller can persist the conversation.
  onFinish?: (messages: UIMessage[]) => void;
}

function studioSystem(brandBrief: string | undefined, currentText: string, insights?: string): string {
  const brief = brandBrief?.trim()
    ? brandBrief.trim()
    : "No creator profile is set yet, so infer a professional, credible LinkedIn voice from the conversation.";
  const draft = currentText.trim()
    ? `The canvas currently holds this draft:\n"""${currentText.trim()}"""`
    : "The canvas is empty — there is no draft yet.";
  const learned = insights?.trim()
    ? `\nWHAT ACTUALLY WORKS FOR THIS CREATOR (learned from analysing their past posts — lean on this)\n${insights.trim()}\n`
    : "";

  return `You are the creator's LinkedIn writing partner inside a studio. You work on a single post that lives on a canvas to the right of this chat.

CREATOR BRAND BRIEF
${brief}
${learned}
${LINKEDIN_PLAYBOOK}

HOW YOU WORK
- The canvas is the source of truth for the post. The chat is where you and the creator talk about it.
- Before writing a brand-new post on a topic, call "findSimilarPosts" to check whether the creator has already posted something similar. If a close match exists, tell them and offer a fresh angle instead of repeating it.
- Whenever you write or revise the post, you MUST call the "updatePost" tool with the FULL post text. Never paste the post into the chat instead — the creator reads it on the canvas.
- When the creator asks for a visual, an image, or a graphic, call "generateImage" with a concrete visual direction.
- After a tool call, reply in chat with a short, warm sentence about what you changed and why — not the post text itself. Match the creator's language.
- One idea per post. Keep the creator's authentic voice. Don't invent facts about them; if you need a detail, ask.

${draft}`;
}

export async function streamStudioAgent(opts: StudioAgentOptions): Promise<Response> {
  const result = streamText({
    model: opts.model ?? getTextModel(),
    system: studioSystem(opts.brandBrief, opts.currentText, opts.insights),
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
    },
  });

  return result.toUIMessageStreamResponse({
    originalMessages: opts.messages,
    onFinish: ({ messages }) => opts.onFinish?.(messages),
  });
}
