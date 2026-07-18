// packages/ai/src/interview.test.ts
import { describe, it, expect, vi } from "vitest";
import { MockLanguageModelV2 } from "ai/test";
import { nextTurn, INTERVIEW_SYSTEM } from "./interview.js";

function mock(text: string) {
  return new MockLanguageModelV2({
    doGenerate: async () => ({
      finishReason: "stop",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      content: [{ type: "text", text }],
      warnings: [],
    }),
  });
}

describe("interview", () => {
  it("returns the assistant's next question", async () => {
    const out = await nextTurn(
      [{ role: "assistant", content: "Hi! What do you do?" }, { role: "user", content: "I'm a GRC founder." }],
      { model: mock("Great — who exactly are you trying to reach on LinkedIn?") },
    );
    expect(out).toMatch(/who exactly/i);
  });

  it("passes the interview system prompt and seed to the model", async () => {
    // doGenerate's real param type comes from @ai-sdk/provider (a transitive dep, not
    // directly resolvable for types here), so the spy's inferred signature has no
    // parameters; cast the captured call args to inspect the generated prompt.
    const spy = vi.fn(async () => ({
      finishReason: "stop" as const,
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      content: [{ type: "text" as const, text: "ok" }],
      warnings: [],
    }));
    const model = new MockLanguageModelV2({ doGenerate: spy });
    await nextTurn([{ role: "user", content: "hi" }], { model, seed: "They post about AI governance." });
    const call = (spy.mock.calls as unknown as [{ prompt: Array<{ role: string }> }][])[0]![0];
    const system = call.prompt.find((m) => m.role === "system");
    expect(JSON.stringify(system)).toContain("AI governance");
    expect(INTERVIEW_SYSTEM.length).toBeGreaterThan(200);
  });
});
