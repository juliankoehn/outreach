// Parse a LinkedIn post from its public "embed" widget. Given the iframe snippet
// (or the embed URL / a bare URN) a creator copies from LinkedIn's "Embed this
// post" menu, we fetch the public embed HTML and pull out the post text plus the
// visible social counts. Impressions are never on the embed (owner-only), so they
// stay out. The markup is matched on stable `data-test-id` attributes rather than
// styling classes, but embed HTML can still change — treat results as best-effort.

export type EmbedMediaType = "none" | "image" | "video" | "article" | "carousel";

export interface ParsedEmbedPost {
  text: string;
  reactions?: number;
  comments?: number;
  imageUrl?: string;
  mediaType: EmbedMediaType;
}

/**
 * Turn whatever the creator pasted (full `<iframe …>` tag, a bare embed URL, or
 * just a `urn:li:…`) into a canonical embed URL we can fetch. Returns null if no
 * LinkedIn post reference is found.
 */
export function extractEmbedUrl(input: string): string | null {
  if (!input) return null;
  const s = input.trim();
  const fromSrc = s.match(/src\s*=\s*["']([^"']+)["']/i)?.[1];
  const candidate = (fromSrc ?? s).replace(/&amp;/g, "&");

  const embed = candidate.match(/https?:\/\/[^\s"']*linkedin\.com\/embed\/feed\/update\/[^\s"']+/i)?.[0];
  if (embed) return embed;

  const urn = candidate.match(/urn:li:(?:activity|ugcPost|share):\d+/)?.[0];
  if (urn) return `https://www.linkedin.com/embed/feed/update/${urn}`;

  return null;
}

/** Extract the post's fields from fetched embed HTML. */
export function parseEmbedHtml(html: string): ParsedEmbedPost {
  const imageUrl = html
    .match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1]
    ?.replace(/&amp;/g, "&");
  return {
    text: extractCommentary(html),
    reactions: firstNumber(html.match(/social-actions__reaction-count["'][^>]*>\s*([\d.,\s]+?)\s*</)?.[1]),
    comments: firstNumber(html.match(/data-num-comments\s*=\s*["'](\d+)["']/)?.[1]),
    imageUrl,
    mediaType: detectMedia(html, imageUrl),
  };
}

// Best-effort media classification. The image path is solid (og:image); video /
// document(carousel) / article rely on markers LinkedIn uses in the embed and
// should be treated as hints, not guarantees.
function detectMedia(html: string, imageUrl?: string): EmbedMediaType {
  if (/property=["']og:video["']/i.test(html) || /data-test-id=["'][^"']*video/i.test(html)) return "video";
  if (/data-test-id=["'][^"']*(?:document|carousel|native-document)/i.test(html) || /\bdocument-viewer\b/i.test(html))
    return "carousel";
  if (/data-test-id=["'][^"']*article/i.test(html) || /feed-shared-article|article-component/i.test(html))
    return "article";
  return imageUrl ? "image" : "none";
}

function extractCommentary(html: string): string {
  const marker = html.indexOf("main-feed-activity-embed-card__commentary");
  if (marker < 0) return "";
  const open = html.indexOf(">", marker);
  if (open < 0) return "";
  const rest = html.slice(open + 1);
  // The social-actions / meta block follows the commentary; cut at the start of
  // its opening tag (not mid-attribute, which would leave a dangling `<div`).
  const at = rest.search(/data-test-id=["'](?:social-actions|main-feed-activity-embed-card__meta)/);
  let end = 8000;
  if (at > 0) end = Math.max(rest.lastIndexOf("<", at), 0) || at;
  return stripHtml(rest.slice(0, end));
}

function stripHtml(fragment: string): string {
  return decodeEntities(
    fragment
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/<[^>]*$/g, ""), // drop any dangling partial tag at the very end
  )
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d: string) => safeCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => safeCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, name: string) => NAMED[name.toLowerCase()] ?? m);
}

function safeCodePoint(cp: number): string {
  try {
    return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
  } catch {
    return "";
  }
}

function firstNumber(raw?: string): number | undefined {
  if (!raw) return undefined;
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return undefined;
  const n = Number(digits);
  return Number.isFinite(n) ? n : undefined;
}
