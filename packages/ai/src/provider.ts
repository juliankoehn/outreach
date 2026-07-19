import { openai } from "@ai-sdk/openai";
import type { EmbeddingModel, LanguageModel } from "ai";

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

export function getEmbeddingModel(override?: string): EmbeddingModel {
  const provider = process.env.AI_PROVIDER ?? "openai";
  const modelId = override ?? process.env.AI_EMBEDDING_MODEL ?? "text-embedding-3-large";
  switch (provider) {
    case "openai":
      return openai.embedding(modelId);
    default:
      throw new Error(`Unknown AI provider: ${provider}. Supported: openai.`);
  }
}
