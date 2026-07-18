"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import type { Account } from "@/lib/accounts";

export default function AccountsPage() {
  return (
    <Suspense>
      <AccountsList />
    </Suspense>
  );
}

function AccountsList() {
  const t = useTranslations();
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
    if (res.ok) setAccounts(((await res.json()) as { accounts: Account[] }).accounts);
    setLoaded(true);
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="page">
      <header className="page__head">
        <div className="page__head-main">
          <p className="kicker">{t("accounts.kicker")}</p>
          <h1 className="title">{t("accounts.title")}</h1>
          <p className="subtitle">{t("accounts.subtitle")}</p>
        </div>
        <a className="btn btn--solid" href="/api/linkedin/connect">
          {t("accounts.connect")}
          <span className="btn__arrow" aria-hidden="true">→</span>
        </a>
      </header>

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

      {!loaded && (
        <div className="acct-list" aria-hidden="true">
          {[0, 1].map((i) => (
            <div className="sk-card" key={i}>
              <div className="sk-row" style={{ marginBottom: 0 }}>
                <span className="sk" style={{ width: 6, height: 6, borderRadius: "50%" }} />
                <span className="sk sk-line" style={{ width: 160 }} />
                <span className="sk sk-line" style={{ width: 56, marginLeft: "auto" }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {loaded && accounts.length === 0 && <div className="empty">{t("accounts.empty")}</div>}

      {loaded && accounts.length > 0 && (
        <div className="acct-list">
          {accounts.map((a) => (
            <a className="acct-row" href={`/accounts/${a.id}`} key={a.id}>
              <div className="acct-row__main">
                <div className="acct-row__name">
                  <span className="transmit" aria-hidden="true" />
                  {a.displayName}
                  <span className="account__status">{a.status}</span>
                </div>
                <div className="acct-row__urn">{a.memberUrn}</div>
              </div>
              <span className="acct-row__open">
                {t("accounts.open")}
                <span aria-hidden="true">→</span>
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
