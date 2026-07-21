import {
  streamText,
  convertToModelMessages,
  tool,
  stepCountIs,
  generateId,
  toUIMessageStream,
  createUIMessageStreamResponse,
  type LanguageModel,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { getTextModel } from "./provider.js";
import { LINKEDIN_PLAYBOOK, reviewPost, rewriteForReview, stripMarkdown, enforceNoGos, currentDateNote } from "./compose.js";

// How many writer↔reviewer rounds the review loop runs before shipping.
const MAX_REWRITES = 2;

// A progress frame the updatePost tool streams as it runs the writer↔reviewer
// loop. Each frame carries the current candidate text (the canvas types through
// them live) plus what the reviewer is doing this round.
export interface ReviewLoopFrame {
  phase: "reviewing" | "revising" | "done";
  round: number; // completed rewrite rounds so far
  issues: string[]; // cumulative defects the reviewer flagged
  text: string; // current candidate post text (canvas mirrors this)
  done: boolean;
}

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
  // Persists the final, reviewed post to the canvas/draft. The writer↔reviewer
  // loop now runs inside the updatePost tool (so it can stream progress); this
  // handler only persists the text the loop settled on.
  updatePost(finalText: string): Promise<void>;
  createImage(prompt: string): Promise<{ imageUrl: string }>;
  findSimilar(query: string): Promise<SimilarPostMatch[]>;
  searchKnowledge(query: string): Promise<KnowledgePassage[]>;
  // Persist a lasting rule to the creator's profile (a thing to always avoid, or
  // a tone/register instruction). Called ONLY after the creator confirms. Returns
  // the updated lists so the agent can confirm what it saved.
  addProfileRule(
    rule: string,
    kind: "avoid" | "tone",
  ): Promise<{ noGos: string[]; toneWords: string[] }>;
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
    ? `\n\nSOURCE ARTICLE — this article is the PRIMARY SUBJECT of the post. The post is ABOUT this article and MUST stay on its topic. Use it as the factual basis and write the creator's OWN take / point of view on it — do NOT summarise or rehash it, and do NOT copy its wording. It is given in Markdown for your reading only; the post itself is PLAIN TEXT with no Markdown.\nHere, searchKnowledge is OPTIONAL and strictly supplementary: only pull in a passage if it DIRECTLY sharpens the creator's take on THIS article's topic. Never let the knowledge base introduce unrelated subjects or steer the post away from the article — if a retrieved passage is off-topic for this article, ignore it.\nTitle: ${input.sourceArticle.title}\nURL: ${input.sourceArticle.url}\nArticle:\n"""${input.sourceArticle.content}"""`
    : "";

  return `You are the creator's LinkedIn writing partner inside a studio. You work on a single post that lives on a canvas to the right of this chat.

=== THE MOST IMPORTANT RULE — HOW THE POST IS CREATED ===
The post lives ONLY on the canvas, and the ONLY way to put text there is the "updatePost" tool. Text you type in the chat is NOT the post — the creator never sees chat text as the post.
So, without exception:
- The moment you have post text (new or revised), your IMMEDIATE next action is to CALL updatePost with the COMPLETE post text. Not a preview, not an outline, not "here's a draft" — the actual tool call.
- NEVER write the post, or any part/outline/preview of it, in the chat.
- NEVER announce "I'll update the canvas" / "let me put this on the canvas" and then stop — that is a failure. Saying it is not doing it. Call the tool.
- Only AFTER updatePost has executed do you send a chat message, and it is ONE short plain sentence about what you changed (no post text, no Markdown).
If you are about to type post text into the chat: STOP and call updatePost instead.
- Every updatePost call runs an automatic writer↔reviewer loop before the post lands on the canvas. The tool streams its progress and the final result tells you how many rounds it took ("round": >0 means the reviewer forced rewrites) and what it fixed ("issues"). The canvas now holds the final REVIEWED version — treat that as final. If "round" > 0, mention it briefly and naturally in your chat sentence (e.g. "hab den Post noch entschlackt — Corporate-Floskeln raus"); never re-submit to undo the reviewer's fixes.

CREATOR BRAND BRIEF
${brief}${tone}${pillars}${noGos}
${learned}${article}
${LINKEDIN_PLAYBOOK}${currentDateNote()}

HOW YOU WORK
- The canvas is the source of truth for the post. The chat is where you and the creator talk about it.
- Before writing a brand-new post on a topic, call "findSimilarPosts" to check whether the creator has already posted something similar. If a close match exists, tell them and offer a fresh angle instead of repeating it.
- Every post write/revision goes through the updatePost tool (see THE MOST IMPORTANT RULE above). No exceptions.
- When the creator asks for a visual, an image, or a graphic, call "generateImage" with a concrete visual direction.
- After a tool call, reply in chat with ONE short, warm plain sentence about what you changed and why. In the chat, never write Markdown (no #, **, ◆, bullet lists, or outlines), never paste the post, and never list out its structure — just talk normally. Match the creator's language.
- One idea per post. Keep the creator's authentic voice. Don't invent facts about them; if you need a detail, ask.
- You can call searchKnowledge to pull passages from the creator's uploaded documents (norms, guidelines). When you use them, ground your writing on the retrieved passages — but NEVER put citations, source names, section numbers, or quotes-with-attribution in the post text itself. The post must read clean; the sources are shown to the user separately in the UI.
- LEARN FROM CRITICISM. When the creator criticises the writing in a way that should hold for EVERY future post — a register they hate (corporate filler, pompous phrasing), a word or construction to ban, a tone they want (e.g. always "du") — first fix it in the current post, then OFFER to make it permanent: ask, in one short sentence, something like "Soll ich das direkt ins Profil aufnehmen?". Only if they say yes, call addProfileRule ('avoid' for a no-go, 'tone' for a voice instruction). Never save a rule without that explicit yes, and don't offer for one-off, post-specific tweaks.

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
          "Replace the LinkedIn post on the canvas with new text. Call this every time you write or revise the post. Pass the complete post, not a diff. Your text then goes through an automatic editorial review loop before it lands.",
        inputSchema: z.object({
          text: z.string().describe("The complete post text to show on the canvas."),
        }),
        // Async generator: each yield streams a progress frame to the client
        // (the canvas types through the candidate text, the chat shows the
        // review rounds). The LAST yield is the final tool output.
        async *execute({ text }) {
          const articleCtx = opts.sourceArticle
            ? `${opts.sourceArticle.title}\n\n${opts.sourceArticle.content.slice(0, 600)}`
            : undefined;
          const reviewCtx = {
            brandBrief: opts.brandBrief,
            noGos: opts.noGos,
            toneWords: opts.toneWords,
            article: articleCtx,
            insights: opts.insights,
            model: opts.model,
          };

          let candidate = enforceNoGos(stripMarkdown(text), opts.noGos);
          const issues: string[] = [];
          let round = 0;
          // Put the writer's first draft on the canvas right away, then review.
          yield { phase: "reviewing", round, issues: [], text: candidate, done: false } satisfies ReviewLoopFrame;

          for (let i = 0; i <= MAX_REWRITES; i++) {
            const review = await reviewPost({ text: candidate, ...reviewCtx });
            if (review.verdict === "pass" || i === MAX_REWRITES) break;
            issues.push(...review.issues);
            round++;
            // Reviewer flagged problems → show them, then rewrite against them.
            yield { phase: "revising", round, issues: [...new Set(issues)], text: candidate, done: false } satisfies ReviewLoopFrame;
            candidate = await rewriteForReview({ text: candidate, issues: review.issues, ...reviewCtx });
            yield { phase: "reviewing", round, issues: [...new Set(issues)], text: candidate, done: false } satisfies ReviewLoopFrame;
          }

          await opts.handlers.updatePost(candidate);
          // Final frame — the LAST yield is what the SDK persists as the tool
          // output (a generator's return value is NOT captured by for-await).
          yield { phase: "done", round, issues: [...new Set(issues)], text: candidate, done: true } satisfies ReviewLoopFrame;
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
      addProfileRule: tool({
        description:
          "Save a LASTING rule to the creator's profile so every future post obeys it. Use ONLY after the creator has explicitly confirmed they want it saved (you must ask first). 'avoid' = a thing to never do (e.g. 'no corporate filler like strategischer Vorteil'); 'tone' = a voice/register instruction (e.g. 'always address the reader with du').",
        inputSchema: z.object({
          rule: z.string().describe("The rule to save, phrased as a short imperative the writer can obey."),
          kind: z.enum(["avoid", "tone"]).describe("'avoid' → a hard no-go; 'tone' → a voice/register instruction."),
        }),
        execute: async ({ rule, kind }) => opts.handlers.addProfileRule(rule, kind),
      }),
    },
  });

  // Standalone helpers (the result.toUIMessageStream* methods are deprecated).
  // generateMessageId gives the response message a real id — without it the SDK
  // reconstructs the assistant message with id "" server-side (the client mints
  // its own), which broke merge-by-id persistence and reload (empty id filtered
  // on hydration) so chat turns vanished on refresh.
  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      originalMessages: opts.messages,
      generateMessageId: generateId,
      onEnd: ({ messages }) => opts.onFinish?.(messages),
    }),
  });
}
