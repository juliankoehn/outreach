import { describe, it, expect } from "vitest";
import { apiUrl } from "./api.js";

describe("apiUrl", () => {
  it("joins the API base with a path", () => {
    expect(apiUrl("http://api:8787", "/linkedin/accounts")).toBe("http://api:8787/linkedin/accounts");
  });
  it("normalizes a missing leading slash", () => {
    expect(apiUrl("http://api:8787", "health")).toBe("http://api:8787/health");
  });
});
