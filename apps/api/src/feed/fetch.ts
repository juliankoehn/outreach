// apps/api/src/feed/fetch.ts
import Parser from "rss-parser";
import { safeFetchText } from "../net.js";
import type { ParsedItem } from "../repos/feed.js";

const parser = new Parser();
const stripHtml = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const truncate = (s: string, n = 500) => (s.length > n ? s.slice(0, n).trimEnd() + "…" : s);

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
