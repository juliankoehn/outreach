import { describe, it, expect } from "vitest";
import { createApp } from "./app.js";

describe("api app", () => {
  it("serves /health", async () => {
    const app = createApp();
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("rejects an unauthenticated protected route", async () => {
    const app = createApp();
    const res = await app.request("/linkedin/accounts");
    expect(res.status).toBe(401);
  });
});
