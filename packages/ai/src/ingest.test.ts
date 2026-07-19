import { describe, it, expect } from "vitest";
import { chunkText } from "./ingest.js";

describe("chunkText", () => {
  it("splits by markdown/section heading and packs into token windows with a section label", () => {
    const md = "# Section One\n" + "word ".repeat(600) + "\n## Section Two\nshort tail";
    const chunks = chunkText(md, { targetTokens: 200, overlapTokens: 20 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]!.section).toContain("Section One");
    expect(chunks.at(-1)!.section).toContain("Section Two");
    expect(chunks.every((c) => c.tokenCount > 0)).toBe(true);
    expect(chunks.map((c, i) => c.ordinal === i).every(Boolean)).toBe(true);
  });
});
