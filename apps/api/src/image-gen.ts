// Single home for profile-grounded image generation. Every image the app makes
// — the studio's "Generate image" button, the studio chat agent, and the profile
// canvas example — resolves the same inputs here (the creator's visual language,
// their account's reference photos, and the chosen image provider) and renders
// through one function, so the three call sites can't drift apart.
import {
  generateImage,
  composeVisualLanguage,
  isImageProviderEnabled,
  formatInsights,
  type ImageProviderId,
  type DerivedInsights,
} from "@outreach/ai";
import { saveImage } from "./images.js";
import { getAccountProfile } from "./repos/profile.js";
import {
  getAccountSummary,
  getAccountIdForProfile,
  getProfileImageProviders,
} from "./repos/linkedin-account.js";
import { imageReferenceHint } from "./repos/resource.js";

type Size = "portrait" | "square" | "landscape";

// The visual fields any image needs from a profile row.
interface VisualProfile {
  id: string;
  visualPreset: string | null;
  visualDirection: string;
  derived: unknown;
}

// The creator's combined visual language (Visuals preset + refinement + the
// analyzed style), as fed to the image model.
export function profileVisualStyle(profile: VisualProfile | null): string {
  return composeVisualLanguage({
    preset: profile?.visualPreset,
    direction: profile?.visualDirection,
    derived: (profile?.derived as unknown as DerivedInsights | null | undefined)?.visualStyle,
  });
}

// Render a final prompt/brief and persist it. THE single writer — callers that
// need an art-director step (composeImageBrief) run it first and pass the brief.
export async function renderAndSaveImage(
  prompt: string,
  opts: {
    postText?: string;
    size?: Size;
    visualStyle?: string;
    provider?: ImageProviderId;
    referenceHint?: string;
    insights?: string;
  },
): Promise<{ imageUrl: string; base64: string; mediaType: string }> {
  const { base64, mediaType } = await generateImage(prompt, {
    postText: opts.postText,
    provider: opts.provider,
    visualStyle: opts.visualStyle,
    size: opts.size ?? "square",
    referenceHint: opts.referenceHint,
    insights: opts.insights,
  });
  const { url } = await saveImage(base64, mediaType);
  return { imageUrl: url, base64, mediaType };
}

// Profile-grounded inputs for an ACCOUNT context (the studio, which is always
// scoped to one account). `providerOverride` is a per-request choice that wins
// over the account's saved default.
export async function accountImageInputs(accountId: string, userId: string, providerOverride?: string) {
  const [profile, acct, referenceHint] = await Promise.all([
    getAccountProfile(accountId),
    getAccountSummary(accountId, userId),
    imageReferenceHint(accountId),
  ]);
  const provider = isImageProviderEnabled(providerOverride)
    ? providerOverride
    : isImageProviderEnabled(acct?.imageProvider)
      ? acct.imageProvider
      : undefined;
  return {
    profile,
    provider,
    visualStyle: profileVisualStyle(profile),
    referenceHint,
    insights: formatInsights(profile?.derived as unknown as DerivedInsights | null | undefined),
  };
}

// Profile-grounded inputs for a PROFILE context (the profile studio). A profile
// may be bound to more than one account; take the image provider from any bound
// account that has one enabled, so a stray seeded account can't win.
export async function profileImageInputs(profile: VisualProfile, userId: string) {
  const [acctId, providers] = await Promise.all([
    getAccountIdForProfile(profile.id, userId),
    getProfileImageProviders(profile.id, userId),
  ]);
  const provider = providers.find(isImageProviderEnabled);
  const referenceHint = acctId ? await imageReferenceHint(acctId) : "";
  return {
    provider,
    visualStyle: profileVisualStyle(profile),
    referenceHint,
    insights: formatInsights(profile.derived as unknown as DerivedInsights | null | undefined),
  };
}
