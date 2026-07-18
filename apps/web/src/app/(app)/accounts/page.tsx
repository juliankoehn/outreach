"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronRight, CircleCheck, Plus, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
    <div className="mx-auto max-w-4xl p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("accounts.title")}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t("accounts.subtitle")}</p>
        </div>
        <Button asChild>
          <a href="/api/linkedin/connect">
            <Plus className="size-4" />
            {t("accounts.connect")}
          </a>
        </Button>
      </div>

      {connected && (
        <div className="border-success/30 bg-success/10 text-success mt-6 flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm">
          <CircleCheck className="size-4" />
          {t("accounts.connectedBanner")}
        </div>
      )}
      {oauthError && (
        <div className="border-destructive/30 bg-destructive/10 text-destructive mt-6 flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm">
          <TriangleAlert className="size-4" />
          {oauthError}
        </div>
      )}

      <div className="mt-6 grid gap-3">
        {!loaded &&
          [0, 1].map((i) => <Skeleton key={i} className="h-[68px] w-full rounded-xl" />)}

        {loaded && accounts.length === 0 && (
          <div className="text-muted-foreground rounded-xl border border-dashed py-10 text-center text-sm">
            {t("accounts.empty")}
          </div>
        )}

        {loaded &&
          accounts.map((a) => (
            <a
              key={a.id}
              href={`/accounts/${a.id}`}
              className="bg-card hover:border-foreground/20 hover:bg-accent/40 group flex items-center gap-4 rounded-xl border px-5 py-4 shadow-sm transition-colors"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{a.displayName}</span>
                  <Badge variant="success" className="capitalize">{a.status}</Badge>
                </div>
                <div className="text-muted-foreground mt-1 truncate font-mono text-xs">{a.memberUrn}</div>
              </div>
              <div className="text-muted-foreground group-hover:text-foreground ml-auto flex items-center gap-1 text-sm transition-colors">
                {t("accounts.open")}
                <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </div>
            </a>
          ))}
      </div>
    </div>
  );
}
