import { getTranslations } from "next-intl/server";
import { ArrowRight } from "lucide-react";
import { BRAND } from "@/config/brand";
import { AppControls } from "@/components/app-controls";
import { Button } from "@/components/ui/button";

export default async function Home() {
  const t = await getTranslations("landing");
  const tb = await getTranslations("brand");

  return (
    <main className="bg-muted/40 flex min-h-svh flex-col">
      <header className="flex items-center justify-between p-5">
        <div className="flex items-center gap-2.5">
          <div className="bg-primary text-primary-foreground grid size-8 place-items-center rounded-lg text-sm font-semibold">
            {BRAND.name.charAt(0)}
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold">{BRAND.name}</div>
            <div className="text-muted-foreground text-xs">{tb("vendorPrefix")} {BRAND.vendor}</div>
          </div>
        </div>
        <AppControls />
      </header>

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 pb-24">
        <p className="text-muted-foreground text-sm font-medium tracking-wide">{t("kicker")}</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          {t("title")}
        </h1>
        <p className="text-muted-foreground mt-4 max-w-xl text-base">{t("subtitle")}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <a href="/signup">
              {t("getStarted")}
              <ArrowRight className="size-4" />
            </a>
          </Button>
          <Button asChild size="lg" variant="outline">
            <a href="/login">{t("signIn")}</a>
          </Button>
        </div>
      </div>
    </main>
  );
}
