// apps/api/src/routes/linkedin.test.ts
import { describe, it, expect } from "vitest";
import { signState, verifyState } from "../oauth-state.js";
import { parsePostUrn, cleanMetrics } from "./linkedin.js";

describe("oauth state", () => {
  it("round-trips a signed state", () => {
    const s = signState("user-1", "nonce-abc");
    expect(verifyState(s)).toEqual({ userId: "user-1" });
  });
  it("rejects a tampered state", () => {
    const s = signState("user-1", "nonce-abc");
    expect(verifyState(s.slice(0, -1) + "0")).toBeNull();
  });
  it("rejects malformed state", () => {
    expect(verifyState("garbage")).toBeNull();
  });
});

describe("parsePostUrn", () => {
  it("extracts the activity URN from a feed-update URL", () => {
    expect(parsePostUrn("https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678/")).toBe(
      "urn:li:activity:7123456789012345678",
    );
  });
  it("extracts from a /posts/ slug URL with -activity-<id>-", () => {
    expect(parsePostUrn("https://www.linkedin.com/posts/jane-doe_hiring-activity-7099887766554433221-abcd")).toBe(
      "urn:li:activity:7099887766554433221",
    );
  });
  it("handles a real share URL with a long slug and query string", () => {
    expect(
      parsePostUrn(
        "https://www.linkedin.com/posts/julian-koehn_schleswig-holstein-fast-80-prozent-der-microsoft-lizenzen-activity-7394823962708484096-pfHp?utm_source=share&utm_medium=member_desktop",
      ),
    ).toBe("urn:li:activity:7394823962708484096");
  });
  it("preserves an explicit ugcPost/share URN type", () => {
    expect(parsePostUrn("urn:li:ugcPost:12345678")).toBe("urn:li:ugcPost:12345678");
    expect(parsePostUrn("https://x/urn:li:share:999")).toBe("urn:li:share:999");
  });
  it("returns null for a URL without a post id and for undefined", () => {
    expect(parsePostUrn("https://www.linkedin.com/in/jane-doe")).toBeNull();
    expect(parsePostUrn(undefined)).toBeNull();
  });
});

describe("cleanMetrics", () => {
  it("coerces strings and drops empties", () => {
    expect(cleanMetrics({ impressions: "1,200", reactions: 34, comments: "" })).toEqual({
      impressions: 1200,
      reactions: 34,
    });
  });
  it("returns undefined when nothing usable is provided", () => {
    expect(cleanMetrics({ impressions: "", reactions: "abc" })).toBeUndefined();
    expect(cleanMetrics(undefined)).toBeUndefined();
  });
  it("rejects negatives", () => {
    expect(cleanMetrics({ reactions: -5 })).toBeUndefined();
  });
});
