"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { CreatorProfile } from "@/lib/profile";

export default function ProfileLibraryPage() {
  const t = useTranslations();
  const router = useRouter();

  const [profiles, setProfiles] = useState<CreatorProfile[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/profiles", { credentials: "include" });
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (res.ok) {
      const { profiles: p } = (await res.json()) as { profiles: CreatorProfile[] };
      setProfiles(p);
    }
    setLoaded(true);
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createProfile() {
    if (creating) return;
    setCreating(true);
    const res = await fetch("/api/profiles", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    setCreating(false);
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (res.ok) {
      const { profile } = (await res.json()) as { profile: CreatorProfile };
      router.push(`/profile/${profile.id}`);
    }
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("profile.profilesTitle")}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t("profile.profilesSubtitle")}</p>
        </div>
        <Button onClick={() => void createProfile()} disabled={creating}>
          <Plus className="size-4" />
          {t("profile.newProfile")}
        </Button>
      </div>

      <div className="mt-6 grid gap-3">
        {!loaded && [0, 1].map((i) => <Skeleton key={i} className="h-[68px] w-full rounded-xl" />)}

        {loaded && profiles.length === 0 && (
          <div className="text-muted-foreground rounded-xl border border-dashed py-10 text-center text-sm">
            <p>{t("profile.emptyLibrary")}</p>
            <Button onClick={() => void createProfile()} disabled={creating} className="mt-4">
              <Plus className="size-4" />
              {t("profile.newProfile")}
            </Button>
          </div>
        )}

        {loaded &&
          profiles.map((p) => {
            const summary = p.positioning || p.pillars[0] || "";
            const accounts = p.accounts ?? [];
            return (
              <a
                key={p.id}
                href={`/profile/${p.id}`}
                className="bg-card hover:border-foreground/20 hover:bg-accent/40 group flex items-center gap-4 rounded-xl border px-5 py-4 shadow-sm transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">
                      {p.name || t("profile.untitled")}
                    </span>
                    <Badge variant={p.status === "ready" ? "success" : "muted"} className="capitalize">
                      {p.status}
                    </Badge>
                  </div>
                  {summary && (
                    <p className="text-muted-foreground mt-1 line-clamp-1 text-sm">{summary}</p>
                  )}
                  <div className="text-muted-foreground mt-1.5 truncate text-xs">
                    {accounts.length > 0
                      ? t("profile.usedBy", { names: accounts.map((a) => a.displayName).join(", ") })
                      : t("profile.notAssigned")}
                  </div>
                </div>
                <div className="text-muted-foreground group-hover:text-foreground ml-auto flex shrink-0 items-center gap-1 text-sm transition-colors">
                  <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </div>
              </a>
            );
          })}
      </div>
    </div>
  );
}
