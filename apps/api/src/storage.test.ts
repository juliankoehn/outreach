import { describe, it, expect } from "vitest";
import { putObject, getObject, deleteObject } from "./storage.js";

describe("storage", () => {
  it("round-trips an object and deletes it", async () => {
    const key = `test/${Date.now()}-${Math.random().toString(36).slice(2)}.txt`;
    const body = Buffer.from("hello resources");
    await putObject(key, body, "text/plain");

    const got = await getObject(key);
    expect(got).not.toBeNull();
    expect(Buffer.from(got!.body).toString()).toBe("hello resources");
    expect(got!.contentType).toBe("text/plain");

    await deleteObject(key);
    expect(await getObject(key)).toBeNull();
  });
});
