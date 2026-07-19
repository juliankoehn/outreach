// Shared test helpers for the AI package. Mock model shapes track the
// @ai-sdk/provider spec (v3 as of AI SDK 7); keeping them here means a future
// provider-spec bump is a one-file change instead of a sweep across tests.
import { MockLanguageModelV3, MockImageModelV3 } from "ai/test";
import type { ImageModel } from "ai";

// A valid LanguageModelV3 usage object. The shape became nested (per-bucket
// totals) in provider spec v3.
export const MOCK_USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

// The provider's doGenerate result type, derived from the mock so we never
// import @ai-sdk/provider directly (it isn't a direct dependency).
type GenResult = Awaited<ReturnType<InstanceType<typeof MockLanguageModelV3>["doGenerate"]>>;

// A full doGenerate result that emits a single text block.
export function textResult(text: string): GenResult {
  return {
    finishReason: { unified: "stop", raw: undefined },
    usage: MOCK_USAGE,
    content: [{ type: "text", text }],
    warnings: [],
  };
}

export function textModel(text: string) {
  return new MockLanguageModelV3({ doGenerate: async () => textResult(text) });
}

// A model that records the prompt it was called with, so tests can assert on
// the system/user messages the SDK built. Uses the constructor's contextual
// typing (no vi.fn wrapper, which loses the provider's exact result type).
export function recordingModel(text = "ok") {
  const calls: Array<{ prompt: Array<{ role: string }> }> = [];
  const model = new MockLanguageModelV3({
    doGenerate: async (options) => {
      calls.push({ prompt: (options as { prompt: Array<{ role: string }> }).prompt });
      return textResult(text);
    },
  });
  return { model, calls };
}

// Minimal ImageModelV3 mock returning a fixed base64 image. The `ai` package
// wraps the raw base64 into a GeneratedFile (base64/mediaType getters).
export function imageModel(base64 = "aGVsbG8="): ImageModel {
  return {
    specificationVersion: "v3",
    provider: "mock",
    modelId: "mock-image",
    maxImagesPerCall: 1,
    doGenerate: async () => ({
      images: [base64],
      warnings: [],
      response: { timestamp: new Date(0), modelId: "mock-image", headers: {} },
    }),
  } as unknown as ImageModel;
}

// Image mock that records the resolved { prompt, size } each call, so tests can
// assert on the LinkedIn-size mapping and the reference-hint injection. Wraps
// the provider's own MockImageModelV3 (mirroring the textModel helper) so the
// captured call shape stays in lock-step with the installed provider spec.
export class MockImageModel extends MockImageModelV3 {
  constructor(spy?: (call: { prompt: string; size?: string }) => void, base64 = "iVBORw0KGgo=") {
    super({
      doGenerate: async (options) => {
        spy?.({ prompt: options.prompt ?? "", size: options.size });
        return {
          images: [base64],
          warnings: [],
          response: { timestamp: new Date(0), modelId: "mock-image", headers: {} },
        };
      },
    });
  }
}
