// apps/api/src/routes/linkedin.test.ts
import { describe, it, expect } from "vitest";
import { signState, verifyState } from "../oauth-state.js";

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
