"use client";

import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const YEAR = 60 * 60 * 24 * 365;

function setCookie(name: string, value: string) {
  document.cookie = `${name}=${value}; path=/; max-age=${YEAR}; samesite=lax`;
}

export function LocaleToggle() {
  const locale = useLocale();
  const router = useRouter();
  const pick = useCallback(
    (l: "en" | "de") => {
      if (l === locale) return;
      setCookie("locale", l);
      router.refresh();
    },
    [locale, router],
  );

  return (
    <div className="bg-muted text-muted-foreground inline-flex h-8 items-center rounded-md p-0.5 text-xs font-medium">
      {(["en", "de"] as const).map((l) => (
        <button
          key={l}
          onClick={() => pick(l)}
          aria-pressed={locale === l}
          className={cn(
            "rounded px-2 py-1 uppercase transition-colors",
            locale === l ? "bg-background text-foreground shadow-sm" : "hover:text-foreground",
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

export function ThemeToggle() {
  const toggle = () => {
    const root = document.documentElement;
    const dark = root.classList.toggle("dark");
    setCookie("theme", dark ? "dark" : "light");
  };
  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme" className="size-8">
      <Sun className="size-4 dark:hidden" />
      <Moon className="hidden size-4 dark:block" />
    </Button>
  );
}

export function AppControls() {
  return (
    <div className="flex items-center gap-1.5">
      <LocaleToggle />
      <ThemeToggle />
    </div>
  );
}
