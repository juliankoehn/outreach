import { describe, it, expect } from "vitest";
import { analyzePosts } from "./analyze.js";
import { textModel } from "./testing.js";

const DERIVED = {
  voiceSummary: "Direct, technical, opinionated.",
  visualStyle: "Clean, high-contrast graphics; blue accent; minimal text overlays.",
  themes: ["AI governance", "compliance"],
  styleTraits: ["short paragraphs", "contrarian hooks"],
  cadence: "~weekly",
  topPatterns: ["strong first-line hooks drive impressions"],
};

describe("analyzePosts", () => {
  it("returns derived insights", async () => {
    const model = textModel(JSON.stringify(DERIVED));
    const d = await analyzePosts(
      [{ text: "Unpopular opinion: ...", publishedAt: "2025-06-09", metrics: { impressions: 5000, reactions: 40, comments: 3 } }],
      { model },
    );
    expect(d.themes).toContain("AI governance");
    expect(d.topPatterns.length).toBeGreaterThan(0);
  });
});
