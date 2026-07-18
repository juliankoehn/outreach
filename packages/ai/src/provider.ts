import { openai } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

export function getTextModel(override?: string): LanguageModel {
  const provider = process.env.AI_PROVIDER ?? "openai";
  const modelId = override ?? process.env.AI_TEXT_MODEL ?? "gpt-4o";
  switch (provider) {
    case "openai":
      return openai(modelId);
    default:
      throw new Error(`Unknown AI provider: ${provider}. Supported: openai.`);
  }
}
