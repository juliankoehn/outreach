export interface Account {
  id: string;
  displayName: string;
  memberUrn: string;
  status: string;
  avatarUrl?: string | null;
  // Present on the list endpoint (GET /accounts), not on the single-account summary.
  createdAt?: string;
  analyticsAt?: string | null;
  profile?: { id: string; name: string } | null;
  postCount?: number;
  draftCount?: number;
}

export type PostSource = "manual" | "embed" | "linkedin_api" | "csv_import";

export interface Metrics {
  impressions: number;
  membersReached: number;
  reactions: number;
  comments: number;
  reshares: number;
}

export interface Post {
  id: string;
  text: string;
  publishedAt: string;
  mediaType: string;
  externalId: string | null;
  // Manual/embed posts may carry only a subset (impressions/reactions/comments).
  metrics: Partial<Metrics> | null;
  source: PostSource;
  imageUrl?: string | null;
}
