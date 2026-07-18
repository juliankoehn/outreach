// apps/api/src/images.test.ts
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { saveImage } from "./images.js";

describe("saveImage", () => {
  it("writes base64 bytes and returns a /uploads url", async () => {
    const base64 = Buffer.from("hello-png").toString("base64");
    const { url, path } = await saveImage(base64, "image/png");
    expect(url).toMatch(/^\/uploads\/[a-z0-9]+\.png$/);
    expect((await readFile(path)).toString()).toBe("hello-png");
  });
});
