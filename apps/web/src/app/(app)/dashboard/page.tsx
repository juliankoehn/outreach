"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowRight, FileText, LinkIcon, PenLine, Plus, Sparkles, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { Account } from "@/lib/accounts";
import type { CreatorProfile } from "@/lib/profile";
import type { Draft } from "@/lib/studio";

export default function DashboardPage() {
  const t = useTranslations();
  const locale = useLocale();
  const df = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" });

  const [name, setName] = useState("");
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [profiles, setProfiles] = useState<CreatorProfile[] | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);

  useEffect(() => {
    void (async () => {
      const s = await fetch("/api/api/auth/get-session", { credentials: "include" });
      if (s.ok) {
        const j = (await s.json()) as { user?: { name?: string; email?: string } } | null;
        setName((j?.user?.name || j?.user?.email || "").split("@")[0] ?? "");
      }
    })();
    void (async () => {
      const res = await fetch("/api/linkedin/accounts", { credentials: "include" });
      const list = res.ok ? ((await res.json()) as { accounts: Account[] }).accounts : [];
      setAccounts(list);
      const first = list[0];
      if (first) {
        const d = await fetch(`/api/studio/${first.id}/drafts`, { credentials: "include" });
        if (d.ok) setDrafts(((await d.json()) as { drafts: Draft[] }).drafts);
      }
    })();
    void (async () => {
      const res = await fetch("/api/profiles", { credentials: "include" });
      setProfiles(res.ok ? ((await res.json()) as { profiles: CreatorProfile[] }).profiles : []);
    })();
  }, []);

  const totalPosts = (accounts ?? []).reduce((s, a) => s + (a.postCount ?? 0), 0);
  const totalDrafts = (accounts ?? []).reduce((s, a) => s + (a.draftCount ?? 0), 0);
  const readyProfile = (profiles ?? []).find((p) => p.status === "ready" && p.derived) ?? (profiles ?? [])[0];
  const firstAccount = (accounts ?? [])[0];
  // Profiles are per-account: link into the owning account's Profile tab.
  const profileHref = (p?: CreatorProfile) =>
    p?.accounts?.[0]?.id ? `/accounts/${p.accounts[0].id}/profile` : firstAccount ? `/accounts/${firstAccount.id}/profile` : "/accounts";

  const stats = [
    { icon: Users, label: t("dashboard.statAccounts"), value: accounts?.length, href: "/accounts" },
    { icon: FileText, label: t("dashboard.statPosts"), value: accounts ? totalPosts : undefined, href: "/accounts" },
    { icon: PenLine, label: t("dashboard.statDrafts"), value: accounts ? totalDrafts : undefined, href: "/studio" },
    { icon: Sparkles, label: t("dashboard.statProfiles"), value: profiles?.length, href: "/accounts" },
  ];

  return (
    <div className="p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {name ? t("dashboard.greetingNamed", { name }) : t("dashboard.greeting")}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">{t("dashboard.subtitle")}</p>
      </div>

      {/* Stat tiles */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <a
            key={s.label}
            href={s.href}
            className="bg-card hover:border-foreground/20 group rounded-xl border p-4 shadow-sm transition-colors"
          >
            <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <s.icon className="size-3.5" />
              {s.label}
            </div>
            {s.value === undefined ? (
              <Skeleton className="mt-2 h-8 w-12" />
            ) : (
              <div className="mt-1 text-3xl font-semibold tabular-nums tracking-tight">{s.value}</div>
            )}
          </a>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {/* Recent drafts + quick actions */}
        <div className="space-y-6 lg:col-span-2">
          <Card className="gap-0 py-0">
            <CardHeader className="flex-row items-center justify-between border-b px-5 py-4">
              <CardTitle className="text-sm">{t("dashboard.recentDrafts")}</CardTitle>
              <a
                href="/studio"
                className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs transition-colors"
              >
                {t("dashboard.openStudio")}
                <ArrowRight className="size-3.5" />
              </a>
            </CardHeader>
            <CardContent className="p-0">
              {!accounts ? (
                <div className="space-y-3 p-5">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : drafts.length === 0 ? (
                <div className="p-8 text-center">
                  <p className="text-muted-foreground text-sm">{t("dashboard.noDrafts")}</p>
                  <Button asChild className="mt-4">
                    <a href="/studio">
                      <Plus className="size-4" />
                      {t("dashboard.actionNewDraft")}
                    </a>
                  </Button>
                </div>
              ) : (
                <ul className="divide-y">
                  {drafts.slice(0, 5).map((d) => {
                    const title = (d.text.split("\n").find((l) => l.trim()) ?? t("studio.untitled")).slice(0, 80);
                    return (
                      <li key={d.id}>
                        <a
                          href={`/studio/${d.id}`}
                          className="hover:bg-accent/40 flex items-center gap-3 px-5 py-3.5 transition-colors"
                        >
                          {d.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={d.imageUrl} alt="" className="size-10 shrink-0 rounded-md border object-cover" />
                          ) : (
                            <div className="bg-muted grid size-10 shrink-0 place-items-center rounded-md">
                              <PenLine className="text-muted-foreground size-4" />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{title || t("studio.untitled")}</p>
                            <p className="text-muted-foreground text-xs">{df.format(new Date(d.updatedAt))}</p>
                          </div>
                          <Badge variant={d.status === "published" ? "success" : "muted"} className="capitalize">
                            {d.status}
                          </Badge>
                        </a>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <QuickAction icon={PenLine} label={t("dashboard.actionNewDraft")} href="/studio" primary />
            <QuickAction
              icon={Plus}
              label={t("dashboard.actionAddPosts")}
              href={firstAccount ? `/accounts/${firstAccount.id}/posts` : "/accounts"}
            />
            <QuickAction icon={Sparkles} label={t("dashboard.actionAnalyze")} href={profileHref(readyProfile)} />
            <QuickAction icon={LinkIcon} label={t("dashboard.actionConnect")} href="/api/linkedin/connect" />
          </div>
        </div>

        {/* Profile snapshot */}
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5 text-sm">
              <Sparkles className="text-primary size-4" />
              {t("dashboard.profileSnapshot")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!profiles ? (
              <Skeleton className="h-32 w-full" />
            ) : !readyProfile ? (
              <div className="text-sm">
                <p className="text-muted-foreground">{t("dashboard.noProfile")}</p>
                <Button asChild variant="outline" className="mt-3 w-full">
                  <a href={firstAccount ? `/accounts/${firstAccount.id}/profile` : "/accounts"}>
                    {t("dashboard.buildProfile")}
                  </a>
                </Button>
              </div>
            ) : (
              <div className="space-y-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{readyProfile.name || t("profile.untitled")}</span>
                  <Badge variant={readyProfile.status === "ready" ? "success" : "muted"} className="capitalize">
                    {readyProfile.status}
                  </Badge>
                </div>
                {readyProfile.derived ? (
                  <>
                    <Snippet label={t("profile.voiceSummary")} value={readyProfile.derived.voiceSummary} />
                    <Snippet label={t("profile.themes")} value={readyProfile.derived.themes.join(", ")} />
                    <Snippet label={t("profile.topPatterns")} value={readyProfile.derived.topPatterns.join(" · ")} />
                  </>
                ) : (
                  <p className="text-muted-foreground text-xs">{t("dashboard.profileNoInsights")}</p>
                )}
                <Button asChild variant="ghost" size="sm" className="mt-1 w-full justify-between">
                  <a href={profileHref(readyProfile)}>
                    {t("dashboard.openProfile")}
                    <ArrowRight className="size-4" />
                  </a>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function QuickAction({
  icon: Icon,
  label,
  href,
  primary,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  href: string;
  primary?: boolean;
}) {
  return (
    <a
      href={href}
      className={cn(
        "flex flex-col items-start gap-2 rounded-xl border p-4 shadow-sm transition-colors",
        primary
          ? "bg-primary text-primary-foreground border-primary hover:bg-primary/90"
          : "bg-card hover:border-foreground/20 hover:bg-accent/40",
      )}
    >
      <Icon className="size-5" />
      <span className="text-sm font-medium">{label}</span>
    </a>
  );
}

function Snippet({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div>
      <div className="text-muted-foreground text-xs font-medium">{label}</div>
      <p className="mt-0.5 line-clamp-3 text-sm">{value}</p>
    </div>
  );
}
