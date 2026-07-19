// packages/ai/src/studio-agent.test.ts
import { describe, it, expect } from "vitest";
import type { UIMessage } from "ai";
import { MockLanguageModelV3, convertArrayToReadableStream } from "ai/test";
import { streamStudioAgent, type StudioAgentHandlers } from "./studio-agent.js";
import { MOCK_USAGE } from "./testing.js";

const NO_CITATIONS_RULE =
  "You can call searchKnowledge to pull passages from the creator's uploaded documents (norms, guidelines). When you use them, ground your writing on the retrieved passages — but NEVER put citations, source names, section numbers, or quotes-with-attribution in the post text itself. The post must read clean; the sources are shown to the user separately in the UI.";

function noopHandlers(overrides: Partial<StudioAgentHandlers> = {}): StudioAgentHandlers {
  return {
    updatePost: async () => ({ revised: false, rounds: 0, issues: [] }),
    createImage: async () => ({ imageUrl: "/x.png" }),
    findSimilar: async () => [],
    searchKnowledge: async () => [],
    addProfileRule: async () => ({ noGos: [], toneWords: [] }),
    ...overrides,
  };
}

// A single-step doStream result that just emits text and finishes.
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

// A single-step doStream result that calls a tool and stops there (tool-calls finish reason).
function toolCallStreamResult(toolName: string, input: unknown) {
  return {
    stream: convertArrayToReadableStream([
      { type: "stream-start" as const, warnings: [] },
      { type: "tool-call" as const, toolCallId: "call-1", toolName, input: JSON.stringify(input) },
      { type: "finish" as const, usage: MOCK_USAGE, finishReason: { unified: "tool-calls" as const, raw: undefined } },
    ]),
  };
}

describe("streamStudioAgent", () => {
  it("includes the silent-grounding rule in the system prompt", async () => {
    const model = new MockLanguageModelV3({ doStream: textStreamResult("ok") });
    const response = await streamStudioAgent({
      messages: [{ id: "1", role: "user", parts: [{ type: "text", text: "hi" }] }],
      currentText: "",
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
        return [{ content: "Passage text", section: "3.2", resourceName: "ISO 27001.pdf" }];
      },
    });

    const model = new MockLanguageModelV3({
      doStream: [
        toolCallStreamResult("searchKnowledge", { query: "encryption at rest" }),
        textStreamResult("Updated the post using what I found."),
      ],
    });

    const response = await streamStudioAgent({
      messages: [{ id: "1", role: "user", parts: [{ type: "text", text: "write about encryption" }] }],
      currentText: "",
      handlers,
      model,
    });
    // Drain the stream so the tool executes and the loop completes.
    await response.text();

    expect(seenQuery).toBe("encryption at rest");
  });

  it("gives the persisted assistant turn a non-empty id (survives reload + merge-by-id)", async () => {
    // Regression: without generateMessageId, the AI SDK reconstructs the
    // response message with id "" on the server. That empty id collides in the
    // merge-by-id persistence and is filtered out on reload, so chat turns
    // vanished after refresh.
    const model = new MockLanguageModelV3({ doStream: textStreamResult("Done.") });
    let captured: UIMessage[] | null = null;
    let resolveFinish!: () => void;
    const finished = new Promise<void>((r) => (resolveFinish = r));
    const response = await streamStudioAgent({
      messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] }],
      currentText: "",
      handlers: noopHandlers(),
      model,
      onFinish: (messages) => {
        captured = messages;
        resolveFinish();
      },
    });
    await response.text();
    await finished;

    expect(captured).not.toBeNull();
    expect(captured!.every((m) => typeof m.id === "string" && m.id.length > 0)).toBe(true);
    const assistant = captured!.find((m) => m.role === "assistant");
    expect(assistant).toBeDefined();
    expect(assistant!.id.length).toBeGreaterThan(0);
  });
});
