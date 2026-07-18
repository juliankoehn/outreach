import { generateText, experimental_generateImage as genImage, type LanguageModel, type ImageModel } from "ai";
import { openai } from "@ai-sdk/openai";
import { getTextModel } from "./provider.js";

const POST_INSTRUCTIONS = `Write a single LinkedIn post in the creator's authentic voice, following the brand brief exactly. Use a strong first line hook, short scannable paragraphs, no hashtags unless clearly on-brand, and end with a light call to action or an open question. Output only the post text.`;

export async function draftPost(
  brandBrief: string,
  opts?: { topic?: string; model?: LanguageModel },
): Promise<string> {
  const model = opts?.model ?? getTextModel();
  const { text } = await generateText({
    model,
    system: `${brandBrief}\n\n${POST_INSTRUCTIONS}`,
    prompt: opts?.topic ? `Topic / angle: ${opts.topic}` : "Write a strong post on one of the creator's core pillars.",
  });
  return text.trim();
}

export function getImageModel(): ImageModel {
  const provider = process.env.AI_PROVIDER ?? "openai";
  if (provider !== "openai") throw new Error(`Image generation supports only openai (got ${provider}).`);
  return openai.image(process.env.AI_IMAGE_MODEL ?? "gpt-image-1");
}

export async function generateImage(
  prompt: string,
  opts?: { model?: ImageModel },
): Promise<{ base64: string; mediaType: string }> {
  const model = opts?.model ?? getImageModel();
  const { image } = await genImage({ model, prompt });
  return { base64: image.base64, mediaType: image.mediaType ?? "image/png" };
}
