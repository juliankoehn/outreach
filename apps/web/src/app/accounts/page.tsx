"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { BRAND } from "@/config/brand";
import { ConsoleControls } from "@/components/console-controls";

const DATA_EXPORT_URL = "https://www.linkedin.com/mypreferences/d/download-my-data";

interface Account {
  id: string;
  displayName: string;
  memberUrn: string;
  status: string;
}

interface Metrics {
  impressions: number;
  membersReached: number;
  reactions: number;
  comments: number;
  reshares: number;
}

interface Post {
  id: string;
  text: string;
  publishedAt: string;
  mediaType: string;
  externalId: string | null;
  metrics: Metrics | null;
}

export default function AccountsPage() {
  return (
    <Suspense>
      <AccountsInner />
    </Suspense>
  );
}

function AccountsInner() {
  const t = useTranslations();
  const tb = useTranslations("brand");
  const router = useRouter();
  const params = useSearchParams();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loaded, setLoaded] = useState(false);

  const connected = params.get("connected");
  const oauthError = params.get("error");

  const load = useCallback(async () => {
    const res = await fetch("/api/linkedin/accounts", { credentials: "include" });
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (res.ok) {
      const data = (await res.json()) as { accounts: Account[] };
      setAccounts(data.accounts);
    }
    setLoaded(true);
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function signOut() {
    await fetch("/api/api/auth/sign-out", { method: "POST", credentials: "include" });
    router.push("/login");
  }

  return (
    <main className="shell">
      <section className="console console--wide">
        <span className="console__mark" aria-hidden="true" />
        <header className="console__head">
          <div className="brand">
            <span className="brand__name">
              <span className="transmit" aria-hidden="true" />
              {BRAND.name.toLowerCase()}
            </span>
            <span className="brand__vendor">{tb("vendorPrefix")} {BRAND.vendor}</span>
          </div>
          <div className="controls">
            <ConsoleControls />
            <button className="ctrl" onClick={signOut}>{t("accounts.signOut")}</button>
          </div>
        </header>

        <p className="kicker">{t("accounts.kicker")}</p>
        <h1 className="title">{t("accounts.title")}</h1>
        <p className="subtitle">{t("accounts.subtitle")}</p>

        {connected && (
          <div className="banner banner--ok">
            <span className="banner__dot" aria-hidden="true">✓</span>
            {t("accounts.connectedBanner")}
          </div>
        )}
        {oauthError && (
          <div className="banner banner--error">
            <span className="banner__dot" aria-hidden="true">!</span>
            {oauthError}
          </div>
        )}

        <div className="console__topline">
          <a className="btn btn--solid" href="/api/linkedin/connect">
            {t("accounts.connect")}
            <span className="btn__arrow" aria-hidden="true">→</span>
          </a>
        </div>

        {!loaded && <AccountsSkeleton />}
        {loaded && accounts.length === 0 && <div className="empty">{t("accounts.empty")}</div>}
        {loaded && accounts.length > 0 && (
          <div className="stack">
            {accounts.map((a) => (
              <AccountCard key={a.id} account={a} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function AccountsSkeleton() {
  return (
    <div className="stack" aria-hidden="true">
      {[0, 1].map((i) => (
        <div className="sk-card" key={i}>
          <div className="sk-row">
            <span className="sk" style={{ width: 6, height: 6, borderRadius: "50%" }} />
            <span className="sk sk-line" style={{ width: 140 }} />
            <span className="sk sk-line" style={{ width: 48, marginLeft: "auto" }} />
          </div>
          <span className="sk sk-line" style={{ width: "70%", height: 10, display: "block" }} />
        </div>
      ))}
    </div>
  );
}

function AccountCard({ account }: { account: Account }) {
  const t = useTranslations();
  const locale = useLocale();
  const nf = new Intl.NumberFormat(locale);
  const df = new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric" });

  const [busy, setBusy] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [result, setResult] = useState<{ text: string; muted?: boolean } | null>(null);

  const [analytics, setAnalytics] = useState<Metrics | null>(null);
  const [analyticsState, setAnalyticsState] = useState<"loading" | "ok" | "error">("loading");
  const [posts, setPosts] = useState<Post[]>([]);
  const [postsLoaded, setPostsLoaded] = useState(false);

  const loadPosts = useCallback(async () => {
    const res = await fetch(`/api/linkedin/accounts/${account.id}/posts`, { credentials: "include" });
    if (res.ok) {
      const d = (await res.json()) as { posts: Post[] };
      setPosts(d.posts);
    }
    setPostsLoaded(true);
  }, [account.id]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await fetch(`/api/linkedin/accounts/${account.id}/analytics`, { credentials: "include" });
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
  }, [account.id, loadPosts]);

  async function importCsv(file: File) {
    setBusy(true);
    setResult(null);
    const res = await fetch(`/api/linkedin/accounts/${account.id}/import`, {
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
    const res = await fetch(`/api/linkedin/accounts/${account.id}/enrich`, {
      method: "POST",
      credentials: "include",
    });
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
    <article className="account">
      <div className="account__head">
        <span className="transmit" aria-hidden="true" />
        <span className="account__name">{account.displayName}</span>
        <span className="account__status">{account.status}</span>
      </div>
      <div className="account__urn">{account.memberUrn}</div>

      {/* Aggregate analytics (live) */}
      <div className="metrics-block">
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
      </div>

      {/* Content import (CSV) */}
      <div className="account__import">
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
      </div>

      {/* Posts */}
      {postsLoaded && (
        <div className="posts-block">
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
        </div>
      )}
    </article>
  );
}
