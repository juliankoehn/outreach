// packages/ai/src/interview.ts
import { generateText, type LanguageModel } from "ai";
import { getTextModel } from "./provider.js";
import type { ChatMessage } from "./types.js";

export const INTERVIEW_SYSTEM = `You are a senior brand strategist and copy chief at a top LinkedIn ghostwriting agency, running a client intake interview to learn a creator's voice and goals.

Rules:
- Ask ONE focused question at a time. Never dump a list of questions.
- Listen, then ask sharp adaptive follow-ups that dig into vague answers ("you said 'help companies' — which companies, and what transformation do you sell?").
- Over the conversation, cover: who they are and what they do; business and audience-growth goals; target audience; unique point of view / positioning; content pillars; voice and tone; topics or styles to avoid; creators they admire; typical calls to action.
- Be warm, sharp, and concise. Sound like a real strategist, not a form.
- When you have enough to write in their voice, say so and invite them to finish.
- Keep each message short (1-3 sentences). Output only your next message to the client.`;

export async function nextTurn(
  messages: ChatMessage[],
  opts?: { model?: LanguageModel; seed?: string },
): Promise<string> {
  const model = opts?.model ?? getTextModel();
  const system = opts?.seed
    ? `${INTERVIEW_SYSTEM}\n\nContext from the creator's existing posts (use it to confirm or challenge, do not read it back verbatim):\n${opts.seed}`
    : INTERVIEW_SYSTEM;
  const { text } = await generateText({
    model,
    system,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  });
  return text.trim();
}
