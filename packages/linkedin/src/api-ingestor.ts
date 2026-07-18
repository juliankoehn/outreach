import type { RawPost, MediaType } from "@outreach/core";
import type { PostIngestor } from "./ingestor.js";
import { LinkedInReadUnavailableError } from "./ingestor.js";

interface Config {
  accessToken: string;
  memberUrn: string;
  apiVersion?: string;
  fetchImpl?: typeof fetch;
}

interface ApiPost {
  id?: string;
  commentary?: string;
  createdAt?: number;
  content?: { media?: unknown };
}

export class LinkedInApiIngestor implements PostIngestor {
  private readonly httpFetch: typeof fetch;
  private readonly apiVersion: string;
  constructor(private readonly cfg: Config) {
    this.httpFetch = cfg.fetchImpl ?? fetch;
    this.apiVersion = cfg.apiVersion ?? "202401";
  }

  async fetch_(): Promise<Response> {
    const url = new URL("https://api.linkedin.com/rest/posts");
    url.searchParams.set("q", "author");
    url.searchParams.set("author", this.cfg.memberUrn);
    url.searchParams.set("count", "50");
    return this.httpFetch(url, {
      headers: {
        Authorization: `Bearer ${this.cfg.accessToken}`,
        "LinkedIn-Version": this.apiVersion,
        "X-Restli-Protocol-Version": "2.0.0",
      },
    });
  }

  async fetch(): Promise<RawPost[]> {
    const res = await this.fetch_();
    if (res.status === 403) throw new LinkedInReadUnavailableError();
    if (!res.ok) throw new Error(`LinkedIn posts read failed: ${res.status}`);
    const json = (await res.json()) as { elements?: ApiPost[] };
    return (json.elements ?? []).map((p) => this.map(p));
  }

  private map(p: ApiPost): RawPost {
    const mediaType: MediaType = p.content?.media ? "image" : "none";
    return {
      externalId: p.id ?? null,
      text: p.commentary ?? "",
      mediaType,
      publishedAt: new Date(p.createdAt ?? 0),
      raw: p,
    };
  }
}
