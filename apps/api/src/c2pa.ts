// Minimal, dependency-free reader for the C2PA Content Credentials that image
// models (Google Gemini / "Nano Banana", OpenAI) embed in generated images —
// enough to SHOW the credential (the generator name + whether it's AI), the same
// info LinkedIn surfaces. It does NOT verify the signature; for that you need the
// full c2pa toolkit. We only ever read our own generated files, and the manifest
// fields we read are standard C2PA (`claim_generator_info.name`, the
// `trainedAlgorithmicMedia` digital-source type), so it generalises across
// providers.

export interface ContentCredentials {
  present: boolean; // the image carries a C2PA manifest
  aiGenerated: boolean; // declared as trained-algorithmic (AI) media
  generator: string | null; // claim_generator_info.name, e.g. "Google C2PA Core Generator Library"
}

const NONE: ContentCredentials = { present: false, aiGenerated: false, generator: null };

// Read a CBOR text string (major type 3) at `o`; returns its text or null.
function readCborText(buf: Buffer, o: number): string | null {
  const b = buf[o];
  if (b === undefined || b >> 5 !== 3) return null;
  const ai = b & 0x1f;
  let len: number;
  let start: number;
  if (ai < 24) {
    len = ai;
    start = o + 1;
  } else if (ai === 24) {
    len = buf[o + 1] ?? -1;
    start = o + 2;
  } else if (ai === 25) {
    len = ((buf[o + 1] ?? 0) << 8) | (buf[o + 2] ?? 0);
    start = o + 3;
  } else {
    return null;
  }
  if (len < 0 || start + len > buf.length) return null;
  return buf.toString("utf8", start, start + len);
}

// The claim generator's display name: find the standard `claim_generator_info`
// field, then the `name` text key that follows, and decode its value.
function extractGenerator(buf: Buffer): string | null {
  const marker = buf.indexOf(Buffer.from("claim_generator_info", "latin1"));
  if (marker === -1) return null;
  const nameKey = Buffer.from([0x64, 0x6e, 0x61, 0x6d, 0x65]); // CBOR text(4) "name"
  const at = buf.indexOf(nameKey, marker);
  if (at === -1) return null;
  return readCborText(buf, at + nameKey.length);
}

export function readContentCredentials(bytes: Uint8Array): ContentCredentials {
  const buf = Buffer.from(bytes);
  const hay = buf.toString("latin1");
  const present = hay.includes("c2pa") || hay.includes("jumbf") || hay.includes("claim_generator");
  if (!present) return NONE;
  const aiGenerated =
    hay.includes("trainedAlgorithmicMedia") ||
    hay.includes("compositeWithTrainedAlgorithmicMedia") ||
    /generative ai/i.test(hay);
  return { present: true, aiGenerated, generator: extractGenerator(buf) };
}
