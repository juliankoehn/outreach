export interface Draft {
  id: string;
  text: string;
  imageUrl: string | null;
  imagePrompt: string | null;
  status: string;
  source: string;
  createdAt: string;
}
