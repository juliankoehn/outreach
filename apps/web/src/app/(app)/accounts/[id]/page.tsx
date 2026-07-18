"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
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
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      if (res.ok) {
        setAccount(((await res.json()) as { account: Account }).account);
        setState("ok");
      } else {
        setState("missing");
      }
    })();
    (async () => {
      const res = await fetch(`/api/linkedin/accounts/${id}/analytics`, { credentials: "include" });
      if (!alive) return;
      if (res.ok) {
        setAnalytics(((await res.json()) as { metrics: Metrics }).metrics);
        setAnalyticsState("ok");
      } else {
        setAnalyticsState("error");
      }
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
    } else {
      setResult({ text: t("errors.generic"), muted: true });
    }
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
    } else {
      setResult({ text: t("errors.generic"), muted: true });
    }
  }

  const aggTiles: { key: keyof Metrics; label: string }[] = [
    { key: "impressions", label: t("accounts.impressions") },
    { key: "membersReached", label: t("accounts.membersReached") },
    { key: "reactions", label: t("accounts.reactions") },
    { key: "comments", label: t("accounts.comments") },
    { key: "reshares", label: t("accounts.reshares") },
  ];

  return (
    <div className="page">
      <a className="detail__back" href="/accounts">
        <span aria-hidden="true">←</span> {t("accounts.back")}
      </a>

      {state === "missing" && <div className="empty">{t("accounts.notFound")}</div>}

      {state === "loading" && (
        <div className="sk-card">
          <div className="sk-row">
            <span className="sk" style={{ width: 6, height: 6, borderRadius: "50%" }} />
            <span className="sk sk-line" style={{ width: 180 }} />
          </div>
          <span className="sk sk-line" style={{ width: "50%", height: 10, display: "block" }} />
        </div>
      )}

      {state === "ok" && account && (
        <>
          <div className="detail__head">
            <span className="transmit" aria-hidden="true" />
            <h1 className="detail__name">{account.displayName}</h1>
            <span className="account__status">{account.status}</span>
          </div>
          <div className="detail__urn">{account.memberUrn}</div>

          {/* Aggregate analytics */}
          <section className="metrics-block">
            <div className="metrics-block__title">{t("accounts.metricsTitle")}</div>
            {analyticsState === "loading" && (
              <div className="metrics" aria-hidden="true">
                {aggTiles.map((m) => (
                  <div className="metric" key={m.key}>
                    <span className="sk sk-line" style={{ width: 46, height: 18, display: "block" }} />
                    <div className="metric__label">{m.label}</div>
                  </div>
                ))}
              </div>
            )}
            {analyticsState === "ok" && analytics && (
              <>
                <div className="metrics">
                  {aggTiles.map((m) => (
                    <div className="metric" key={m.key}>
                      <div className="metric__value">{nf.format(analytics[m.key])}</div>
                      <div className="metric__label">{m.label}</div>
                    </div>
                  ))}
                </div>
                <p className="metrics__note">{t("accounts.metricsNote")}</p>
              </>
            )}
            {analyticsState === "error" && <p className="metrics__note">{t("accounts.metricsUnavailable")}</p>}
          </section>

          {/* Content import */}
          <section className="account__import">
            <div className="account__import-title">{t("accounts.importTitle")}</div>
            <p className="account__import-help">
              {t.rich("accounts.importHelp", {
                link: (chunks) => (
                  <a className="ext-link" href={DATA_EXPORT_URL} target="_blank" rel="noreferrer">
                    {chunks}
                  </a>
                ),
              })}
            </p>
            <div className="account__actions">
              <label className="file-btn">
                {busy ? t("accounts.importing") : t("accounts.importCsv")}
                <input
                  type="file"
                  accept=".csv,text/csv"
                  disabled={busy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void importCsv(f);
                    e.target.value = "";
                  }}
                />
              </label>
              <button className="linkbtn" onClick={enrich} disabled={enriching || posts.length === 0}>
                {enriching ? t("accounts.enriching") : t("accounts.enrich")}
              </button>
              {result && (
                <span className={result.muted ? "result result--muted" : "result"}>{result.text}</span>
              )}
            </div>
          </section>

          {/* Posts */}
          {postsLoaded && (
            <section className="posts-block">
              <div className="posts-block__head">
                <div className="metrics-block__title">{t("accounts.postsTitle")}</div>
              </div>
              {posts.length === 0 ? (
                <p className="metrics__note">{t("accounts.postsEmpty")}</p>
              ) : (
                <div className="posts">
                  {posts.map((p) => (
                    <div className="post" key={p.id}>
                      <div className={p.text ? "post__text" : "post__text post__text--empty"}>
                        {p.text || t("accounts.noText")}
                      </div>
                      <div className="post__foot">
                        {p.metrics ? (
                          <>
                            <span className="post__metric"><b>{nf.format(p.metrics.impressions)}</b> {t("accounts.impressions").toLowerCase()}</span>
                            <span className="post__metric"><b>{nf.format(p.metrics.reactions)}</b> {t("accounts.reactions").toLowerCase()}</span>
                            <span className="post__metric"><b>{nf.format(p.metrics.comments)}</b> {t("accounts.comments").toLowerCase()}</span>
                          </>
                        ) : (
                          <span className="post__pending">— {t("accounts.enrich").toLowerCase()}</span>
                        )}
                        <span className="post__date">{df.format(new Date(p.publishedAt))}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
