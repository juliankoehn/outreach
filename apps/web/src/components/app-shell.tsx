"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  CalendarClock,
  ChevronRight,
  LayoutDashboard,
  LayoutGrid,
  LogOut,
  PenLine,
  Rss,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { BreadcrumbSetter, type Crumb } from "./breadcrumb";
import { BRAND } from "@/config/brand";
import { AppControls } from "@/components/app-controls";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  key: "home" | "accounts" | "content" | "feed" | "schedule" | "settings";
  icon: LucideIcon;
  soon?: boolean;
}

// Creator profiles live per-account now (Accounts → account → Profile tab), so
// there's no standalone Profile nav entry.
const NAV: NavItem[] = [
  { href: "/dashboard", key: "home", icon: LayoutDashboard },
  { href: "/accounts", key: "accounts", icon: LayoutGrid },
  { href: "/studio", key: "content", icon: PenLine },
  { href: "/feed", key: "feed", icon: Rss },
  { href: "/schedule", key: "schedule", icon: CalendarClock, soon: true },
  { href: "/settings", key: "settings", icon: Settings, soon: true },
];

interface SessionUser {
  name?: string | null;
  email?: string | null;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations();
  const tb = useTranslations("brand");
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await fetch("/api/api/auth/get-session", { credentials: "include" });
      if (!alive) return;
      const data = res.ok ? ((await res.json()) as { user?: SessionUser } | null) : null;
      if (!data?.user) {
        router.replace("/login");
        return;
      }
      setUser(data.user);
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, [router]);

  async function signOut() {
    await fetch("/api/api/auth/sign-out", { method: "POST", credentials: "include" });
    router.push("/login");
  }

  if (!ready) {
    return (
      <div className="bg-sidebar flex h-dvh overflow-hidden">
        <div className="hidden w-64 shrink-0 p-3 md:block">
          <Skeleton className="mb-6 h-9 w-full" />
          <div className="space-y-2">
            {NAV.map((n) => (
              <Skeleton key={n.key} className="h-9 w-full" />
            ))}
          </div>
        </div>
        <div className="bg-background m-2 flex-1 rounded-xl border" />
      </div>
    );
  }

  const active = NAV.find((n) => pathname.startsWith(n.href));
  const label = user?.name ?? user?.email ?? "";
  const initials = label.trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="bg-sidebar text-sidebar-foreground flex h-dvh overflow-hidden">
      {/* Sidebar rail */}
      <aside className="sticky top-0 hidden h-svh w-64 shrink-0 flex-col p-3 md:flex">
        <div className="flex items-center gap-2.5 px-2 py-2">
          <div className="bg-primary text-primary-foreground grid size-8 place-items-center rounded-lg text-sm font-semibold">
            {BRAND.name.charAt(0)}
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold">{BRAND.name}</div>
            <div className="text-muted-foreground text-xs">{tb("vendorPrefix")} {BRAND.vendor}</div>
          </div>
        </div>

        <nav className="mt-4 flex flex-1 flex-col gap-1">
          {NAV.map((n) => {
            const Icon = n.icon;
            const isActive = active?.key === n.key;
            const base =
              "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors";
            if (n.soon) {
              return (
                <span
                  key={n.key}
                  aria-disabled="true"
                  className={cn(base, "text-muted-foreground/70 cursor-default")}
                >
                  <Icon className="size-4" />
                  {t(`nav.${n.key}`)}
                  <Badge variant="muted" className="ml-auto text-[10px]">
                    {t("nav.soon")}
                  </Badge>
                </span>
              );
            }
            return (
              <a
                key={n.key}
                href={n.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  base,
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon className="size-4" />
                {t(`nav.${n.key}`)}
              </a>
            );
          })}
        </nav>

        <div className="border-sidebar-border mt-2 flex items-center gap-2.5 border-t px-1 pt-3">
          <div className="bg-sidebar-accent text-sidebar-accent-foreground grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold">
            {initials}
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-sm font-medium">{user?.name ?? user?.email}</div>
            <div className="text-muted-foreground truncate text-xs">{t("nav.signedInAs")}</div>
          </div>
          <Button variant="ghost" size="icon" onClick={signOut} aria-label={t("accounts.signOut")} className="size-8">
            <LogOut className="size-4" />
          </Button>
        </div>
      </aside>

      {/* Inset content */}
      <div className="bg-background m-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border shadow-sm md:ml-0">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b px-5">
          {crumbs.length > 0 ? (
            <nav className="flex items-center gap-1.5 text-sm">
              {crumbs.map((c, i) => {
                const last = i === crumbs.length - 1;
                return (
                  <span key={i} className="flex items-center gap-1.5">
                    {i > 0 && <ChevronRight className="text-muted-foreground size-3.5 opacity-60" />}
                    {c.href && !last ? (
                      <a href={c.href} className="text-muted-foreground hover:text-foreground transition-colors">
                        {c.label}
                      </a>
                    ) : (
                      <span className={cn("truncate", last ? "font-medium" : "text-muted-foreground")}>
                        {c.label}
                      </span>
                    )}
                  </span>
                );
              })}
            </nav>
          ) : (
            <span className="text-sm font-medium">{active ? t(`nav.${active.key}`) : BRAND.name}</span>
          )}
          <div className="ml-auto">
            <AppControls />
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <BreadcrumbSetter.Provider value={setCrumbs}>{children}</BreadcrumbSetter.Provider>
        </div>
      </div>
    </div>
  );
}
