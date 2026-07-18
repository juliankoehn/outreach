"use client";

import { useTranslations } from "next-intl";
import { BRAND } from "@/config/brand";
import { AppControls } from "@/components/app-controls";
import { Card } from "@/components/ui/card";

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
    <main className="bg-muted/40 flex min-h-svh flex-col items-center justify-center gap-6 p-6">
      <div className="w-full max-w-sm">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="bg-primary text-primary-foreground grid size-8 place-items-center rounded-lg text-sm font-semibold">
              {BRAND.name.charAt(0)}
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold">{BRAND.name}</div>
              <div className="text-muted-foreground text-xs">{t("vendorPrefix")} {BRAND.vendor}</div>
            </div>
          </div>
          <AppControls />
        </div>

        <Card className="gap-0 py-0">
          <div className="p-6">
            <p className="text-muted-foreground text-xs font-medium tracking-wide">{kicker}</p>
            <h1 className="mt-1.5 text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="text-muted-foreground mt-1.5 text-sm">{subtitle}</p>
            {children}
          </div>
        </Card>

        <p className="text-muted-foreground mt-5 text-center text-xs">{statement}</p>
      </div>
    </main>
  );
}
