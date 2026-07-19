// apps/api/src/feed/fetch.ts
import Parser from "rss-parser";
import TurndownService from "turndown";
import { safeFetchText } from "../net.js";
import type { ParsedItem } from "../repos/feed.js";

const parser = new Parser();
const stripHtml = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const truncate = (s: string, n = 500) => (s.length > n ? s.slice(0, n).trimEnd() + "…" : s);

// Turndown drops <script>/<style>/<head> by default; the resulting Markdown is
// rendered through a sanitizing renderer on the client (react-markdown strips
// javascript:/data: hrefs), so the reader pane stays safe.
const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
// Scrub link/image URLs at the source: a feed's <a href="javascript:…"> must
// never survive into the stored Markdown. Only http(s) URLs are emitted.
const getAttr = (node: unknown, name: string): string => (node as { getAttribute?(n: string): string | null }).getAttribute?.(name) ?? "";
turndown.addRule("safeLink", {
  filter: "a",
  replacement: (content, node) => {
    const href = httpOnly(getAttr(node, "href"));
    return href ? `[${content}](${href})` : content;
  },
});
turndown.addRule("safeImage", {
  filter: "img",
  replacement: (_content, node) => {
    const src = httpOnly(getAttr(node, "src"));
    return src ? `![${getAttr(node, "alt")}](${src})` : "";
  },
});
function htmlToMarkdown(html: string, max = 8000): string | null {
  const h = html.trim();
  if (!h) return null;
  let md = "";
  try {
    md = turndown.turndown(h).replace(/\n{3,}/g, "\n\n").trim();
  } catch {
    md = "";
  }
  if (!md) return null;
  return md.length > max ? md.slice(0, max).trimEnd() + "\n\n…" : md;
}

// Feed content is attacker-controllable — a malicious feed could carry a
// `javascript:`/`data:` link that becomes stored XSS in an <a href>/<img src>.
// Only persist http(s) URLs; everything else becomes empty/null.
function httpOnly(u: string | undefined | null): string {
  if (!u) return "";
  try {
    const p = new URL(u);
    return p.protocol === "http:" || p.protocol === "https:" ? u : "";
  } catch {
    return "";
  }
}

function cryptoRandom(): string {
	return globalThis.crypto.randomUUID();
}

/**
 * Pure XML -> { title, items } mapping, split out from `fetchFeed` so it can
 * be unit-tested against static RSS/Atom fixtures without a network fetch.
 */
export async function parseFeedXml(xml: string, sourceUrl: string): Promise<{ title: string; items: ParsedItem[] }> {
	const feed = await parser.parseString(xml);
	const items: ParsedItem[] = (feed.items ?? [])
		.map((i) => {
			const link = httpOnly(i.link);
			const raw = i.contentSnippet ?? i.content ?? i.summary ?? "";
			const enclosure = httpOnly(i.enclosure?.url);
			return {
				guid: i.guid ?? link ?? i.title ?? cryptoRandom(),
				title: (i.title ?? "Untitled").trim(),
				url: link,
				excerpt: truncate(stripHtml(String(raw))),
				content: htmlToMarkdown(String(i.content ?? i.summary ?? "")),
				imageUrl: enclosure || null,
				author: i.creator ?? (i as { author?: string }).author ?? null,
				publishedAt: i.isoDate ? new Date(i.isoDate) : null,
			};
		})
		.filter((i) => i.url); // an item with no link can't be opened/deduped reliably
	return { title: (feed.title ?? sourceUrl).trim(), items };
}

export async function fetchFeed(url: string): Promise<{ title: string; items: ParsedItem[] }> {
	const xml = await safeFetchText(url);
	return parseFeedXml(xml, url);
}
