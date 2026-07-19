// packages/ai/src/profile-studio.ts
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

// The fields the AI can propose/commit. There is no `voice`/`visualStyle`
// column on CreatorProfile — the route maps those onto toneWords/brandBrief
// (see apps/api/src/routes/profile.ts, POST /:id/studio for the exact merge).
export interface ProfilePatch {
  voice?: string;
  toneWords?: string[];
  pillars?: string[];
  audience?: string;
  positioning?: string;
  visualStyle?: string;
  noGos?: string[];
  brandBrief?: string;
}

const PATCH_SCHEMA = z.object({
  voice: z.string().optional().describe("A short description of their voice/tone, if distinct from toneWords."),
  toneWords: z.array(z.string()).optional().describe("Tone/voice words, e.g. ['direct', 'warm', 'no-nonsense']."),
  pillars: z.array(z.string()).optional().describe("Content pillars/topics they post about."),
  audience: z.string().optional().describe("Who they write for and the transformation they sell."),
  positioning: z.string().optional().describe("Their unique point of view / positioning."),
  visualStyle: z.string().optional().describe("Preferred visual style for images, if discussed."),
  noGos: z.array(z.string()).optional().describe("Topics, words, or tones to avoid."),
  brandBrief: z.string().optional().describe("The full brand brief prose paragraph."),
});

// The AI is the single writer of profile fields: every persisted change flows
// through `updateProfile`. proposeConfirm/proposeOptions are HUMAN-IN-THE-LOOP
// tools with NO execute — the AI stops after calling one and waits for the
// user's decision (delivered via addToolResult on the client), then commits
// the confirmed/picked patch through updateProfile.
export interface KnowledgePassage {
  content: string;
  section: string | null;
  resourceName: string;
}

export interface ProfileStudioHandlers {
  updateProfile(patch: ProfilePatch): Promise<void> | void;
  // Generate a matching visual for an example post and return a servable URL.
  // The route wires this to generateImage + saveImage (reusing the draft
  // studio's image pipeline), passing the creator's learned visualStyle.
  createExampleImage(opts: { postText: string; direction?: string }): Promise<{ imageUrl: string }>;
  searchKnowledge(query: string): Promise<KnowledgePassage[]>;
}

export interface StreamProfileStudioOptions {
  messages: UIMessage[];
  // What's already on the canvas — so the AI doesn't re-ask for it.
  current: ProfilePatch;
  // A short summary of what the analysis of the creator's past posts found.
  insights?: string;
  language?: string;
  handlers: ProfileStudioHandlers;
  model?: LanguageModel;
  onFinish?: (messages: UIMessage[]) => void;
}

function describeCurrent(current: ProfilePatch): string {
  const lines: string[] = [];
  if (current.audience) lines.push(`Audience: ${current.audience}`);
  if (current.positioning) lines.push(`Positioning: ${current.positioning}`);
  if (current.pillars?.length) lines.push(`Pillars: ${current.pillars.join(", ")}`);
  if (current.toneWords?.length) lines.push(`Tone/voice words: ${current.toneWords.join(", ")}`);
  if (current.noGos?.length) lines.push(`No-gos: ${current.noGos.join(", ")}`);
  if (current.visualStyle) lines.push(`Visual style: ${current.visualStyle}`);
  if (current.brandBrief) lines.push(`Brand brief:\n"""${current.brandBrief}"""`);
  return lines.length > 0 ? lines.join("\n") : "Nothing is on the canvas yet — this is a fresh profile.";
}

function profileStudioSystem(current: ProfilePatch, insights: string | undefined, language: string | undefined): string {
  const learned = insights?.trim()
    ? `\nWHAT ACTUALLY WORKS FOR THIS CREATOR (from analysing their past posts — lean on it, don't re-ask what it already tells you)\n${insights.trim()}\n`
    : "";
  const lang = language
    ? `\n\nConduct the ENTIRE conversation in ${language}. Every message must be written in ${language}. Crucially, ALL profile field values you propose or commit — pillars, tone words, audience, positioning, no-gos — must ALSO be in ${language}, even when the analysis insights above are written in another language: translate them into ${language} first. Never mix languages in the canvas (e.g. do not add both an English and a ${language} version of the same pillar).`
    : "";

  return `You are an elite LinkedIn brand strategist leading a warm, sharp, GUIDED profile-building conversation. A live canvas (chips + brand brief + example posts) sits beside the chat; the canvas IS the creator's profile and you are its only writer.

WHAT'S ALREADY ON THE CANVAS (build on it — never re-ask for it)
${describeCurrent(current)}
${learned}
YOU HAVE TWO MODES — pick per message based on who is driving. You are a capable agent: you can call SEVERAL tools in one turn, and updateProfile accepts many fields at once. Use that.

MODE A — THE USER GIVES A DIRECT INSTRUCTION (e.g. "add X to the no-gos", "rewrite the post without hashtags", "also remove emojis", "change the audience to Y"):
- Just DO it, fully, in the SAME turn. Do not stop at one tool — call as many as the request needs. "Rewrite the post AND add hashtags to the no-gos" is TWO actions: updateProfile({noGos:[...]}) AND writeExamplePost({text}) — do BOTH. Fold related field changes into a single updateProfile patch.
- Satisfy EVERY part of the request. If the user lists two changes, apply both; never do one and forget the other.
- Do NOT propose (no proposeConfirm/proposeOptions) something the user already told you to do — just apply it.
- BE PROACTIVE — this is the agentic part. If a one-off request also reveals a LASTING rule for the profile that isn't on the canvas yet (most often a no-go — "less buzzwords", "no emojis", "that's important to me", "I hate X" — but also a tone word or pillar), don't stop at the one-off edit. After doing what was asked, END the turn by proactively offering to capture that rule with a proposeConfirm (e.g. "Should I add 'buzzwords & filler words' to your no-gos?", carrying the patch). The user should never have to tell you twice to make a preference permanent. If nothing durable surfaced, just end with one short confirmation line.

MODE B — YOU ARE LEADING THE DISCOVERY (filling a gap, suggesting the next field the user hasn't decided yet):
- Advance one step: end the turn with a SINGLE proposeConfirm (one confident claim to accept/reject) or proposeOptions (2-4 concrete choices) — that tool call IS your message, so don't also ask in text and don't ask a second thing. Then STOP and wait for the decision.
- When the decision comes back: accepted/picked → call updateProfile with the proposed patch to persist it, then move to your next single proposal. rejected, or a free-text "note" is present → do NOT persist; briefly acknowledge, optionally add the rejected idea to noGos, adapt using their note, and propose the next thing.

ALWAYS: updateProfile is the ONLY writer — every persisted change flows through it. NEVER repeat a claim or question you've already made. NEVER re-propose something already on the canvas.

WHAT TO COVER (naturally, one step at a time): audience & the transformation they sell → positioning/POV → content pillars → tone/voice words → no-gos → (optional) visual style.
- Once you know voice, audience, pillars and positioning, write/refresh a short usable "brandBrief" via updateProfile — keep sharpening it as you learn more.
- At milestones (right after the brand brief first exists, or when asked) call "writeExamplePost" with a short concrete LinkedIn post in their voice — it renders on the canvas; never paste a post into the chat.
- A post feels complete with a matching visual: right after you write or meaningfully revise an example post (and whenever the user asks for an image), call "generateExampleImage" with that post's text so a matching picture appears in the preview. It uses the creator's visual style. Don't regenerate the image on trivial text tweaks.
- Keep messages short (1-2 sentences), human, specific. Mirror the creator's language and register (informal "du" if they use it).
- You can call searchKnowledge to pull passages from the creator's uploaded documents (norms, guidelines). When you use them, ground your writing on the retrieved passages — but NEVER put citations, source names, section numbers, or quotes-with-attribution in the post text itself. The post must read clean; the sources are shown to the user separately in the UI.${lang}`;
}

export async function streamProfileStudio(opts: StreamProfileStudioOptions): Promise<Response> {
  const result = streamText({
    model: opts.model ?? getTextModel(),
    system: profileStudioSystem(opts.current, opts.insights, opts.language),
    messages: await convertToModelMessages(opts.messages),
    stopWhen: stepCountIs(8),
    tools: {
      // THE writer. Server-side execute.
      updateProfile: tool({
        description:
          "Persist committed profile fields to the canvas. THE only writer — call this immediately after the user accepts a proposeConfirm or picks a proposeOptions, with the corresponding patch, and whenever you write/refresh the brand brief. Pass only the fields you're changing.",
        inputSchema: PATCH_SCHEMA,
        execute: async (patch) => {
          await opts.handlers.updateProfile(patch);
          return { ok: true };
        },
      }),
      // HUMAN-IN-THE-LOOP: no execute → the model stops and waits for the
      // user's decision (client addToolResult).
      proposeConfirm: tool({
        description:
          "Propose ONE confident claim for the creator to accept or reject. Renders an accept/reject card and PAUSES the conversation until they respond. Carry the exact patch this claim would apply.",
        inputSchema: z.object({
          summary: z.string().describe("The claim, phrased as a short statement in the creator's language."),
          patch: PATCH_SCHEMA.describe("The profile change to apply if accepted."),
        }),
        outputSchema: z.object({
          accepted: z.boolean(),
          note: z.string().optional().describe("Free-text the user typed instead of clicking, if any."),
        }),
      }),
      proposeOptions: tool({
        description:
          "Offer 2-4 concrete options for the creator to pick from. Renders as chips and PAUSES until they respond. Each option carries the patch it would apply.",
        inputSchema: z.object({
          question: z.string().describe("The short question the options answer, in the creator's language."),
          options: z
            .array(z.object({ label: z.string(), patch: PATCH_SCHEMA }))
            .min(2)
            .max(4)
            .describe("2 to 4 options, each with its label and the patch it applies if picked."),
          multi: z.boolean().optional().describe("Whether multiple options can be picked at once."),
        }),
        outputSchema: z.object({
          picked: z.array(z.string()).describe("The picked option labels."),
          note: z.string().optional(),
        }),
      }),
      // Display-only, but server-side so the loop continues after writing.
      writeExamplePost: tool({
        description:
          "Write a short example LinkedIn post in the creator's voice for the canvas (it mirrors there; never paste it into the chat). Call at milestones or when asked.",
        inputSchema: z.object({
          text: z.string().describe("The complete example post text."),
        }),
        execute: async () => {
          return { ok: true };
        },
      }),
      // Generate a matching image for the current example post. Slow (~10-20s),
      // so keep it separate from writeExamplePost: the text renders instantly
      // and the image streams onto the canvas when ready.
      generateExampleImage: tool({
        description:
          "Generate a matching visual for the example post currently on the canvas and attach it to the preview. Uses the creator's visual style. Call right after writing/refreshing an example post when a visual would help, or when the user asks for an image — but don't regenerate on every tiny text tweak.",
        inputSchema: z.object({
          postText: z.string().describe("The example post text the image should accompany."),
          direction: z
            .string()
            .optional()
            .describe("Short art direction for the image, e.g. 'minimal abstract compliance shield, muted tones'."),
        }),
        execute: async ({ postText, direction }) => {
          return await opts.handlers.createExampleImage({ postText, direction });
        },
      }),
      searchKnowledge: tool({
        description:
          "Search the creator's uploaded documents (norms, guidelines) for passages relevant to a query. Use to ground the brand brief or example posts, but never cite sources in the text — sources are shown to the user separately.",
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
