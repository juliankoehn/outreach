import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import { getTextModel } from "./provider.js";

export interface PostMetrics {
  impressions?: number;
  membersReached?: number;
  reactions?: number;
  comments?: number;
  reshares?: number;
}

// (reactions + comments + reshares) / impressions; 0 when impressions is 0/absent.
export function engagementRate(m: PostMetrics | null | undefined): number {
  const impr = m?.impressions ?? 0;
  if (!impr) return 0;
  return ((m?.reactions ?? 0) + (m?.comments ?? 0) + (m?.reshares ?? 0)) / impr;
}

export const POST_ANALYSIS_SCHEMA = z.object({
  performance: z.object({
    summary: z.string().describe("One paragraph: how the post performed and WHY, grounded strictly in the given metrics."),
    verdict: z.enum(["over", "on-par", "under"]).describe("Engagement vs. the account's typical baseline."),
  }),
  teardown: z.object({
    hook: z.string().describe("The opening line's strength/approach."),
    structure: z.string().describe("Structure/format read (length, paragraphing, list, etc.)."),
    pillar: z.string().describe("Which of the creator's content pillars it fits, or 'none'."),
    format: z.string().describe("Media used (text-only/image/…) and whether it helped."),
    cta: z.string().describe("The call to action, or its absence."),
    toneMatch: z.string().describe("How well it matches the creator's tone/brand."),
  }),
  goalFit: z.string().describe("Did it serve the creator's stated goals?"),
  learnings: z
    .array(z.string())
    .min(1)
    .max(5)
    .describe("Concrete, reusable, forward-looking takeaways for FUTURE posts — each short enough to be a rule."),
});
export type PostAnalysis = z.infer<typeof POST_ANALYSIS_SCHEMA>;

export interface AnalyzePostInput {
  text: string;
  mediaType: string;
  publishedAt: string;
  metrics: PostMetrics | null;
  engagementRate: number;
  baseline?: PostMetrics | null;
  profile?: {
    goals?: string[];
    audience?: string;
    pillars?: string[];
    toneWords?: string[];
    noGos?: string[];
    brandBrief?: string;
  } | null;
}

function buildPrompt(i: AnalyzePostInput): string {
  const m = i.metrics ?? {};
  const p = i.profile ?? {};
  const lines = [
    `PUBLISHED POST (${i.publishedAt}, media=${i.mediaType || "none"}):`,
    `"""${i.text}"""`,
    "",
    "METRICS (ground everything in these — never invent numbers):",
    `- impressions: ${m.impressions ?? "?"}`,
    `- members reached: ${m.membersReached ?? "?"}`,
    `- reactions: ${m.reactions ?? "?"}`,
    `- comments: ${m.comments ?? "?"}`,
    `- reshares: ${m.reshares ?? "?"}`,
    `- engagement rate: ${(i.engagementRate * 100).toFixed(2)}%`,
  ];
  if (i.baseline) {
    lines.push(
      "",
      `ACCOUNT BASELINE (typical, for the verdict): impressions ${i.baseline.impressions ?? "?"}, reactions ${i.baseline.reactions ?? "?"}, comments ${i.baseline.comments ?? "?"}.`,
    );
  }
  lines.push(
    "",
    "CREATOR PROFILE:",
    p.goals?.length ? `- goals: ${p.goals.join(", ")}` : "- goals: (none set)",
    p.audience ? `- audience: ${p.audience}` : "",
    p.pillars?.length ? `- pillars: ${p.pillars.join(", ")}` : "",
    p.toneWords?.length ? `- tone: ${p.toneWords.join(", ")}` : "",
    p.noGos?.length ? `- no-gos: ${p.noGos.join(", ")}` : "",
    p.brandBrief ? `- brand brief: ${p.brandBrief}` : "",
  );
  return lines.filter(Boolean).join("\n");
}

export async function analyzePost(input: AnalyzePostInput, opts?: { model?: LanguageModel }): Promise<PostAnalysis> {
  const model = opts?.model ?? getTextModel();
  const { object } = await generateObject({
    model,
    schema: POST_ANALYSIS_SCHEMA,
    system:
      "You are a LinkedIn content strategist. Analyse ONE published post using ONLY the data provided. Judge performance against the account baseline, tear down what worked/didn't, assess fit to the creator's goals, and distil 3–5 concrete, reusable learnings that should shape FUTURE posts. Never fabricate metrics; if data is missing, say so.",
    messages: [{ role: "user", content: buildPrompt(input) }],
  });
  return object;
}
