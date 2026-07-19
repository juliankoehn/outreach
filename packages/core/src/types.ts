export type MediaType = "none" | "image" | "video" | "article" | "carousel";

export interface PostMetrics {
  likes?: number;
  comments?: number;
  shares?: number;
  impressions?: number;
}

export interface RawPost {
  externalId: string | null;
  text: string;
  mediaType: MediaType;
  publishedAt: Date;
  metrics?: PostMetrics;
  raw: unknown;
}
