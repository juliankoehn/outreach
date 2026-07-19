import { describe, it, expect } from "vitest";
import { draftPost, refinePost, reviewPost, rewriteForReview, generateImage } from "./compose.js";
import { recordingModel, textModel, imageModel, MockImageModel } from "./testing.js";

describe("compose", () => {
  it("drafts a post using the brandBrief as system context", async () => {
    const { model, calls } = recordingModel("Here's a hook...\n\nBody.");
    const out = await draftPost("Write as Julian, a GRC founder.", { topic: "AI governance", model });
    expect(out).toMatch(/hook/i);
    const sys = calls[0]!.prompt.find((m) => m.role === "system");
    expect(JSON.stringify(sys)).toContain("GRC founder");
    expect(JSON.stringify(calls[0]!.prompt)).toContain("AI governance");
  });

  it("refines a post from the current text + instruction, keeping the voice", async () => {
    const { model, calls } = recordingModel("Punchier hook.\n\nBody.");
    const out = await refinePost("Write as Julian.", "Original post.", "Make the hook punchier", { model });
    expect(out).toMatch(/punchier/i);
    const prompt = JSON.stringify(calls[0]!.prompt);
    expect(prompt).toContain("Original post.");
    expect(prompt).toContain("Make the hook punchier");
  });

  it("generates an image and returns base64 + mediaType", async () => {
    const img = await generateImage("a minimalist poster", { model: imageModel("aGVsbG8=") });
    expect(img.base64).toBe("aGVsbG8=");
    expect(img.mediaType).toMatch(/image\//);
  });

  it("reviewPost passes a clean post with no issues", async () => {
    const model = textModel(JSON.stringify({ verdict: "pass", issues: [] }));
    const r = await reviewPost({ text: "Clean, specific post.", model });
    expect(r.verdict).toBe("pass");
    expect(r.issues).toEqual([]);
  });

  it("reviewPost flags a bloated post with concrete defects, seeing the brief + no-gos", async () => {
    const model = textModel(JSON.stringify({ verdict: "revise", issues: ["corporate bloat: 'strategischer Vorteil'"] }));
    const r = await reviewPost({
      text: "Hier liegt unser strategischer Vorteil.",
      brandBrief: "Write as Julian, informal du.",
      noGos: ["Emojis"],
      model,
    });
    expect(r.verdict).toBe("revise");
    expect(r.issues[0]).toContain("corporate bloat");
  });

  it("reviewPost short-circuits empty text without calling a model", async () => {
    const r = await reviewPost({ text: "   " });
    expect(r.verdict).toBe("pass");
    expect(r.issues).toEqual([]);
  });

  it("rewriteForReview rewrites against the editor's issue list, keeping the voice", async () => {
    const { model, calls } = recordingModel("Tighter, concrete post.");
    const out = await rewriteForReview({
      text: "Hier liegt unser strategischer Vorteil.",
      issues: ["corporate bloat: 'strategischer Vorteil'", "no concrete value"],
      brandBrief: "Write as Julian, informal du.",
      model,
    });
    expect(out).toBe("Tighter, concrete post.");
    const prompt = JSON.stringify(calls[0]!.prompt);
    expect(prompt).toContain("strategischer Vorteil");
    expect(prompt).toContain("no concrete value");
  });

  it("maps size to LinkedIn dimensions and injects the reference hint", async () => {
    let seenSize: string | undefined,
      seenPrompt = "";
    const model = new MockImageModel(({ size, prompt }) => {
      seenSize = size;
      seenPrompt = prompt;
    });
    await generateImage("a shield", { model, size: "portrait", referenceHint: "short dark hair, navy blazer" });
    expect(seenSize).toBe("1024x1536");
    expect(seenPrompt).toContain("short dark hair");
  });
});
