"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ChevronRight, CircleCheck, Plus, Sparkles, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Account } from "@/lib/accounts";

function initials(name: string): string {
  const p = name.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "in";
}

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
  const locale = useLocale();
  const params = useSearchParams();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loaded, setLoaded] = useState(false);

  const df = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric" });
  const nf = new Intl.NumberFormat(locale);

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
    <div className="p-6">
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

      <div className="bg-card mt-6 overflow-hidden rounded-xl border shadow-sm">
        {!loaded ? (
          <div className="space-y-3 p-5">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : accounts.length === 0 ? (
          <div className="text-muted-foreground border-dashed py-12 text-center text-sm">
            <p>{t("accounts.empty")}</p>
            <Button asChild className="mt-4">
              <a href="/api/linkedin/connect">
                <Plus className="size-4" />
                {t("accounts.connect")}
              </a>
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{t("accounts.colAccount")}</TableHead>
                <TableHead>{t("accounts.colStatus")}</TableHead>
                <TableHead className="text-right">{t("accounts.colPosts")}</TableHead>
                <TableHead>{t("accounts.colProfile")}</TableHead>
                <TableHead>{t("accounts.colConnected")}</TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((a) => (
                <TableRow
                  key={a.id}
                  onClick={() => router.push(`/accounts/${a.id}`)}
                  className="group cursor-pointer"
                >
                  <TableCell>
                    <div className="flex items-center gap-3">
                      {a.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={a.avatarUrl} alt="" className="size-9 rounded-full object-cover" />
                      ) : (
                        <div className="bg-primary/10 text-primary grid size-9 place-items-center rounded-full text-xs font-semibold">
                          {initials(a.displayName)}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="font-medium">{a.displayName}</div>
                        <div className="text-muted-foreground max-w-[220px] truncate font-mono text-xs">
                          {a.memberUrn}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="success" className="capitalize">
                      {a.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{nf.format(a.postCount ?? 0)}</TableCell>
                  <TableCell>
                    {a.profile ? (
                      <span className="inline-flex items-center gap-1.5 text-sm">
                        <Sparkles className="text-primary size-3.5" />
                        {a.profile.name || t("profile.untitled")}
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-sm">{t("accounts.noProfile")}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {a.createdAt ? df.format(new Date(a.createdAt)) : "—"}
                  </TableCell>
                  <TableCell>
                    <ChevronRight className="text-muted-foreground group-hover:text-foreground size-4 transition-transform group-hover:translate-x-0.5" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
