import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import { getTextModel } from "./provider.js";
import type { DerivedInsights, PostForAnalysis } from "./types.js";

export const DERIVED_SCHEMA = z.object({
  voiceSummary: z.string(),
  themes: z.array(z.string()),
  styleTraits: z.array(z.string()),
  cadence: z.string(),
  topPatterns: z.array(z.string()).describe("What correlates with higher engagement, grounded in the metrics."),
});

export async function analyzePosts(
  posts: PostForAnalysis[],
  opts?: { model?: LanguageModel },
): Promise<DerivedInsights> {
  const model = opts?.model ?? getTextModel();
  const corpus = posts
    .map((p) => `[${p.publishedAt}] (impr ${p.metrics?.impressions ?? "?"}, react ${p.metrics?.reactions ?? "?"}) ${p.text}`)
    .join("\n---\n");
  const { object } = await generateObject({
    model,
    schema: DERIVED_SCHEMA,
    system:
      "You are a content analyst. Extract the creator's voice, recurring themes, style traits, posting cadence, and the patterns that correlate with higher engagement. Ground topPatterns in the provided metrics.",
    prompt: `Posts:\n${corpus}`,
  });
  return object;
}
