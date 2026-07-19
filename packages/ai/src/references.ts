import { generateText, type LanguageModel } from "ai";
import { getTextModel } from "./provider.js";

// Vision-derived, cached appearance/style descriptor for reference photos.
// Kept short so it can be concatenated into image prompts cheaply.
export async function describeImageReferences(
  images: Array<{ base64: string; mediaType: string }>,
  opts?: { model?: LanguageModel },
): Promise<string> {
  if (images.length === 0) return "";
  const content: Array<{ type: "text"; text: string } | { type: "file"; data: string; mediaType: string }> = [
    {
      type: "text",
      text: "Describe the person/subject and visual style in these reference photos in 1-2 sentences — appearance, palette, mood, setting — for reuse as image-generation guidance. No names, no assumptions beyond what's visible.",
    },
  ];
  for (const img of images) content.push({ type: "file", data: img.base64, mediaType: img.mediaType });
  const { text } = await generateText({ model: opts?.model ?? getTextModel(), messages: [{ role: "user", content }] });
  return text.trim();
}
