// apps/api/src/images.test.ts
import { describe, it, expect } from "vitest";
import { saveImage } from "./images.js";
import { getObject } from "./storage.js";

describe("saveImage", () => {
  it("stores a base64 image in object storage and returns a /generated url", async () => {
    const b64 = Buffer.from([137, 80, 78, 71]).toString("base64");
    const { url } = await saveImage(b64, "image/png");
    expect(url).toMatch(/^\/generated\/[a-f0-9-]+\.png$/);
    const key = "generated/" + url.split("/").pop();
    expect(await getObject(key)).not.toBeNull();
  });
});
