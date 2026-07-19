import { describe, it, expect } from "vitest";
import { synthesizeProfile } from "./profile.js";
import { textModel } from "./testing.js";

const OBJECT = {
  goals: ["Thought leadership in AI governance"],
  audience: "GRC and compliance leaders at mid-market companies",
  pillars: ["AI governance", "Deterministic compliance", "Founder lessons"],
  noGos: ["Political hot takes"],
  toneWords: ["direct", "technical", "warm"],
  languages: ["de", "en"],
  positioning: "Engineering-driven GRC that replaces paperwork with determinism",
  brandBrief: "Write as Julian, a GRC founder...",
};

describe("synthesizeProfile", () => {
  it("returns the structured profile from the model object", async () => {
    const model = textModel(JSON.stringify(OBJECT));
    const profile = await synthesizeProfile(
      [{ role: "user", content: "I run a GRC startup." }],
      { model },
    );
    expect(profile.pillars).toContain("AI governance");
    expect(profile.brandBrief).toMatch(/GRC founder/);
    expect(profile.languages).toEqual(["de", "en"]);
  });
});
