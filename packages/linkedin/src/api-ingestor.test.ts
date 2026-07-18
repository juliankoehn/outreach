import { describe, it, expect, vi } from "vitest";
import { LinkedInApiIngestor } from "./api-ingestor.js";
import { LinkedInReadUnavailableError } from "./ingestor.js";

const cfg = { accessToken: "AT", memberUrn: "urn:li:person:abc" };

describe("LinkedInApiIngestor", () => {
  it("maps API posts to RawPosts", async () => {
    const body = {
      elements: [
        { id: "urn:li:share:1", commentary: "Post one", createdAt: 1710000000000, content: {} },
        { id: "urn:li:share:2", commentary: "Post two", createdAt: 1710100000000, content: { media: { id: "x" } } },
      ],
    };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
    const posts = await new LinkedInApiIngestor({ ...cfg, fetchImpl }).fetch();
    expect(posts).toHaveLength(2);
    expect(posts[0]!.externalId).toBe("urn:li:share:1");
    expect(posts[0]!.text).toBe("Post one");
    expect(posts[1]!.mediaType).toBe("image");
  });

  it("throws LinkedInReadUnavailableError on 403", async () => {
    const fetchImpl = vi.fn(async () => new Response("denied", { status: 403 })) as unknown as typeof fetch;
    await expect(new LinkedInApiIngestor({ ...cfg, fetchImpl }).fetch())
      .rejects.toBeInstanceOf(LinkedInReadUnavailableError);
  });

  it("throws a generic error on other failures", async () => {
    const fetchImpl = vi.fn(async () => new Response("oops", { status: 500 })) as unknown as typeof fetch;
    await expect(new LinkedInApiIngestor({ ...cfg, fetchImpl }).fetch()).rejects.toThrow(/500/);
  });
});
