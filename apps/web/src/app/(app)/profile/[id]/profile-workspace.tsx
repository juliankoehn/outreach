"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { CreatorProfile } from "@/lib/profile";
import { ProfileStudio } from "./profile-studio";

type PageState = "loading" | "not-found" | "ready";

// `embedded` = rendered inside an account's Profile tab, where the account
// layout already provides the frame — so we drop the standalone back-link and
// page padding.
export function ProfileWorkspace({ profileId, embedded = false }: { profileId: string; embedded?: boolean }) {
  const id = profileId;
  const t = useTranslations();
  const router = useRouter();

  const [state, setState] = useState<PageState>("loading");
  const [profile, setProfile] = useState<CreatorProfile | null>(null);
  const [name, setName] = useState("");
  const [nameSaving, setNameSaving] = useState(false);

  const loadProfile = useCallback(async () => {
    const res = await fetch(`/api/profiles/${id}`, { credentials: "include" });
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (res.status === 404 || !res.ok) {
      setState("not-found");
      return;
    }
    const { profile: p } = (await res.json()) as { profile: CreatorProfile };
    setProfile(p);
    setName(p.name);
    setState("ready");
  }, [id, router]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  async function saveName() {
    if (!profile || name === profile.name) return;
    setNameSaving(true);
    const res = await fetch(`/api/profiles/${id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setNameSaving(false);
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (res.ok) {
      const d = (await res.json()) as { profile: CreatorProfile };
      setProfile(d.profile);
    }
  }

  return (
    <div className={cn(embedded ? "flex h-full flex-col" : "p-6")}>
      {!embedded && (
        <a
          href="/profile"
          className="text-muted-foreground hover:text-foreground mb-5 inline-flex items-center gap-1.5 text-sm transition-colors"
        >
          <ArrowLeft className="size-4" />
          {t("profile.backToProfiles")}
        </a>
      )}

      {state === "loading" && (
        <div className="space-y-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      )}

      {state === "not-found" && (
        <div className="text-muted-foreground rounded-xl border border-dashed py-10 text-center text-sm">
          <p>{t("profile.notFound")}</p>
          {!embedded && (
            <Button asChild variant="outline" className="mt-4">
              <a href="/profile">{t("profile.backToProfiles")}</a>
            </Button>
          )}
        </div>
      )}

      {state === "ready" && profile && (
        <div className={cn(embedded ? "flex min-h-0 flex-1 flex-col gap-4" : "space-y-6")}>
          <div className="flex shrink-0 items-center gap-3">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => void saveName()}
              placeholder={t("profile.namePlaceholder")}
              className="text-lg font-medium"
            />
            <Badge variant={profile.status === "ready" ? "success" : "muted"} className="shrink-0 capitalize">
              {profile.status}
            </Badge>
            {nameSaving && <span className="text-muted-foreground shrink-0 text-xs">{t("profile.saving")}</span>}
          </div>

          <ProfileStudio profileId={id} embedded={embedded} />
        </div>
      )}
    </div>
  );
}
