// packages/linkedin/src/csv-ingestor.test.ts
import { describe, it, expect } from "vitest";
import { CsvShareIngestor } from "./csv-ingestor.js";

// LinkedIn export columns: Date,ShareLink,ShareCommentary,SharedUrl,MediaUrl,Visibility
const csv = `Date,ShareLink,ShareCommentary,SharedUrl,MediaUrl,Visibility
2025-03-01 10:00:00,https://www.linkedin.com/feed/update/urn:li:share:111,"Hello world, my first post",,,MEMBER_NETWORK
2025-03-02 09:00:00,https://www.linkedin.com/feed/update/urn:li:share:222,"With an image",,https://media/img.png,MEMBER_NETWORK
bad-row-without-enough-columns`;

describe("CsvShareIngestor", () => {
  it("parses shares into RawPosts", async () => {
    const ing = new CsvShareIngestor(csv);
    const posts = await ing.fetch();
    expect(posts).toHaveLength(2);
    expect(posts[0]!.text).toBe("Hello world, my first post");
    expect(posts[0]!.externalId).toBe("urn:li:share:111");
    expect(posts[0]!.mediaType).toBe("none");
    expect(posts[1]!.mediaType).toBe("image");
    expect(posts[0]!.publishedAt.toISOString()).toBe("2025-03-01T10:00:00.000Z");
  });

  it("skips malformed rows and reports the count", async () => {
    const ing = new CsvShareIngestor(csv);
    await ing.fetch();
    expect(ing.skipped).toBe(1);
  });
});
