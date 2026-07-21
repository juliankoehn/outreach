import { describe, it, expect } from "vitest";
import { readContentCredentials } from "./c2pa.js";

// Build a minimal blob that mimics the C2PA fields we scan for: the
// `claim_generator_info` marker, a CBOR text key `name` + value, and the
// trained-algorithmic-media source type.
function fakeC2pa(generator: string, ai = true): Buffer {
  const nameKey = Buffer.from([0x64, 0x6e, 0x61, 0x6d, 0x65]); // text(4) "name"
  const g = Buffer.from(generator, "utf8");
  const nameVal = Buffer.concat([Buffer.from([0x78, g.length]), g]); // text, 1-byte len
  return Buffer.concat([
    Buffer.from("....jumbf...c2pa....claim_generator_info", "latin1"),
    nameKey,
    nameVal,
    Buffer.from(ai ? "...trainedAlgorithmicMedia..." : "...", "latin1"),
  ]);
}

describe("readContentCredentials", () => {
  it("returns not-present for a plain image", () => {
    expect(readContentCredentials(Buffer.from("plain jpeg bytes"))).toEqual({
      present: false,
      aiGenerated: false,
      generator: null,
    });
  });

  it("extracts the generator name and AI flag from a C2PA manifest", () => {
    const cred = readContentCredentials(fakeC2pa("Google C2PA Core Generator Library"));
    expect(cred.present).toBe(true);
    expect(cred.aiGenerated).toBe(true);
    expect(cred.generator).toBe("Google C2PA Core Generator Library");
  });

  it("marks present but not AI when no algorithmic-media type is declared", () => {
    const cred = readContentCredentials(fakeC2pa("Some Camera App", false));
    expect(cred.present).toBe(true);
    expect(cred.aiGenerated).toBe(false);
    expect(cred.generator).toBe("Some Camera App");
  });
});
