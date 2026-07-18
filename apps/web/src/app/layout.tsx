import type { Metadata } from "next";
import { Space_Grotesk, Inter, JetBrains_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { cookies } from "next/headers";
import { BRAND } from "@/config/brand";
import "./globals.css";

const display = Space_Grotesk({ subsets: ["latin"], variable: "--f-display", display: "swap" });
const body = Inter({ subsets: ["latin"], variable: "--f-body", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--f-mono", display: "swap" });

export const metadata: Metadata = {
  title: `${BRAND.name} — LinkedIn content console`,
  description: "Compose your presence, on a schedule.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  const theme = (await cookies()).get("theme")?.value;
  const themeAttr = theme === "light" || theme === "dark" ? theme : undefined;

  return (
    <html
      lang={locale}
      data-theme={themeAttr}
      className={`${display.variable} ${body.variable} ${mono.variable}`}
    >
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
