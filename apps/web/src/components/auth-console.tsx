"use client";

import { useTranslations } from "next-intl";
import { BRAND } from "@/config/brand";
import { ConsoleControls } from "./console-controls";

interface Props {
  kicker: string;
  title: string;
  subtitle: string;
  statement: string;
  children: React.ReactNode;
}

export function AuthConsole({ kicker, title, subtitle, statement, children }: Props) {
  const t = useTranslations("brand");
  return (
    <main className="shell">
      <section className="console" aria-labelledby="console-title">
        <span className="console__mark" aria-hidden="true" />
        <header className="console__head">
          <div className="brand">
            <span className="brand__name">
              <span className="transmit" aria-hidden="true" />
              {BRAND.name.toLowerCase()}
            </span>
            <span className="brand__vendor">{t("vendorPrefix")} {BRAND.vendor}</span>
          </div>
          <ConsoleControls />
        </header>

        <p className="kicker">{kicker}</p>
        <h1 className="title" id="console-title">{title}</h1>
        <p className="subtitle">{subtitle}</p>

        {children}

        <footer className="console__foot">
          <span className="dash">—</span>
          {statement}
        </footer>
      </section>
    </main>
  );
}
