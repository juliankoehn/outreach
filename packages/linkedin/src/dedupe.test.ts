import { describe, it, expect } from "vitest";
import { hashPost, dedupeKey } from "./dedupe.js";
import type { RawPost } from "@outreach/core";

const base: RawPost = { externalId: null, text: "hello", mediaType: "none", publishedAt: new Date("2025-01-01T00:00:00Z"), raw: {} };

describe("dedupe", () => {
  it("hashPost is stable for same input", () => {
    expect(hashPost("hello", new Date("2025-01-01T00:00:00Z")))
      .toBe(hashPost("hello", new Date("2025-01-01T00:00:00Z")));
  });
  it("hashPost differs for different text", () => {
    expect(hashPost("a", base.publishedAt)).not.toBe(hashPost("b", base.publishedAt));
  });
  it("dedupeKey prefers externalId", () => {
    expect(dedupeKey({ ...base, externalId: "urn:li:share:99" })).toBe("urn:li:share:99");
  });
  it("dedupeKey falls back to content hash", () => {
    expect(dedupeKey(base)).toBe(hashPost("hello", base.publishedAt));
  });
});
