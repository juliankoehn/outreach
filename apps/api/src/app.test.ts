import { describe, it, expect } from "vitest";
import { createApp } from "./app.js";
import { saveImage } from "./images.js";

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

  it("serves a saved generated image publicly, without auth", async () => {
    const app = createApp();
    const { url } = await saveImage(Buffer.from("pixel-bytes").toString("base64"), "image/png");
    const res = await app.request(url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("pixel-bytes");
  });

  it("404s an unknown generated image and rejects path traversal", async () => {
    const app = createApp();
    expect((await app.request("/generated/does-not-exist.png")).status).toBe(404);
    expect((await app.request("/generated/..%2Fapp.ts")).status).toBe(404);
  });
});
