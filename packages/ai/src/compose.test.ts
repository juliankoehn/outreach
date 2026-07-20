import { describe, it, expect } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { draftPost, refinePost, reviewPost, rewriteForReview, composeImageBrief, reviewImageBrief, generateImage } from "./compose.js";
import { recordingModel, textModel, textResult, imageModel, MockImageModel } from "./testing.js";

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

  it("reviewImageBrief passes a believable real-world scene", async () => {
    const model = textModel(JSON.stringify({ verdict: "pass", issues: [] }));
    const r = await reviewImageBrief("An engineer at a workstation in a server room, natural window light.", { model });
    expect(r.verdict).toBe("pass");
  });

  it("reviewImageBrief flags glowing-symbol AI-slop", async () => {
    const model = textModel(JSON.stringify({ verdict: "revise", issues: ["glowing holographic padlock made of hexagons"] }));
    const r = await reviewImageBrief("A glowing holographic padlock of hexagons floats in a neon server room.", { model });
    expect(r.verdict).toBe("revise");
    expect(r.issues[0]).toContain("padlock");
  });

  it("composeImageBrief runs the guard and returns a brief once it passes", async () => {
    // One model serves both the brief writer (generateText) and the guard
    // (generateObject); tell them apart by the guard's prompt marker.
    const model = new MockLanguageModelV3({
      doGenerate: async (options) => {
        const isReview = JSON.stringify(options.prompt).includes("Image brief to check");
        return isReview
          ? textResult(JSON.stringify({ verdict: "pass", issues: [] }))
          : textResult("A photographer's shot of a data-center aisle at night, one engineer walking between the racks.");
      },
    });
    const brief = await composeImageBrief({ postText: "about exposed servers", model });
    expect(brief).toContain("data-center");
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

import { VISUAL_PRESETS, visualPresetPrompt, composeVisualLanguage } from "./compose.js";

describe("composeVisualLanguage", () => {
  it("returns empty string when nothing is set", () => {
    expect(composeVisualLanguage({})).toBe("");
    expect(composeVisualLanguage({ preset: null, direction: "", derived: "" })).toBe("");
  });

  it("resolves a known preset id to its prompt fragment", () => {
    expect(visualPresetPrompt("natural")).toMatch(/documentary/i);
    expect(VISUAL_PRESETS.every((p) => p.prompt.trim().length > 0)).toBe(true);
  });

  it("ignores an unknown preset id", () => {
    expect(visualPresetPrompt("midjourney")).toBe("");
    expect(composeVisualLanguage({ preset: "midjourney" })).toBe("");
  });

  it("uses only the free-text direction when no preset", () => {
    expect(composeVisualLanguage({ direction: "warm daylight" })).toBe("warm daylight");
  });

  it("combines preset and direction", () => {
    const out = composeVisualLanguage({ preset: "monochrome", direction: "high contrast" });
    expect(out).toMatch(/black-and-white/i);
    expect(out).toContain("high contrast");
  });

  it("puts the manual direction before the derived style and marks it priority", () => {
    const out = composeVisualLanguage({ preset: "natural", derived: "warm glossy studio shots" });
    const priorityIdx = out.indexOf("takes priority");
    const derivedIdx = out.indexOf("warm glossy studio shots");
    expect(priorityIdx).toBeGreaterThan(-1);
    expect(derivedIdx).toBeGreaterThan(priorityIdx);
  });

  it("falls back to derived alone when no manual setting", () => {
    expect(composeVisualLanguage({ derived: "muted editorial" })).toBe("muted editorial");
  });
});
