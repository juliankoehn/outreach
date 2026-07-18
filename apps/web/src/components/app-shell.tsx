"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { BRAND } from "@/config/brand";
import { ConsoleControls } from "@/components/console-controls";

interface NavItem {
  href: string;
  key: "accounts" | "analysis" | "content" | "schedule" | "settings";
  icon: string;
  soon?: boolean;
}

const NAV: NavItem[] = [
  { href: "/accounts", key: "accounts", icon: "◇" },
  { href: "/analysis", key: "analysis", icon: "⊹", soon: true },
  { href: "/content", key: "content", icon: "✎", soon: true },
  { href: "/schedule", key: "schedule", icon: "◷", soon: true },
  { href: "/settings", key: "settings", icon: "⚙", soon: true },
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

  if (!ready) return <main className="shell" aria-busy="true" />;

  const active = NAV.find((n) => pathname.startsWith(n.href));
  const initials = (user?.name ?? user?.email ?? "?").trim().charAt(0).toUpperCase();

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand sidebar__brand">
          <span className="brand__name">
            <span className="transmit" aria-hidden="true" />
            {BRAND.name.toLowerCase()}
          </span>
          <span className="brand__vendor">{tb("vendorPrefix")} {BRAND.vendor}</span>
        </div>

        <nav className="nav">
          {NAV.map((n) =>
            n.soon ? (
              <span key={n.key} className="nav__item nav__item--soon" aria-disabled="true">
                <span className="nav__icon" aria-hidden="true">{n.icon}</span>
                {t(`nav.${n.key}`)}
                <span className="nav__soon">{t("nav.soon")}</span>
              </span>
            ) : (
              <a
                key={n.key}
                href={n.href}
                className={`nav__item${active?.key === n.key ? " nav__item--active" : ""}`}
                aria-current={active?.key === n.key ? "page" : undefined}
              >
                <span className="nav__icon" aria-hidden="true">{n.icon}</span>
                {t(`nav.${n.key}`)}
              </a>
            ),
          )}
        </nav>

        <div className="sidebar__foot">
          <div className="sidebar__user">
            <span className="sidebar__avatar" aria-hidden="true">{initials}</span>
            <span className="sidebar__user-name">{user?.name ?? user?.email}</span>
          </div>
          <button className="linkbtn" onClick={signOut}>{t("accounts.signOut")}</button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <span className="topbar__title">{active ? t(`nav.${active.key}`) : BRAND.name}</span>
          <div className="topbar__controls">
            <ConsoleControls />
          </div>
        </header>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
