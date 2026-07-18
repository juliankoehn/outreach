import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { cookies } from "next/headers";
import { BRAND } from "@/config/brand";
import { cn } from "@/lib/utils";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-geist-sans", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: `${BRAND.name} — LinkedIn content console`,
  description: "Compose your presence, on a schedule.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  const dark = (await cookies()).get("theme")?.value === "dark";

  return (
    <html lang={locale} className={cn(sans.variable, mono.variable, dark && "dark")} suppressHydrationWarning>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
