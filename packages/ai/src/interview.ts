// packages/ai/src/interview.ts
import {
  generateText,
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
import type { ChatMessage } from "./types.js";

export const INTERVIEW_SYSTEM = `You are an elite LinkedIn brand strategist and ghostwriter running a warm, sharp intake conversation to learn a creator's voice and goals. Be the best ghostwriter a founder could hire: curious, encouraging, genuinely helpful — never a robotic questionnaire.

How to behave:
- Match the user's LANGUAGE and their register. If they write casually or use informal "du", mirror it — never be stiffer or more formal than they are.
- Be a real collaborator. React specifically to each answer first (a short genuine reflection, "love that", a sharp observation), THEN ask your next thing. One question at a time, conversational.
- Be genuinely helpful. If they ask for examples or seem stuck, GIVE concrete examples and suggestions — don't deflect. If they say "examples?", offer 2-3 real ones. Propose ideas they can react to ("since you fight 'certificate bingo', a content pillar could be debunking compliance myths — does that fit?").
- Dig into vague answers with one specific follow-up.
- Naturally cover over the chat: who they are and what they do; their audience and the transformation they sell; goals (leads, thought leadership, reach); unique POV / positioning; content pillars; voice and tone; no-gos; creators they admire; the reaction/CTA they want.
- Keep each message short (1-3 sentences), human, and specific. Output only your next message.

Wrapping up: when you have enough to write in their voice, do NOT promise to "send drafts" or "get back to them" — you don't write posts here. Instead, warmly tell them you've got what you need, and ask them to click the "Finish & build my profile" button below to turn this into their brand brief.`;

export async function nextTurn(
  messages: ChatMessage[],
  opts?: { model?: LanguageModel; seed?: string; language?: string },
): Promise<string> {
  const model = opts?.model ?? getTextModel();
  let system = INTERVIEW_SYSTEM;
  if (opts?.language) {
    system += `\n\nConduct the ENTIRE interview in ${opts.language}. Every message, including your first, must be written in ${opts.language}.`;
  }
  if (opts?.seed) {
    system += `\n\nContext from the creator's existing posts (use it to confirm or challenge, do not read it back verbatim):\n${opts.seed}`;
  }
  const { text } = await generateText({
    model,
    system,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  });
  return text.trim();
}

// Streaming, tool-using interview — the modern version. The assistant streams
// its questions and calls the `buildProfile` tool once it has learned enough,
// turning the conversation into the creator's profile.
export interface InterviewHandlers {
  buildProfile(): Promise<void> | void;
}

export interface StreamInterviewOptions {
  messages: UIMessage[];
  language?: string;
  seed?: string;
  handlers: InterviewHandlers;
  onFinish?: (messages: UIMessage[]) => void;
  model?: LanguageModel;
}

function interviewSystem(language?: string, seed?: string): string {
  let system = INTERVIEW_SYSTEM;
  if (language) {
    system += `\n\nConduct the ENTIRE interview in ${language}. Every message, including your first, must be written in ${language}.`;
  }
  if (seed) {
    system += `\n\nContext from the creator's existing posts (use it to confirm or challenge, do not read it back verbatim):\n${seed}`;
  }
  // Override the button-based wrap-up: in this mode you have a tool.
  system += `\n\nYou HAVE a tool called "buildProfile". When you have learned enough to write in the creator's voice, CALL it — it turns this conversation into their brand profile. Right after calling it, warmly tell them their profile is ready to review below. Never ask them to click a button.`;
  return system;
}

export async function streamInterview(opts: StreamInterviewOptions): Promise<Response> {
  const result = streamText({
    model: opts.model ?? getTextModel(),
    system: interviewSystem(opts.language, opts.seed),
    messages: await convertToModelMessages(opts.messages),
    stopWhen: stepCountIs(3),
    tools: {
      buildProfile: tool({
        description:
          "Turn the conversation so far into the creator's brand profile. Call this once you've learned enough about their voice, audience, goals and pillars.",
        inputSchema: z.object({}),
        execute: async () => {
          await opts.handlers.buildProfile();
          return { ok: true };
        },
      }),
    },
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      originalMessages: opts.messages,
      generateMessageId: generateId,
      onEnd: ({ messages }) => opts.onFinish?.(messages),
    }),
  });
}
