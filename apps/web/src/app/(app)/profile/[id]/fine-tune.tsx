"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Loader2, Sparkles, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ProfileFacet } from "@/lib/profile";

const KIND_VARIANT: Record<ProfileFacet["kind"], "secondary" | "muted" | "success" | "outline"> = {
  tone: "secondary",
  pillar: "success",
  visual: "secondary",
  do: "muted",
  dont: "outline",
};

interface FineTuneProps {
  profileId: string;
  onUpdated: () => void;
}

export function FineTune({ profileId, onUpdated }: FineTuneProps) {
  const t = useTranslations();
  const [pending, setPending] = useState<ProfileFacet[]>([]);
  const [accepted, setAccepted] = useState<ProfileFacet[]>([]);
  const [rejected, setRejected] = useState<ProfileFacet[]>([]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [started, setStarted] = useState(false);

  async function loadSuggestions() {
    setLoading(true);
    setAccepted([]);
    setRejected([]);
    setStarted(true);
    const res = await fetch(`/api/profiles/${profileId}/suggest`, { method: "POST", credentials: "include" });
    setLoading(false);
    if (res.ok) setPending(((await res.json()) as { facets: ProfileFacet[] }).facets);
  }

  function decide(facet: ProfileFacet, keep: boolean) {
    setPending((p) => p.filter((f) => f !== facet));
    if (keep) setAccepted((a) => [...a, facet]);
    else setRejected((r) => [...r, facet]);
  }

  async function apply() {
    if (accepted.length === 0 && rejected.length === 0) return;
    setApplying(true);
    const res = await fetch(`/api/profiles/${profileId}/facets`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accepted, rejected }),
    });
    setApplying(false);
    if (res.ok) {
      onUpdated();
      // Continue the loop with a fresh batch that now excludes what we just decided.
      void loadSuggestions();
    }
  }

  const decidedCount = accepted.length + rejected.length;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-1.5 text-sm">
          <Sparkles className="text-primary size-4" />
          {t("profile.fineTuneTitle")}
        </CardTitle>
        {started && !loading && (
          <Button variant="ghost" size="sm" onClick={() => void loadSuggestions()} className="text-muted-foreground h-7">
            {t("profile.fineTuneMore")}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {!started ? (
          <div className="text-sm">
            <p className="text-muted-foreground">{t("profile.fineTuneDesc")}</p>
            <Button className="mt-3" onClick={() => void loadSuggestions()}>
              <Sparkles className="size-4" />
              {t("profile.fineTuneStart")}
            </Button>
          </div>
        ) : loading ? (
          <div className="text-muted-foreground flex items-center gap-2 py-6 text-sm">
            <Loader2 className="size-4 animate-spin" />
            {t("profile.fineTuneLoading")}
          </div>
        ) : (
          <div className="space-y-3">
            {pending.length === 0 && (
              <p className="text-muted-foreground py-2 text-sm">
                {decidedCount > 0 ? t("profile.fineTuneReview") : t("profile.fineTuneEmpty")}
              </p>
            )}
            {pending.map((f, i) => (
              <div key={i} className="flex items-start gap-3 rounded-lg border p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge variant={KIND_VARIANT[f.kind]} className="capitalize">
                      {t(`profile.facet_${f.kind}`)}
                    </Badge>
                    <span className="font-medium">{f.value}</span>
                  </div>
                  <p className="text-muted-foreground mt-1 text-xs">{f.rationale}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    size="icon-sm"
                    variant="outline"
                    onClick={() => decide(f, false)}
                    aria-label={t("profile.notMe")}
                    className="text-muted-foreground hover:text-destructive hover:border-destructive/40"
                  >
                    <X className="size-4" />
                  </Button>
                  <Button
                    size="icon-sm"
                    onClick={() => decide(f, true)}
                    aria-label={t("profile.thatsMe")}
                    className="bg-success text-white hover:bg-success/90"
                  >
                    <Check className="size-4" />
                  </Button>
                </div>
              </div>
            ))}

            {decidedCount > 0 && (
              <div className="flex items-center justify-between border-t pt-3">
                <span className="text-muted-foreground text-xs">
                  {t("profile.fineTuneDecided", { accepted: accepted.length, rejected: rejected.length })}
                </span>
                <Button onClick={() => void apply()} disabled={applying}>
                  {applying ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Check className="size-4" />
                  )}
                  {applying ? t("profile.fineTuneApplying") : t("profile.fineTuneApply")}
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
