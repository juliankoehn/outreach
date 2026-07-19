import { describe, it, expect, vi } from "vitest";
import { LinkedInPublishClient, LinkedInPublishError } from "./publish.js";

describe("LinkedInPublishClient", () => {
  it("uploadImage initializes the upload, PUTs the bytes, and resolves the image URN", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init: init ?? {} });
      if (calls.length === 1) {
        return new Response(
          JSON.stringify({ value: { uploadUrl: "https://up", image: "urn:li:image:1" } }),
          { status: 200 },
        );
      }
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;

    const client = new LinkedInPublishClient({ accessToken: "AT", fetchImpl });
    const bytes = new Uint8Array([1, 2, 3]);
    const urn = await client.uploadImage("urn:li:person:1", bytes, "image/png");

    expect(urn).toBe("urn:li:image:1");
    expect(calls[0]!.url).toContain("/images?action=initializeUpload");
    expect(calls[0]!.init.method).toBe("POST");
    const initBody = JSON.parse(calls[0]!.init.body as string);
    expect(initBody).toEqual({ initializeUploadRequest: { owner: "urn:li:person:1" } });

    expect(calls[1]!.url).toBe("https://up");
    expect(calls[1]!.init.method).toBe("PUT");
    expect(calls[1]!.init.body).toBe(bytes);
  });

  it("createPost with no image POSTs /posts and resolves the post URN", async () => {
    let capturedInit: RequestInit | undefined;
    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      expect(String(input)).toContain("/posts");
      capturedInit = init;
      return new Response(null, { status: 201, headers: { "x-restli-id": "urn:li:share:123" } });
    }) as unknown as typeof fetch;

    const client = new LinkedInPublishClient({ accessToken: "AT", fetchImpl });
    const urn = await client.createPost({ authorUrn: "urn:li:person:1", text: "hello" });

    expect(urn).toBe("urn:li:share:123");
    const body = JSON.parse(capturedInit!.body as string);
    expect(body.author).toBe("urn:li:person:1");
    expect(body.commentary).toBe("hello");
    expect(body.lifecycleState).toBe("PUBLISHED");
    expect(body.visibility).toBe("PUBLIC");
    expect(body.content).toBeUndefined();
  });

  it("createPost with imageUrn includes content.media.id", async () => {
    let capturedInit: RequestInit | undefined;
    const fetchImpl = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      capturedInit = init;
      return new Response(null, { status: 201, headers: { "x-restli-id": "urn:li:share:456" } });
    }) as unknown as typeof fetch;

    const client = new LinkedInPublishClient({ accessToken: "AT", fetchImpl });
    await client.createPost({
      authorUrn: "urn:li:person:1",
      text: "hello",
      imageUrn: "urn:li:image:1",
    });

    const body = JSON.parse(capturedInit!.body as string);
    expect(body.content.media.id).toBe("urn:li:image:1");
  });

  it("addComment POSTs /socialActions/<encoded urn>/comments", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;

    const client = new LinkedInPublishClient({ accessToken: "AT", fetchImpl });
    await client.addComment("urn:li:share:123", "urn:li:person:1", "nice post");

    expect(capturedUrl).toBe(
      `https://api.linkedin.com/rest/socialActions/${encodeURIComponent("urn:li:share:123")}/comments`,
    );
    const body = JSON.parse(capturedInit!.body as string);
    expect(body.actor).toBe("urn:li:person:1");
    expect(body.object).toBe("urn:li:share:123");
    expect(body.message.text).toBe("nice post");
  });

  it("throws LinkedInPublishError with status 401 when /posts returns 401", async () => {
    const fetchImpl = vi.fn(async () => new Response("unauthorized", { status: 401 })) as unknown as typeof fetch;
    const client = new LinkedInPublishClient({ accessToken: "AT", fetchImpl });

    await expect(
      client.createPost({ authorUrn: "urn:li:person:1", text: "hello" }),
    ).rejects.toMatchObject(
      expect.objectContaining({ status: 401 }) as Partial<LinkedInPublishError>,
    );

    await expect(
      client.createPost({ authorUrn: "urn:li:person:1", text: "hello" }),
    ).rejects.toBeInstanceOf(LinkedInPublishError);
  });
});
