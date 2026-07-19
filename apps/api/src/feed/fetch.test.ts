// apps/api/src/feed/fetch.test.ts
import { describe, it, expect } from "vitest";
import { parseFeedXml } from "./fetch.js";

const RSS_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Example RSS Feed</title>
    <link>https://example.com</link>
    <item>
      <title>First Post</title>
      <link>https://example.com/first-post</link>
      <guid>https://example.com/first-post</guid>
      <description><![CDATA[<p>Some <b>bold</b> text with <a href="#">a link</a>.</p>]]></description>
      <pubDate>Mon, 01 Jan 2024 10:00:00 GMT</pubDate>
      <dc:creator xmlns:dc="http://purl.org/dc/elements/1.1/">Jane Doe</dc:creator>
    </item>
    <item>
      <title>No Guid Post</title>
      <link>https://example.com/no-guid</link>
      <description>${"x".repeat(600)}</description>
    </item>
    <item>
      <title>No Link Post</title>
      <description>This item has no link and must be dropped.</description>
    </item>
  </channel>
</rss>`;

const ATOM_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Example Atom Feed</title>
  <link href="https://example.org"/>
  <entry>
    <title>Atom Entry</title>
    <link href="https://example.org/entry-1"/>
    <id>urn:uuid:entry-1</id>
    <summary>Plain summary text.</summary>
    <updated>2024-02-02T12:00:00Z</updated>
    <author><name>John Smith</name></author>
  </entry>
</feed>`;

const MALICIOUS_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Malicious Feed</title>
    <item>
      <title>JS Link</title>
      <link>javascript:alert(document.cookie)</link>
      <description>Should be dropped.</description>
    </item>
    <item>
      <title>Safe item, bad image</title>
      <link>https://example.com/ok</link>
      <enclosure url="javascript:evil()" type="image/png"/>
      <description>Kept, but image nulled.</description>
    </item>
  </channel>
</rss>`;

describe("parseFeedXml", () => {
  it("drops items with a non-http(s) link and nulls a non-http(s) image (XSS guard)", async () => {
    const { items } = await parseFeedXml(MALICIOUS_FIXTURE, "https://example.com/feed.xml");
    expect(items.find((i) => i.title === "JS Link")).toBeUndefined(); // javascript: link filtered
    const safe = items.find((i) => i.title === "Safe item, bad image");
    expect(safe).toBeDefined();
    expect(safe!.url).toBe("https://example.com/ok");
    expect(safe!.imageUrl).toBeNull(); // javascript: enclosure dropped
  });

  it("maps an RSS feed's title and items", async () => {
    const { title, items } = await parseFeedXml(RSS_FIXTURE, "https://example.com/feed.xml");
    expect(title).toBe("Example RSS Feed");
    expect(items).toHaveLength(2); // the link-less item is dropped

    const first = items[0]!;
    expect(first.guid).toBe("https://example.com/first-post");
    expect(first.title).toBe("First Post");
    expect(first.url).toBe("https://example.com/first-post");
    expect(first.excerpt).toBe("Some bold text with a link.");
    expect(first.author).toBe("Jane Doe");
    expect(first.publishedAt).toBeInstanceOf(Date);
  });

  it("truncates long excerpts, strips HTML, and falls back guid -> link when no guid is given", async () => {
    const { items } = await parseFeedXml(RSS_FIXTURE, "https://example.com/feed.xml");
    const second = items[1]!;
    expect(second.excerpt.length).toBeLessThanOrEqual(501); // 500 chars + ellipsis
    expect(second.excerpt.endsWith("…")).toBe(true);
    expect(second.guid).toBe(second.url); // no <guid> in the fixture -> falls back to the link
  });

  it("drops items with no resolvable link", async () => {
    const { items } = await parseFeedXml(RSS_FIXTURE, "https://example.com/feed.xml");
    expect(items.find((i) => i.title === "No Link Post")).toBeUndefined();
  });

  it("maps an Atom feed and falls back guid -> link (rss-parser doesn't surface Atom <id> as guid)", async () => {
    const { title, items } = await parseFeedXml(ATOM_FIXTURE, "https://example.org/feed.xml");
    expect(title).toBe("Example Atom Feed");
    expect(items).toHaveLength(1);
    const entry = items[0]!;
    expect(entry.url).toBe("https://example.org/entry-1");
    expect(entry.guid).toBe(entry.url);
    expect(entry.excerpt).toBe("Plain summary text.");
    expect(entry.author).toBe("John Smith");
  });
});
