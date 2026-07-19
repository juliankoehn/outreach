import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import { getTextModel } from "./provider.js";
import type { DerivedInsights } from "./types.js";

// A discrete, swipeable profile suggestion the creator can accept ("that's me")
// or reject ("that's not me"). Each targets one editable dimension of the
// profile, so accepting/rejecting maps cleanly onto the profile fields.
export const FACET_KINDS = ["tone", "pillar", "visual", "do", "dont"] as const;
export type FacetKind = (typeof FACET_KINDS)[number];

export interface ProfileFacet {
  kind: FacetKind;
  value: string;
  rationale: string;
}

export const FACET_SCHEMA = z.object({
  facets: z
    .array(
      z.object({
        kind: z.enum(FACET_KINDS),
        value: z.string().describe("A short, concrete phrase (2-6 words) — a tone word, a content pillar, a visual-style trait, or a do/don't."),
        rationale: z.string().describe("One short sentence on why this fits the creator, grounded in the analysis."),
      }),
    )
    .describe("6-9 distinct fine-tuning suggestions across the kinds."),
});

export interface SuggestFacetsInput {
  profile: {
    audience?: string;
    positioning?: string;
    pillars?: string[];
    toneWords?: string[];
    noGos?: string[];
    brandBrief?: string;
  };
  derived?: DerivedInsights | null;
  // Values already accepted or rejected — never suggest these again.
  exclude?: string[];
}

export async function suggestFacets(
  input: SuggestFacetsInput,
  opts?: { model?: LanguageModel },
): Promise<ProfileFacet[]> {
  const model = opts?.model ?? getTextModel();
  const exclude = (input.exclude ?? []).map((s) => s.toLowerCase().trim());

  const { object } = await generateObject({
    model,
    schema: FACET_SCHEMA,
    system:
      "You are fine-tuning a creator's profile with them, one small choice at a time. Propose distinct, concrete facets they can accept or reject: tone words (kind 'tone'), content pillars ('pillar'), visual-style traits ('visual'), things they should do ('do'), and things to avoid ('dont'). Ground every suggestion in the provided analysis and profile — never generic. Keep each value short and specific. Do NOT repeat anything in the exclude list.",
    prompt: `Profile so far:\n${JSON.stringify(input.profile, null, 2)}\n\nAnalysis of their real posts:\n${
      input.derived ? JSON.stringify(input.derived, null, 2) : "(no analysis yet)"
    }\n\nExclude (already decided — do not suggest):\n${input.exclude?.join(", ") || "(none)"}`,
  });

  // Belt and braces: filter out anything already decided.
  return object.facets.filter((f) => !exclude.includes(f.value.toLowerCase().trim()));
}
