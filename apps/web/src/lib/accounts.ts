export interface Account {
  id: string;
  displayName: string;
  memberUrn: string;
  status: string;
}

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
  metrics: Metrics | null;
}
