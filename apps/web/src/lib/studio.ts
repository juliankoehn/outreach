export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface Draft {
  id: string;
  text: string;
  imageUrl: string | null;
  imagePrompt: string | null;
  status: string;
  source: string;
  // Persisted AI-SDK UI messages from the studio agent (see studio-chat.tsx).
  chat: unknown[];
  scheduledAt: string | null;
  publishedAt: string | null;
  externalId: string | null;
  publishError: string | null;
  createdAt: string;
  updatedAt: string;
}
