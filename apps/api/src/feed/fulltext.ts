// apps/api/src/feed/fulltext.ts
import { extractFromHtml } from "@extractus/article-extractor";
import { safeFetchText } from "../net.js";
import { htmlToMarkdown } from "./fetch.js";

// RSS feeds usually carry only a teaser. When the user opens an article we fetch
// the page itself (SSRF-guarded, same browser UA), run readability extraction
// (which also sanitizes the HTML), and convert the main body to Markdown — the
// same URL-scrubbing turndown pipeline used at ingestion, so it stays XSS-safe.
export async function extractFullText(url: string): Promise<string | null> {
  try {
    const html = await safeFetchText(url, { maxBytes: 8_000_000 });
    const article = await extractFromHtml(html, url);
    const content = article?.content?.trim();
    if (!content) return null;
    return htmlToMarkdown(content, 24_000);
  } catch {
    return null;
  }
}
