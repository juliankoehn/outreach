export interface Account {
  id: string;
  displayName: string;
  memberUrn: string;
  status: string;
  avatarUrl?: string | null;
  // Default image-generation provider (openai | google); null = env default.
  imageProvider?: string | null;
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
  // Set once the post has an AI analysis (surfaced as a badge in the list).
  analyzedAt?: string | null;
}

export interface PostAnalysis {
  performance: { summary: string; verdict: "over" | "on-par" | "under" };
  teardown: {
    hook: string;
    structure: string;
    pillar: string;
    format: string;
    cta: string;
    toneMatch: string;
  };
  goalFit: string;
  learnings: string[];
}

export interface PostDetail extends Post {
  analysis: (PostAnalysis & { basis?: { impressions?: number } }) | null;
  analyzedAt: string | null;
  engagementRate: number;
}
