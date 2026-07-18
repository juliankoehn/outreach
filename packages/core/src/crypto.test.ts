import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "./crypto.js";
import { randomBytes } from "node:crypto";

const key = randomBytes(32).toString("base64");

describe("crypto", () => {
  it("round-trips a secret", () => {
    const token = "ya29.super-secret-token";
    expect(decrypt(encrypt(token, key), key)).toBe(token);
  });

  it("produces different ciphertext each call (random IV)", () => {
    expect(encrypt("x", key)).not.toBe(encrypt("x", key));
  });

  it("rejects a tampered payload", () => {
    const enc = encrypt("x", key);
    const tampered = enc.slice(0, -2) + (enc.endsWith("A") ? "B" : "A") + enc.slice(-1);
    expect(() => decrypt(tampered, key)).toThrow();
  });

  it("rejects a wrong-length key", () => {
    expect(() => encrypt("x", "c2hvcnQ=")).toThrow(/32 bytes/);
  });
});
