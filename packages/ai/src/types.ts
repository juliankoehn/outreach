export interface ChatMessage {
  role: "assistant" | "user";
  content: string;
}

export interface PostForAnalysis {
  text: string;
  publishedAt: string;
  metrics?: { impressions?: number; reactions?: number; comments?: number } | null;
}

export interface DerivedInsights {
  voiceSummary: string;
  themes: string[];
  styleTraits: string[];
  cadence: string;
  topPatterns: string[];
}

export interface SynthesizedProfile {
  goals: string[];
  audience: string;
  pillars: string[];
  noGos: string[];
  toneWords: string[];
  languages: string[];
  positioning: string;
  brandBrief: string;
}
