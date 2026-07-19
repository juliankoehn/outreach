// packages/ai/src/interview.test.ts
import { describe, it, expect } from "vitest";
import { nextTurn, INTERVIEW_SYSTEM } from "./interview.js";
import { textModel, recordingModel } from "./testing.js";

describe("interview", () => {
  it("returns the assistant's next question", async () => {
    const out = await nextTurn(
      [{ role: "assistant", content: "Hi! What do you do?" }, { role: "user", content: "I'm a GRC founder." }],
      { model: textModel("Great — who exactly are you trying to reach on LinkedIn?") },
    );
    expect(out).toMatch(/who exactly/i);
  });

  it("passes the interview system prompt and seed to the model", async () => {
    const { model, calls } = recordingModel("ok");
    await nextTurn([{ role: "user", content: "hi" }], { model, seed: "They post about AI governance." });
    const system = calls[0]!.prompt.find((m) => m.role === "system");
    expect(JSON.stringify(system)).toContain("AI governance");
    expect(INTERVIEW_SYSTEM.length).toBeGreaterThan(200);
  });
});
