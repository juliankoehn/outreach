import { embed, embedMany, type EmbeddingModel } from "ai";
import { getEmbeddingModel } from "./provider.js";

export async function embedQuery(text: string, opts?: { model?: EmbeddingModel }): Promise<number[]> {
  const { embedding } = await embed({ model: opts?.model ?? getEmbeddingModel(), value: text });
  return embedding;
}

export async function embedBatch(texts: string[], opts?: { model?: EmbeddingModel }): Promise<number[][]> {
  if (texts.length === 0) return [];
  const { embeddings } = await embedMany({ model: opts?.model ?? getEmbeddingModel(), values: texts });
  return embeddings;
}
