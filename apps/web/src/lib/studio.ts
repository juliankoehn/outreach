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
  chat: ChatMessage[];
  scheduledAt: string | null;
  publishedAt: string | null;
  externalId: string | null;
  createdAt: string;
  updatedAt: string;
}
