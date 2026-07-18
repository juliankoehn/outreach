import { getTranslations } from "next-intl/server";
import { BRAND } from "@/config/brand";
import { ConsoleControls } from "@/components/console-controls";

export default async function Home() {
  const t = await getTranslations("landing");
  const tb = await getTranslations("brand");

  return (
    <main className="shell">
      <section className="console landing" aria-labelledby="home-title">
        <span className="console__mark" aria-hidden="true" />
        <header className="console__head">
          <div className="brand">
            <span className="brand__name">
              <span className="transmit" aria-hidden="true" />
              {BRAND.name.toLowerCase()}
            </span>
            <span className="brand__vendor">{tb("vendorPrefix")} {BRAND.vendor}</span>
          </div>
          <ConsoleControls />
        </header>

        <p className="kicker">{t("kicker")}</p>
        <h1 className="title" id="home-title">{t("title")}</h1>
        <p className="subtitle">{t("subtitle")}</p>

        <div className="landing__actions">
          <a className="btn btn--solid" href="/signup">
            {t("getStarted")}
            <span className="btn__arrow" aria-hidden="true">→</span>
          </a>
          <a className="btn btn--ghost" href="/login">{t("signIn")}</a>
        </div>
      </section>
    </main>
  );
}
