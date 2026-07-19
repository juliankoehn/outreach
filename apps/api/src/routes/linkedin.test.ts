// apps/api/src/routes/linkedin.test.ts
import { describe, it, expect } from "vitest";
import { signState, verifyState } from "../oauth-state.js";
import { parsePostUrn, cleanMetrics, isPrivateOrLoopbackIp, isLinkedInHost } from "./linkedin.js";

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

describe("isLinkedInHost", () => {
  it("accepts linkedin.com and subdomains", () => {
    expect(isLinkedInHost("www.linkedin.com")).toBe(true);
    expect(isLinkedInHost("linkedin.com")).toBe(true);
    expect(isLinkedInHost("media.licdn.com.linkedin.com")).toBe(true);
  });
  it("rejects lookalike and unrelated hosts", () => {
    expect(isLinkedInHost("linkedin.com.evil.example")).toBe(false);
    expect(isLinkedInHost("evil-linkedin.com")).toBe(false);
    expect(isLinkedInHost("example.com")).toBe(false);
  });
});

describe("isPrivateOrLoopbackIp", () => {
  it("rejects IPv4 loopback, private, and link-local ranges", () => {
    expect(isPrivateOrLoopbackIp("127.0.0.1")).toBe(true);
    expect(isPrivateOrLoopbackIp("10.0.0.5")).toBe(true);
    expect(isPrivateOrLoopbackIp("172.16.0.1")).toBe(true);
    expect(isPrivateOrLoopbackIp("172.31.255.255")).toBe(true);
    expect(isPrivateOrLoopbackIp("192.168.1.1")).toBe(true);
    expect(isPrivateOrLoopbackIp("169.254.1.1")).toBe(true);
    expect(isPrivateOrLoopbackIp("0.0.0.0")).toBe(true);
  });
  it("rejects IPv6 loopback, unique-local, and link-local ranges", () => {
    expect(isPrivateOrLoopbackIp("::1")).toBe(true);
    expect(isPrivateOrLoopbackIp("fc00::1")).toBe(true);
    expect(isPrivateOrLoopbackIp("fd12:3456:789a::1")).toBe(true);
    expect(isPrivateOrLoopbackIp("fe80::1")).toBe(true);
  });
  it("rejects IPv4-mapped IPv6 private addresses", () => {
    expect(isPrivateOrLoopbackIp("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateOrLoopbackIp("::ffff:10.0.0.1")).toBe(true);
  });
  it("accepts normal public IPv4 and IPv6 addresses", () => {
    expect(isPrivateOrLoopbackIp("8.8.8.8")).toBe(false);
    expect(isPrivateOrLoopbackIp("172.15.0.1")).toBe(false);
    expect(isPrivateOrLoopbackIp("172.32.0.1")).toBe(false);
    expect(isPrivateOrLoopbackIp("2606:4700:4700::1111")).toBe(false);
  });
  it("rejects malformed addresses defensively", () => {
    expect(isPrivateOrLoopbackIp("not-an-ip")).toBe(true);
    expect(isPrivateOrLoopbackIp("999.1.1.1")).toBe(true);
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
