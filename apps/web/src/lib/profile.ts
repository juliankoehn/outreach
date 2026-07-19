export interface ChatMessage {
  role: "assistant" | "user";
  content: string;
}

export interface DerivedInsights {
  voiceSummary: string;
  visualStyle: string;
  themes: string[];
  styleTraits: string[];
  cadence: string;
  topPatterns: string[];
}

export interface ProfileAccountRef {
  id: string;
  displayName: string;
}

export type FacetKind = "tone" | "pillar" | "visual" | "do" | "dont";

export interface ProfileFacet {
  kind: FacetKind;
  value: string;
  rationale: string;
}

export interface CreatorProfile {
  id: string;
  name: string;
  status: "draft" | "ready";
  goals: string[];
  audience: string;
  pillars: string[];
  noGos: string[];
  toneWords: string[];
  languages: string[];
  positioning: string;
  brandBrief: string;
  derived?: DerivedInsights | null;
  accounts?: ProfileAccountRef[];
}
