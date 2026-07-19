"use client";

import { useEffect, useState } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useBreadcrumb } from "@/components/breadcrumb";
import type { Account } from "@/lib/accounts";
import { AccountProvider } from "./account-context";

function initials(name: string): string {
  const p = name.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "in";
}

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const { id } = useParams<{ id: string }>();

  const [account, setAccount] = useState<Account | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "missing">("loading");

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
    return () => {
      alive = false;
    };
  }, [id, router]);

  useBreadcrumb(
    account
      ? [{ label: t("accounts.title"), href: "/accounts" }, { label: account.displayName }]
      : [{ label: t("accounts.title"), href: "/accounts" }],
  );

  const tabs = [
    { key: "overview", href: `/accounts/${id}` },
    { key: "posts", href: `/accounts/${id}/posts` },
    { key: "profile", href: `/accounts/${id}/profile` },
    { key: "resources", href: `/accounts/${id}/resources` },
    { key: "settings", href: `/accounts/${id}/settings` },
  ];
  const isActive = (href: string) =>
    href.endsWith(id) ? pathname === href : pathname.startsWith(href);

  return (
    <div className="flex h-full flex-col p-6">
      {state === "missing" && (
        <div className="text-muted-foreground rounded-xl border border-dashed py-10 text-center text-sm">
          {t("accounts.notFound")}
        </div>
      )}

      {state === "loading" && (
        <div className="flex items-center gap-3">
          <Skeleton className="size-12 rounded-full" />
          <Skeleton className="h-8 w-56" />
        </div>
      )}

      {state === "ok" && account && (
        <>
          <div className="flex items-center gap-3.5">
            {account.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={account.avatarUrl} alt="" className="size-12 rounded-full object-cover" />
            ) : (
              <div className="bg-primary/10 text-primary grid size-12 place-items-center rounded-full text-sm font-semibold">
                {initials(account.displayName)}
              </div>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-2xl font-semibold tracking-tight">{account.displayName}</h1>
                <Badge variant="success" className="capitalize">
                  {account.status}
                </Badge>
              </div>
              <div className="text-muted-foreground truncate font-mono text-xs">{account.memberUrn}</div>
            </div>
          </div>

          <nav className="mt-5 flex gap-1 border-b">
            {tabs.map((tab) => (
              <a
                key={tab.key}
                href={tab.href}
                className={cn(
                  "-mb-px border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive(tab.href)
                    ? "border-primary text-foreground"
                    : "text-muted-foreground hover:text-foreground border-transparent",
                )}
              >
                {t(`accounts.tab_${tab.key}`)}
              </a>
            ))}
          </nav>

          <div className="mt-6 min-h-0 flex-1 overflow-y-auto">
            <AccountProvider value={{ id, account }}>{children}</AccountProvider>
          </div>
        </>
      )}
    </div>
  );
}
