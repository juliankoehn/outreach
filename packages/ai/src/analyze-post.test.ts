import { describe, it, expect } from "vitest";
import { analyzePost, engagementRate, POST_ANALYSIS_SCHEMA } from "./analyze-post.js";
import { textModel } from "./testing.js";

describe("engagementRate", () => {
  it("computes (reactions+comments+reshares)/impressions", () => {
    expect(engagementRate({ impressions: 1000, reactions: 30, comments: 15, reshares: 5 })).toBeCloseTo(0.05);
  });
  it("is 0 when impressions is 0 or missing", () => {
    expect(engagementRate({ impressions: 0, reactions: 5 })).toBe(0);
    expect(engagementRate(null)).toBe(0);
    expect(engagementRate({ reactions: 5 })).toBe(0);
  });
});

const ANALYSIS = {
  performance: { summary: "Strong hook drove above-average reach.", verdict: "over" },
  teardown: { hook: "Contrarian one-liner", structure: "short paras", pillar: "AI governance", format: "text-only, worked", cta: "question", toneMatch: "on-brand" },
  goalFit: "Advances the thought-leadership goal.",
  learnings: ["Contrarian hooks outperform", "Keep it text-only for reach"],
};

describe("analyzePost", () => {
  it("returns a schema-valid analysis grounded in the input", async () => {
    const model = textModel(JSON.stringify(ANALYSIS));
    const out = await analyzePost(
      {
        text: "Unpopular opinion: ...",
        mediaType: "none",
        publishedAt: "2026-06-01",
        metrics: { impressions: 5000, reactions: 120, comments: 20, reshares: 8 },
        engagementRate: 0.0296,
        baseline: { impressions: 3000, reactions: 40, comments: 5 },
        profile: { goals: ["thought leadership"], pillars: ["AI governance"], toneWords: ["direct"] },
      },
      { model },
    );
    expect(POST_ANALYSIS_SCHEMA.safeParse(out).success).toBe(true);
    expect(out.performance.verdict).toBe("over");
    expect(out.learnings.length).toBeGreaterThan(0);
  });
});
