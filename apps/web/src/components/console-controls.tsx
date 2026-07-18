"use client";

import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

const YEAR = 60 * 60 * 24 * 365;

export function ConsoleControls() {
  const locale = useLocale();
  const router = useRouter();

  const setCookie = useCallback((name: string, value: string) => {
    document.cookie = `${name}=${value}; path=/; max-age=${YEAR}; samesite=lax`;
    router.refresh();
  }, [router]);

  const setLocale = (l: "en" | "de") => {
    if (l !== locale) setCookie("locale", l);
  };

  const toggleTheme = () => {
    const root = document.documentElement;
    const current =
      root.dataset.theme ??
      (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    root.dataset.theme = next; // instant, no flash
    setCookie("theme", next);
  };

  return (
    <div className="controls">
      <div className="ctrl ctrl--seg" role="group" aria-label="Language">
        <button aria-pressed={locale === "en"} onClick={() => setLocale("en")}>EN</button>
        <span className="sep">·</span>
        <button aria-pressed={locale === "de"} onClick={() => setLocale("de")}>DE</button>
      </div>
      <button className="ctrl" onClick={toggleTheme} aria-label="Toggle theme">◐</button>
    </div>
  );
}
