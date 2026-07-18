import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getTextModel } from "./provider.js";

describe("getTextModel", () => {
  const prev = { ...process.env };
  beforeEach(() => { delete process.env.AI_PROVIDER; delete process.env.AI_TEXT_MODEL; process.env.OPENAI_API_KEY = "sk-test"; });
  afterEach(() => { process.env = { ...prev }; });

  it("defaults to an openai model with a modelId", () => {
    // ai@5's `LanguageModel` type is `GlobalProviderModelId | LanguageModelV2`;
    // openai(modelId) concretely returns a LanguageModelV2, which carries
    // modelId/provider, but TS can't narrow the union here. Cast to access
    // the SDK-internal fields the brief asserts on (documented deviation).
    const m = getTextModel() as unknown as { modelId: string; provider: string };
    expect(m.modelId).toBe("gpt-4o");
    expect(m.provider).toContain("openai");
  });

  it("honors AI_TEXT_MODEL and an explicit override", () => {
    process.env.AI_TEXT_MODEL = "gpt-4o-mini";
    expect((getTextModel() as unknown as { modelId: string }).modelId).toBe("gpt-4o-mini");
    expect((getTextModel("gpt-4.1") as unknown as { modelId: string }).modelId).toBe("gpt-4.1");
  });

  it("throws on an unknown provider", () => {
    process.env.AI_PROVIDER = "nope";
    expect(() => getTextModel()).toThrow(/unknown ai provider/i);
  });
});
