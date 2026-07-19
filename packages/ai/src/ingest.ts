import { extractText as unpdfExtract } from "unpdf";
import { getEncoding } from "js-tiktoken";

const enc = getEncoding("cl100k_base");
const countTokens = (s: string) => enc.encode(s).length;

export async function extractText(bytes: Uint8Array, mimeType: string): Promise<string> {
  if (mimeType === "application/pdf") {
    const { text } = await unpdfExtract(bytes, { mergePages: true });
    return typeof text === "string" ? text : (text as string[]).join("\n\n");
  }
  return new TextDecoder().decode(bytes); // text/plain, text/markdown
}

export interface Chunk {
  ordinal: number;
  content: string;
  section: string | null;
  tokenCount: number;
}

// Split on headings (markdown #.., numbered §/clause lines), then pack each
// section's prose into ~targetTokens windows with overlap, carrying the heading.
const HEADING = /^(#{1,6}\s+.+|(§+\s*\d+[\w.\-]*.*)|(\d+(\.\d+){1,}\s+.+))$/;

export function chunkText(text: string, opts?: { targetTokens?: number; overlapTokens?: number }): Chunk[] {
  const target = opts?.targetTokens ?? 500;
  const overlap = opts?.overlapTokens ?? 80;
  const lines = text.split(/\r?\n/);
  const out: Chunk[] = [];
  let section: string | null = null;
  let buf: string[] = [];
  let ord = 0;
  const flush = () => {
    const body = buf.join("\n").trim();
    buf = [];
    if (!body) return;
    const words = body.split(/\s+/);
    let start = 0;
    while (start < words.length) {
      let end = start;
      let toks = 0;
      while (end < words.length && toks < target) {
        toks += countTokens(words[end]! + " ");
        end++;
      }
      const content = words.slice(start, end).join(" ");
      out.push({ ordinal: ord++, content, section, tokenCount: countTokens(content) });
      if (end >= words.length) break;
      // step back ~overlap tokens worth of words
      let back = 0;
      let w = end;
      while (w > start && back < overlap) {
        w--;
        back += countTokens(words[w]! + " ");
      }
      start = Math.max(w, start + 1);
    }
  };
  for (const line of lines) {
    if (HEADING.test(line.trim())) {
      flush();
      section = line.trim().replace(/^#{1,6}\s+/, "");
    } else {
      buf.push(line);
    }
  }
  flush();
  return out;
}
