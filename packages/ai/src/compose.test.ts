import { describe, it, expect, vi } from "vitest";
import { MockLanguageModelV2 } from "ai/test";
import { draftPost, refinePost, generateImage } from "./compose.js";

function textMock(text: string) {
  return new MockLanguageModelV2({
    doGenerate: async () => ({
      finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      content: [{ type: "text", text }], warnings: [],
    }),
  });
}

describe("compose", () => {
  it("drafts a post using the brandBrief as system context", async () => {
    const spy = vi.fn(async () => ({
      finishReason: "stop" as const, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      content: [{ type: "text" as const, text: "Here's a hook...\n\nBody." }], warnings: [],
    }));
    const model = new MockLanguageModelV2({ doGenerate: spy });
    const out = await draftPost("Write as Julian, a GRC founder.", { topic: "AI governance", model });
    expect(out).toMatch(/hook/i);
    // doGenerate's real param type comes from @ai-sdk/provider (a transitive dep, not
    // directly resolvable for types here), so the spy's inferred signature has no
    // parameters; cast the captured call args to inspect the generated prompt.
    const call = (spy.mock.calls as unknown as [{ prompt: Array<{ role: string }> }][])[0]![0];
    const sys = call.prompt.find((m) => m.role === "system");
    expect(JSON.stringify(sys)).toContain("GRC founder");
    expect(JSON.stringify(call.prompt)).toContain("AI governance");
  });

  it("refines a post from the current text + instruction, keeping the voice", async () => {
    const spy = vi.fn(async () => ({
      finishReason: "stop" as const,
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      content: [{ type: "text" as const, text: "Punchier hook.\n\nBody." }],
      warnings: [],
    }));
    const model = new MockLanguageModelV2({ doGenerate: spy });
    const out = await refinePost("Write as Julian.", "Original post.", "Make the hook punchier", { model });
    expect(out).toMatch(/punchier/i);
    const call = (spy.mock.calls as unknown as [{ prompt: unknown }][])[0]![0];
    const prompt = JSON.stringify(call.prompt);
    expect(prompt).toContain("Original post.");
    expect(prompt).toContain("Make the hook punchier");
  });

  it("generates an image and returns base64 + mediaType", async () => {
    // inject a mock image model matching the ai SDK ImageModelV2 doGenerate shape
    const imageModel = {
      specificationVersion: "v2",
      provider: "mock",
      modelId: "mock-image",
      maxImagesPerCall: 1,
      doGenerate: async () => ({
        // ImageModelV2.doGenerate returns raw images as base64 strings (or Uint8Array),
        // NOT `{ base64, mediaType }` objects — the `ai` package wraps them into a
        // `GeneratedFile` (base64/uint8Array/mediaType getters) via experimental_generateImage.
        images: ["aGVsbG8="],
        warnings: [], response: { timestamp: new Date(0), modelId: "mock-image", headers: {} },
      }),
    } as unknown as import("ai").ImageModel;
    const img = await generateImage("a minimalist poster", { model: imageModel });
    expect(img.base64).toBe("aGVsbG8=");
    expect(img.mediaType).toMatch(/image\//);
  });
});
