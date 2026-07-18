"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, RefreshCw, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { Account, Metrics, Post } from "@/lib/accounts";

const DATA_EXPORT_URL = "https://www.linkedin.com/mypreferences/d/download-my-data";

export default function AccountDetailPage() {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const nf = new Intl.NumberFormat(locale);
  const df = new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric" });

  const [account, setAccount] = useState<Account | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "missing">("loading");

  const [busy, setBusy] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [result, setResult] = useState<{ text: string; muted?: boolean } | null>(null);

  const [analytics, setAnalytics] = useState<Metrics | null>(null);
  const [analyticsState, setAnalyticsState] = useState<"loading" | "ok" | "error">("loading");
  const [posts, setPosts] = useState<Post[]>([]);
  const [postsLoaded, setPostsLoaded] = useState(false);

  const loadPosts = useCallback(async () => {
    const res = await fetch(`/api/linkedin/accounts/${id}/posts`, { credentials: "include" });
    if (res.ok) setPosts(((await res.json()) as { posts: Post[] }).posts);
    setPostsLoaded(true);
  }, [id]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await fetch(`/api/linkedin/accounts/${id}`, { credentials: "include" });
      if (!alive) return;
      if (res.status === 401) return router.push("/login");
      if (res.ok) {
        setAccount(((await res.json()) as { account: Account }).account);
        setState("ok");
      } else setState("missing");
    })();
    (async () => {
      const res = await fetch(`/api/linkedin/accounts/${id}/analytics`, { credentials: "include" });
      if (!alive) return;
      if (res.ok) {
        setAnalytics(((await res.json()) as { metrics: Metrics }).metrics);
        setAnalyticsState("ok");
      } else setAnalyticsState("error");
    })();
    void loadPosts();
    return () => {
      alive = false;
    };
  }, [id, router, loadPosts]);

  async function importCsv(file: File) {
    setBusy(true);
    setResult(null);
    const res = await fetch(`/api/linkedin/accounts/${id}/import`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "text/csv" },
      body: await file.text(),
    });
    setBusy(false);
    if (res.ok) {
      const d = (await res.json()) as { inserted: number; skipped: number };
      setResult({ text: t("accounts.imported", { inserted: d.inserted, skipped: d.skipped }) });
      void loadPosts();
    } else setResult({ text: t("errors.generic"), muted: true });
  }

  async function enrich() {
    setEnriching(true);
    setResult(null);
    const res = await fetch(`/api/linkedin/accounts/${id}/enrich`, { method: "POST", credentials: "include" });
    setEnriching(false);
    if (res.ok) {
      const d = (await res.json()) as { enriched: number; total: number };
      if (d.total === 0) setResult({ text: t("accounts.enrichNone"), muted: true });
      else {
        setResult({ text: t("accounts.enriched", { count: d.enriched, total: d.total }) });
        void loadPosts();
      }
    } else setResult({ text: t("errors.generic"), muted: true });
  }

  const tiles: { key: keyof Metrics; label: string }[] = [
    { key: "impressions", label: t("accounts.impressions") },
    { key: "membersReached", label: t("accounts.membersReached") },
    { key: "reactions", label: t("accounts.reactions") },
    { key: "comments", label: t("accounts.comments") },
    { key: "reshares", label: t("accounts.reshares") },
  ];

  return (
    <div className="mx-auto max-w-4xl p-6">
      <a
        href="/accounts"
        className="text-muted-foreground hover:text-foreground mb-5 inline-flex items-center gap-1.5 text-sm transition-colors"
      >
        <ArrowLeft className="size-4" />
        {t("accounts.back")}
      </a>

      {state === "missing" && (
        <div className="text-muted-foreground rounded-xl border border-dashed py-10 text-center text-sm">
          {t("accounts.notFound")}
        </div>
      )}

      {state === "loading" && <Skeleton className="h-9 w-56" />}

      {state === "ok" && account && (
        <>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{account.displayName}</h1>
            <Badge variant="success" className="capitalize">{account.status}</Badge>
          </div>
          <div className="text-muted-foreground mt-1 font-mono text-xs">{account.memberUrn}</div>

          {/* Analytics */}
          <Card className="mt-6 gap-0 overflow-hidden py-0">
            <CardHeader className="border-b px-5 py-4">
              <CardTitle className="text-sm">{t("accounts.metricsTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="grid grid-cols-2 sm:grid-cols-5">
                {tiles.map((m, i) => (
                  <div
                    key={m.key}
                    className={cn(
                      "px-5 py-4",
                      i > 0 && "sm:border-l",
                      i >= 2 && "border-t sm:border-t-0",
                    )}
                  >
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
          <p className="text-muted-foreground mt-2 text-xs">
            {analyticsState === "error" ? t("accounts.metricsUnavailable") : t("accounts.metricsNote")}
          </p>

          {/* Import */}
          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="text-sm">{t("accounts.importTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-sm">
                {t.rich("accounts.importHelp", {
                  link: (chunks) => (
                    <a
                      className="text-foreground font-medium underline underline-offset-4"
                      href={DATA_EXPORT_URL}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {chunks}
                    </a>
                  ),
                })}
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <label className={cn(buttonVariants({ variant: "default" }), "cursor-pointer")}>
                  <Upload className="size-4" />
                  {busy ? t("accounts.importing") : t("accounts.importCsv")}
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    className="sr-only"
                    disabled={busy}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void importCsv(f);
                      e.target.value = "";
                    }}
                  />
                </label>
                <Button variant="outline" onClick={enrich} disabled={enriching || posts.length === 0}>
                  <RefreshCw className={cn("size-4", enriching && "animate-spin")} />
                  {enriching ? t("accounts.enriching") : t("accounts.enrich")}
                </Button>
                {result && (
                  <span className={cn("text-sm", result.muted ? "text-muted-foreground" : "text-success")}>
                    {result.text}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Posts */}
          {postsLoaded && (
            <Card className="mt-6 gap-0 py-0">
              <CardHeader className="border-b px-5 py-4">
                <CardTitle className="text-sm">{t("accounts.postsTitle")}</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {posts.length === 0 ? (
                  <p className="text-muted-foreground p-5 text-sm">{t("accounts.postsEmpty")}</p>
                ) : (
                  <ul className="divide-y">
                    {posts.map((p) => (
                      <li key={p.id} className="px-5 py-4">
                        <p className={cn("line-clamp-3 text-sm", !p.text && "text-muted-foreground italic")}>
                          {p.text || t("accounts.noText")}
                        </p>
                        <div className="text-muted-foreground mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                          {p.metrics ? (
                            <>
                              <Metric n={nf.format(p.metrics.impressions)} label={t("accounts.impressions")} />
                              <Metric n={nf.format(p.metrics.reactions)} label={t("accounts.reactions")} />
                              <Metric n={nf.format(p.metrics.comments)} label={t("accounts.comments")} />
                            </>
                          ) : (
                            <span className="text-muted-foreground/70">{t("accounts.enrich").toLowerCase()}</span>
                          )}
                          <span className="ml-auto">{df.format(new Date(p.publishedAt))}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Metric({ n, label }: { n: string; label: string }) {
  return (
    <span>
      <span className="text-foreground font-medium tabular-nums">{n}</span>{" "}
      <span className="lowercase">{label}</span>
    </span>
  );
}
