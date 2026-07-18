"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { BRAND } from "@/config/brand";
import { ConsoleControls } from "@/components/console-controls";

interface Account {
  id: string;
  displayName: string;
  memberUrn: string;
  status: string;
}

interface Analytics {
  impressions: number;
  membersReached: number;
  reactions: number;
  comments: number;
  reshares: number;
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

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; muted?: boolean } | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [analyticsState, setAnalyticsState] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await fetch(`/api/linkedin/accounts/${account.id}/analytics`, { credentials: "include" });
      if (!alive) return;
      if (res.ok) {
        const d = (await res.json()) as { metrics: Analytics };
        setAnalytics(d.metrics);
        setAnalyticsState("ok");
      } else {
        setAnalyticsState("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, [account.id]);

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
    } else {
      setResult({ text: t("errors.generic"), muted: true });
    }
  }

  const metrics: { key: keyof Analytics; label: string }[] = [
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

      {/* Analytics (live from LinkedIn) */}
      <div className="metrics-block">
        <div className="metrics-block__title">{t("accounts.metricsTitle")}</div>
        {analyticsState === "loading" && (
          <div className="metrics" aria-hidden="true">
            {metrics.map((m) => (
              <div className="metric" key={m.key}>
                <span className="sk sk-line" style={{ width: 46, height: 18, display: "block" }} />
                <div className="metric__label">{m.label}</div>
              </div>
            ))}
          </div>
        )}
        {analyticsState === "ok" && analytics && (
          <div className="metrics">
            {metrics.map((m) => (
              <div className="metric" key={m.key}>
                <div className="metric__value">{nf.format(analytics[m.key])}</div>
                <div className="metric__label">{m.label}</div>
              </div>
            ))}
          </div>
        )}
        {analyticsState === "error" && <p className="metrics__note">{t("accounts.metricsUnavailable")}</p>}
        {analyticsState === "ok" && <p className="metrics__note">{t("accounts.metricsNote")}</p>}
      </div>

      {/* Content import (CSV) */}
      <div className="account__import">
        <div className="account__import-title">{t("accounts.importTitle")}</div>
        <p className="account__import-help">{t("accounts.importHelp")}</p>
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
          {result && (
            <span className={result.muted ? "result result--muted" : "result"}>{result.text}</span>
          )}
        </div>
      </div>
    </article>
  );
}
