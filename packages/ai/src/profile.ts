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

// The editable profile fields we feed back into a refinement pass.
export type CurrentProfile = SynthesizedProfile;

/**
 * Refine an existing profile using fresh analysis of the creator's real posts
 * (voice, visual style, themes, what actually drives engagement). Keeps what
 * works, sharpens the rest, and folds the visual style into the brandBrief so
 * generated images match. This is what makes the profile adapt over time.
 */
export async function refineProfile(
  current: CurrentProfile,
  derived: DerivedInsights,
  opts?: { model?: LanguageModel },
): Promise<SynthesizedProfile> {
  const model = opts?.model ?? getTextModel();
  const { object } = await generateObject({
    model,
    schema: PROFILE_SCHEMA,
    system:
      "You are a brand strategist refining an existing creator profile with fresh analysis of the creator's REAL posts (voice, visual style, recurring themes, and what actually drives engagement). Keep what's working; sharpen tone words, pillars and positioning based on the evidence; and rewrite the brandBrief so it reflects what the data shows performs. Fold the visual style into the brief so image generation matches their look. Do not invent facts — ground every change in the analysis.",
    prompt: `Current profile:\n${JSON.stringify(current, null, 2)}\n\nAnalysis of their real posts:\n${JSON.stringify(derived, null, 2)}`,
  });
  return object;
}

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
