import { describe, it, expect } from "vitest";
import { MockLanguageModelV2 } from "ai/test";
import { analyzePosts } from "./analyze.js";

const DERIVED = {
  voiceSummary: "Direct, technical, opinionated.",
  themes: ["AI governance", "compliance"],
  styleTraits: ["short paragraphs", "contrarian hooks"],
  cadence: "~weekly",
  topPatterns: ["strong first-line hooks drive impressions"],
};

describe("analyzePosts", () => {
  it("returns derived insights", async () => {
    const model = new MockLanguageModelV2({
      doGenerate: async () => ({
        finishReason: "stop",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        content: [{ type: "text", text: JSON.stringify(DERIVED) }],
        warnings: [],
      }),
    });
    const d = await analyzePosts(
      [{ text: "Unpopular opinion: ...", publishedAt: "2025-06-09", metrics: { impressions: 5000, reactions: 40, comments: 3 } }],
      { model },
    );
    expect(d.themes).toContain("AI governance");
    expect(d.topPatterns.length).toBeGreaterThan(0);
  });
});
