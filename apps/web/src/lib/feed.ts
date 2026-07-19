// Feed / Content-Radar client types — shapes returned by /api/feed/*.
// Mirrors the FeedSource / FeedItem Prisma models the API serialises.

export interface FeedSource {
  id: string;
  url: string;
  title: string;
  status: string; // active | error
  error: string | null;
  lastFetchedAt: string | null;
  createdAt: string;
}

export interface FeedItem {
  id: string;
  sourceId: string;
  title: string;
  url: string;
  excerpt: string;
  imageUrl: string | null;
  author: string | null;
  publishedAt: string | null;
  status: string; // new | read | dismissed
  content: string | null; // article body as Markdown, when available
}
