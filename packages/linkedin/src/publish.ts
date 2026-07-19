/**
 * LinkedIn publish client: image upload + post creation + comments via the
 * Posts / Images / Social Actions REST APIs.
 */

const BASE = "https://api.linkedin.com/rest";

export class LinkedInPublishError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "LinkedInPublishError";
  }
}

interface Config {
  accessToken: string;
  apiVersion?: string;
  fetchImpl?: typeof fetch;
}

export class LinkedInPublishClient {
  private readonly fetch: typeof fetch;
  private readonly apiVersion: string;
  constructor(private readonly cfg: Config) {
    this.fetch = cfg.fetchImpl ?? fetch;
    this.apiVersion = cfg.apiVersion ?? "202601";
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: `Bearer ${this.cfg.accessToken}`,
      "LinkedIn-Version": this.apiVersion,
      "X-Restli-Protocol-Version": "2.0.0",
      ...extra,
    };
  }

  async uploadImage(ownerUrn: string, bytes: Uint8Array, contentType: string): Promise<string> {
    const init = await this.fetch(`${BASE}/images?action=initializeUpload`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ initializeUploadRequest: { owner: ownerUrn } }),
    });
    if (!init.ok) throw new LinkedInPublishError(`image init failed: ${init.status}`, init.status);
    const { value } = (await init.json()) as { value: { uploadUrl: string; image: string } };
    const put = await this.fetch(value.uploadUrl, {
      method: "PUT",
      headers: { Authorization: `Bearer ${this.cfg.accessToken}`, "Content-Type": contentType },
      body: bytes,
    });
    if (!put.ok) throw new LinkedInPublishError(`image upload failed: ${put.status}`, put.status);
    return value.image;
  }

  async createPost(input: { authorUrn: string; text: string; imageUrn?: string }): Promise<string> {
    const body: Record<string, unknown> = {
      author: input.authorUrn,
      commentary: input.text,
      visibility: "PUBLIC",
      distribution: {
        feedDistribution: "MAIN_FEED",
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    };
    if (input.imageUrn) body.content = { media: { id: input.imageUrn } };
    const res = await this.fetch(`${BASE}/posts`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new LinkedInPublishError(`create post failed: ${res.status}`, res.status);
    const urn = res.headers.get("x-restli-id") ?? res.headers.get("x-linkedin-id");
    if (!urn) throw new LinkedInPublishError("create post: missing post URN header", res.status);
    return urn;
  }

  async addComment(postUrn: string, actorUrn: string, text: string): Promise<void> {
    const res = await this.fetch(`${BASE}/socialActions/${encodeURIComponent(postUrn)}/comments`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ actor: actorUrn, object: postUrn, message: { text } }),
    });
    if (!res.ok) throw new LinkedInPublishError(`add comment failed: ${res.status}`, res.status);
  }
}
