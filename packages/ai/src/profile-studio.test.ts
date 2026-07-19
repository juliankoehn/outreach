// packages/ai/src/profile-studio.test.ts
import { describe, it, expect } from "vitest";
import { MockLanguageModelV3, convertArrayToReadableStream } from "ai/test";
import { streamProfileStudio, type ProfileStudioHandlers } from "./profile-studio.js";
import { MOCK_USAGE } from "./testing.js";

const NO_CITATIONS_RULE =
  "You can call searchKnowledge to pull passages from the creator's uploaded documents (norms, guidelines). When you use them, ground your writing on the retrieved passages — but NEVER put citations, source names, section numbers, or quotes-with-attribution in the post text itself. The post must read clean; the sources are shown to the user separately in the UI.";

function noopHandlers(overrides: Partial<ProfileStudioHandlers> = {}): ProfileStudioHandlers {
  return {
    updateProfile: async () => {},
    createExampleImage: async () => ({ imageUrl: "/x.png" }),
    searchKnowledge: async () => [],
    ...overrides,
  };
}

function textStreamResult(text: string) {
  return {
    stream: convertArrayToReadableStream([
      { type: "stream-start" as const, warnings: [] },
      { type: "text-start" as const, id: "t1" },
      { type: "text-delta" as const, id: "t1", delta: text },
      { type: "text-end" as const, id: "t1" },
      { type: "finish" as const, usage: MOCK_USAGE, finishReason: { unified: "stop" as const, raw: undefined } },
    ]),
  };
}

function toolCallStreamResult(toolName: string, input: unknown) {
  return {
    stream: convertArrayToReadableStream([
      { type: "stream-start" as const, warnings: [] },
      { type: "tool-call" as const, toolCallId: "call-1", toolName, input: JSON.stringify(input) },
      { type: "finish" as const, usage: MOCK_USAGE, finishReason: { unified: "tool-calls" as const, raw: undefined } },
    ]),
  };
}

describe("streamProfileStudio", () => {
  it("includes the silent-grounding rule in the system prompt", async () => {
    const model = new MockLanguageModelV3({ doStream: textStreamResult("ok") });
    const response = await streamProfileStudio({
      messages: [{ id: "1", role: "user", parts: [{ type: "text", text: "hi" }] }],
      current: {},
      handlers: noopHandlers(),
      model,
    });
    await response.text();
    const system = model.doStreamCalls[0]!.prompt.find((m) => m.role === "system");
    expect(JSON.stringify(system)).toContain(NO_CITATIONS_RULE);
  });

  it("wires the searchKnowledge tool to the handler and passes through its result", async () => {
    let seenQuery = "";
    const handlers = noopHandlers({
      searchKnowledge: async (query) => {
        seenQuery = query;
        return [{ content: "Passage text", section: null, resourceName: "guidelines.md" }];
      },
    });

    const model = new MockLanguageModelV3({
      doStream: [
        toolCallStreamResult("searchKnowledge", { query: "data retention" }),
        textStreamResult("Grounded the brief in your policy."),
      ],
    });

    const response = await streamProfileStudio({
      messages: [{ id: "1", role: "user", parts: [{ type: "text", text: "write about data retention" }] }],
      current: {},
      handlers,
      model,
    });
    await response.text();

    expect(seenQuery).toBe("data retention");
  });
});
