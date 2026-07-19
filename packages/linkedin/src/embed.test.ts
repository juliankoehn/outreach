import { describe, it, expect } from "vitest";
import { extractEmbedUrl, parseEmbedHtml } from "./embed.js";

// Trimmed but faithful to LinkedIn's real embed markup (stable data-test-ids).
const FIXTURE = `
<html><head>
<meta property="og:title" content="#compliance … | Julian Koehn">
<meta property="og:image" content="https://media.licdn.com/dms/image/v2/abc/feedshare-shrink_800/x?e=123&amp;v=beta">
</head><body>
<div class="whitespace-pre-wrap break-words" dir="ltr" data-test-id="main-feed-activity-embed-card__commentary">IT baut Firewalls, der CISO produziert Papier.

Genau das passiert bei <a href="/feed/hashtag/compliance">#compliance</a> aus Checklisten &amp; Silodenken. „Schnell&#8221; schützt niemanden.</div>
<div data-test-id="social-actions__reaction-count" class="ml-0.5"> 16 </div>
<a data-test-id="social-actions__comments" data-num-comments="2" data-plural="%numComments% Comments">Comments</a>
</body></html>`;

describe("extractEmbedUrl", () => {
  it("pulls the embed URL out of a full iframe snippet", () => {
    const iframe =
      '<iframe src="https://www.linkedin.com/embed/feed/update/urn:li:share:7455670461985681408?collapsed=1" height="551"></iframe>';
    expect(extractEmbedUrl(iframe)).toBe(
      "https://www.linkedin.com/embed/feed/update/urn:li:share:7455670461985681408?collapsed=1",
    );
  });
  it("builds an embed URL from a bare URN", () => {
    expect(extractEmbedUrl("urn:li:ugcPost:12345678")).toBe(
      "https://www.linkedin.com/embed/feed/update/urn:li:ugcPost:12345678",
    );
  });
  it("decodes &amp; in a pasted embed URL", () => {
    expect(extractEmbedUrl("https://www.linkedin.com/embed/feed/update/urn:li:share:9?a=1&amp;b=2")).toBe(
      "https://www.linkedin.com/embed/feed/update/urn:li:share:9?a=1&b=2",
    );
  });
  it("returns null when there's no post reference", () => {
    expect(extractEmbedUrl("https://www.linkedin.com/in/julian-koehn")).toBeNull();
    expect(extractEmbedUrl("")).toBeNull();
  });
});

describe("parseEmbedHtml", () => {
  const parsed = parseEmbedHtml(FIXTURE);

  it("extracts the full post text with line breaks, stripped tags and decoded entities", () => {
    expect(parsed.text.startsWith("IT baut Firewalls, der CISO produziert Papier.")).toBe(true);
    expect(parsed.text).toContain("#compliance"); // hashtag link text kept
    expect(parsed.text).toContain("Checklisten & Silodenken"); // &amp; decoded
    expect(parsed.text).toContain("„Schnell”"); // &#8221; decoded
    expect(parsed.text).toContain("\n\n"); // paragraph break preserved
    expect(parsed.text).not.toContain("<"); // no markup left
  });

  it("reads the reaction and comment counts", () => {
    expect(parsed.reactions).toBe(16);
    expect(parsed.comments).toBe(2);
  });

  it("reads the og:image and decodes it, and classifies the media as image", () => {
    expect(parsed.imageUrl).toBe("https://media.licdn.com/dms/image/v2/abc/feedshare-shrink_800/x?e=123&v=beta");
    expect(parsed.mediaType).toBe("image");
  });

  it("classifies a document post as a carousel", () => {
    const doc = parseEmbedHtml(
      '<div data-test-id="main-feed-activity-embed-card__commentary">Slides</div><div data-test-id="feed-document-viewer"></div><a data-test-id="social-actions__comments" data-num-comments="0"></a>',
    );
    expect(doc.mediaType).toBe("carousel");
  });

  it("degrades gracefully on unrelated HTML", () => {
    const empty = parseEmbedHtml("<html><body>nope</body></html>");
    expect(empty.text).toBe("");
    expect(empty.reactions).toBeUndefined();
    expect(empty.comments).toBeUndefined();
  });
});
