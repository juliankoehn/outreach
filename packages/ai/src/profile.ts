import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import { getTextModel } from "./provider.js";
import type { ChatMessage, DerivedInsights, SynthesizedProfile } from "./types.js";

export const PROFILE_SCHEMA = z.object({
  goals: z.array(z.string()),
  audience: z.string(),
  pillars: z.array(z.string()),
  noGos: z.array(z.string()),
  toneWords: z.array(z.string()),
  languages: z.array(z.string()),
  positioning: z.string(),
  brandBrief: z.string().describe(
    "A system-prompt-grade brief a ghostwriter can use to write posts in this creator's voice: who they are, audience, goals, pillars, tone, do's and don'ts. 150-300 words, second person.",
  ),
});

export async function synthesizeProfile(
  messages: ChatMessage[],
  opts?: { model?: LanguageModel; derived?: DerivedInsights },
): Promise<SynthesizedProfile> {
  const model = opts?.model ?? getTextModel();
  const transcript = messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n");
  const derivedBlock = opts?.derived
    ? `\n\nObserved from their existing posts:\n${JSON.stringify(opts.derived, null, 2)}`
    : "";
  const { object } = await generateObject({
    model,
    schema: PROFILE_SCHEMA,
    system:
      "You are a brand strategist. From this intake interview, synthesize a precise creator profile and a brandBrief a ghostwriter will use to write in the creator's voice. Be specific and faithful to the interview; do not invent facts.",
    prompt: `Interview transcript:\n${transcript}${derivedBlock}`,
  });
  return object;
}
