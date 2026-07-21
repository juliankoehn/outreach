"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { Metrics, Post } from "@/lib/accounts";
import { useAccount } from "./account-context";
import { PostRow } from "./post-row";

export default function AccountOverviewPage() {
  const t = useTranslations();
  const locale = useLocale();
  const { id } = useAccount();
  const nf = new Intl.NumberFormat(locale);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const rel = (iso: string | null) => {
    if (!iso) return "";
    const mins = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
    if (Math.abs(mins) < 60) return rtf.format(mins, "minute");
    const hrs = Math.round(mins / 60);
    if (Math.abs(hrs) < 24) return rtf.format(hrs, "hour");
    return rtf.format(Math.round(hrs / 24), "day");
  };

  const [analytics, setAnalytics] = useState<Metrics | null>(null);
  const [analyticsState, setAnalyticsState] = useState<"loading" | "ok" | "error">("loading");
  const [meta, setMeta] = useState<{ cachedAt: string | null; stale: boolean }>({ cachedAt: null, stale: false });
  const [refreshing, setRefreshing] = useState(false);
  const [posts, setPosts] = useState<Post[]>([]);

  const loadAnalytics = useCallback(
    async (force = false) => {
      if (force) setRefreshing(true);
      const res = await fetch(`/api/linkedin/accounts/${id}/analytics${force ? "?refresh=1" : ""}`, {
        credentials: "include",
      });
      if (res.ok) {
        const d = (await res.json()) as { metrics: Metrics; cachedAt: string | null; stale: boolean };
        setAnalytics(d.metrics);
        setMeta({ cachedAt: d.cachedAt, stale: d.stale });
        setAnalyticsState("ok");
      } else setAnalyticsState("error");
      setRefreshing(false);
    },
    [id],
  );

  useEffect(() => {
    void loadAnalytics();
    void (async () => {
      const res = await fetch(`/api/linkedin/accounts/${id}/posts`, { credentials: "include" });
      if (res.ok) setPosts(((await res.json()) as { posts: Post[] }).posts);
    })();
  }, [id, loadAnalytics]);

  const tiles: { key: keyof Metrics; label: string }[] = [
    { key: "impressions", label: t("accounts.impressions") },
    { key: "membersReached", label: t("accounts.membersReached") },
    { key: "reactions", label: t("accounts.reactions") },
    { key: "comments", label: t("accounts.comments") },
    { key: "reshares", label: t("accounts.reshares") },
  ];

  return (
    <div className="space-y-6">
      <div>
        <Card className="gap-0 overflow-hidden py-0">
          <CardHeader className="flex-row items-center justify-between border-b px-5 py-3">
            <CardTitle className="text-sm">{t("accounts.metricsTitle")}</CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => loadAnalytics(true)}
              disabled={refreshing}
              className="text-muted-foreground -mr-2 h-7"
            >
              <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
              {refreshing ? t("accounts.refreshing") : t("accounts.refresh")}
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <div className="grid grid-cols-2 sm:grid-cols-5">
              {tiles.map((m, i) => (
                <div key={m.key} className={cn("px-5 py-4", i > 0 && "sm:border-l", i >= 2 && "border-t sm:border-t-0")}>
                  {analyticsState === "ok" && analytics ? (
                    <div className="text-2xl font-semibold tabular-nums tracking-tight">
                      {nf.format(analytics[m.key])}
                    </div>
                  ) : analyticsState === "loading" ? (
                    <Skeleton className="h-7 w-14" />
                  ) : (
                    <div className="text-muted-foreground text-2xl font-semibold">—</div>
                  )}
                  <div className="text-muted-foreground mt-1 text-xs">{m.label}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <p
          className={cn(
            "mt-2 text-xs",
            meta.stale ? "text-amber-600 dark:text-amber-500" : "text-muted-foreground",
          )}
        >
          {analyticsState === "error"
            ? t("accounts.metricsUnavailable")
            : meta.stale
              ? t("accounts.rateLimited")
              : meta.cachedAt
                ? `${t("accounts.metricsNote")} · ${t("accounts.updatedAt", { when: rel(meta.cachedAt) })}`
                : t("accounts.metricsNote")}
        </p>
      </div>

      {/* Recent posts preview */}
      <Card className="gap-0 py-0">
        <CardHeader className="flex-row items-center justify-between border-b px-5 py-4">
          <CardTitle className="text-sm">{t("accounts.recentPosts")}</CardTitle>
          <a
            href={`/accounts/${id}/posts`}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs transition-colors"
          >
            {t("accounts.viewAllPosts")}
            <ArrowRight className="size-3.5" />
          </a>
        </CardHeader>
        <CardContent className="p-0">
          {posts.length === 0 ? (
            <p className="text-muted-foreground p-5 text-sm">{t("accounts.postsEmpty")}</p>
          ) : (
            <ul className="divide-y">
              {posts.slice(0, 3).map((p) => (
                <PostRow key={p.id} post={p} accountId={id} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
