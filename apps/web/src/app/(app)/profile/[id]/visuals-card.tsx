"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, ImageIcon, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { VISUAL_PRESET_IDS, type CreatorProfile } from "@/lib/profile";

// Editable image-look control for a profile: a look preset (single-select, with
// a "no preset" clear option) plus an optional free-text refinement. Both persist
// via PATCH /api/profiles/:id and steer every image generated for this profile.
// The auto-derived visual style (from past posts) is shown as a muted hint.
export function VisualsCard({
  profileId,
  profile,
  onUpdated,
}: {
  profileId: string;
  profile: CreatorProfile;
  onUpdated: (p: CreatorProfile) => void;
}) {
  const t = useTranslations();
  const [preset, setPreset] = useState<string | null>(profile.visualPreset ?? null);
  const [direction, setDirection] = useState(profile.visualDirection ?? "");
  const [savingPreset, setSavingPreset] = useState(false);
  const [savedDirection, setSavedDirection] = useState(false);
  const [savingDirection, setSavingDirection] = useState(false);

  // Keep local state in sync if the profile reloads from the server.
  useEffect(() => {
    setPreset(profile.visualPreset ?? null);
    setDirection(profile.visualDirection ?? "");
  }, [profile.visualPreset, profile.visualDirection]);

  async function patch(body: { visualPreset?: string | null; visualDirection?: string }) {
    const res = await fetch(`/api/profiles/${profileId}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const d = (await res.json()) as { profile: CreatorProfile };
      onUpdated(d.profile);
      return true;
    }
    return false;
  }

  async function choosePreset(next: string | null) {
    const value = next === preset ? null : next; // click active chip to clear
    setPreset(value);
    setSavingPreset(true);
    await patch({ visualPreset: value });
    setSavingPreset(false);
  }

  async function saveDirection() {
    if (direction.trim() === (profile.visualDirection ?? "").trim()) return;
    setSavingDirection(true);
    setSavedDirection(false);
    const ok = await patch({ visualDirection: direction.trim() });
    setSavingDirection(false);
    if (ok) {
      setSavedDirection(true);
      setTimeout(() => setSavedDirection(false), 2000);
    }
  }

  const derivedHint = profile.derived?.visualStyle?.trim();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 text-sm">
          <ImageIcon className="text-primary size-4" />
          {t("profile.visualsTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground text-xs">{t("profile.visualsHint")}</p>

        <div className="flex flex-wrap gap-1.5">
          {VISUAL_PRESET_IDS.map((id) => {
            const active = preset === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => void choosePreset(id)}
                disabled={savingPreset}
                aria-pressed={active}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60",
                  active
                    ? "border-primary bg-primary/10 text-primary"
                    : "text-muted-foreground hover:border-foreground/20 hover:text-foreground",
                )}
              >
                {t(`profile.visualPreset_${id}`)}
              </button>
            );
          })}
          {savingPreset && <Loader2 className="text-muted-foreground size-4 animate-spin self-center" />}
        </div>

        <div className="space-y-1.5">
          <label className="text-muted-foreground text-xs font-medium">{t("profile.visualsRefineLabel")}</label>
          <Textarea
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
            onBlur={() => void saveDirection()}
            placeholder={t("profile.visualsRefinePlaceholder")}
            rows={2}
            className="resize-none text-sm"
          />
          <div className="flex h-4 items-center">
            {savingDirection && (
              <span className="text-muted-foreground flex items-center gap-1 text-xs">
                <Loader2 className="size-3 animate-spin" /> {t("profile.saving")}
              </span>
            )}
            {savedDirection && !savingDirection && (
              <span className="text-muted-foreground flex items-center gap-1 text-xs">
                <Check className="size-3" /> {t("studio.saved")}
              </span>
            )}
          </div>
        </div>

        {derivedHint && (
          <p className="text-muted-foreground border-t pt-3 text-xs">
            <span className="font-medium">{t("profile.visualsDerivedLabel")}:</span> {derivedHint}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
