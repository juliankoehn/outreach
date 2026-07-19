import { describe, it, expect } from "vitest";
import { MockEmbeddingModelV3 } from "ai/test";
import { embedQuery, embedBatch } from "./embed.js";

const model = new MockEmbeddingModelV3({
  maxEmbeddingsPerCall: 10,
  doEmbed: async ({ values }) => ({
    embeddings: values.map((_, i) => [i, 0, 0]),
    usage: { tokens: 1 },
    warnings: [],
  }),
});

describe("embed", () => {
  it("embeds a single query and a batch", async () => {
    expect(await embedQuery("hi", { model })).toEqual([0, 0, 0]);
    expect(await embedBatch(["a", "b"], { model })).toEqual([
      [0, 0, 0],
      [1, 0, 0],
    ]);
  });

  it("returns an empty array for an empty batch", async () => {
    expect(await embedBatch([], { model })).toEqual([]);
  });
});
