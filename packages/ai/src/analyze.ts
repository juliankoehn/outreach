import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import { getTextModel } from "./provider.js";
import type { DerivedInsights, PostForAnalysis } from "./types.js";

export const DERIVED_SCHEMA = z.object({
  voiceSummary: z.string().describe("The creator's written voice: tone, register, sentence rhythm, recurring phrasings."),
  visualStyle: z
    .string()
    .describe(
      "The creator's VISUAL language across their post images: colours, composition, typography, photo vs. graphic, mood, recurring subjects/motifs. Empty string if there are no images.",
    ),
  themes: z.array(z.string()),
  styleTraits: z.array(z.string()),
  cadence: z.string(),
  topPatterns: z
    .array(z.string())
    .describe("What correlates with higher engagement, grounded in the metrics — including whether media (image/carousel/video) helps."),
});

// Cap how many images we send to vision — enough to read the visual language
// without ballooning cost/latency on large post histories.
const MAX_VISION_IMAGES = 6;

export async function analyzePosts(
  posts: PostForAnalysis[],
  opts?: { model?: LanguageModel },
): Promise<DerivedInsights> {
  const model = opts?.model ?? getTextModel();
  const corpus = posts
    .map((p) => {
      const media = p.mediaType && p.mediaType !== "none" ? p.mediaType : "text-only";
      const impr = p.metrics?.impressions ?? "?";
      const react = p.metrics?.reactions ?? "?";
      const comm = p.metrics?.comments ?? "?";
      return `[${p.publishedAt}] media=${media} (impr ${impr}, react ${react}, comments ${comm})\n${p.text}`;
    })
    .join("\n---\n");

  // Attach the post images so the model can read the creator's VISUAL language,
  // not just the text. File parts (not the deprecated image part) with a URL.
  const images = posts
    .map((p) => p.imageUrl)
    .filter((u): u is string => typeof u === "string" && u.length > 0)
    .slice(0, MAX_VISION_IMAGES);

  const content: Array<
    { type: "text"; text: string } | { type: "file"; data: URL; mediaType: string }
  > = [{ type: "text", text: `Posts:\n${corpus}` }];
  for (const url of images) {
    try {
      content.push({ type: "file", data: new URL(url), mediaType: "image/jpeg" });
    } catch {
      // skip malformed URLs
    }
  }
  if (images.length > 0) {
    content.push({
      type: "text",
      text: `The ${images.length} image(s) above accompany some of these posts — read their shared visual language for "visualStyle".`,
    });
  }

  const { object } = await generateObject({
    model,
    schema: DERIVED_SCHEMA,
    system:
      "You are a brand & content analyst. From the creator's posts, extract their written voice, VISUAL style (from the attached images), recurring themes, style traits, posting cadence, and the patterns that correlate with higher engagement. Each post is tagged with media type and metrics — factor media into topPatterns (e.g. whether image/carousel posts outperform text-only). Ground everything in the provided metrics. If no images are attached, return an empty visualStyle.",
    messages: [{ role: "user", content }],
  });
  return object;
}
