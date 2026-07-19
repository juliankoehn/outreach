"use client";

import { useTranslations } from "next-intl";
import { ArrowRight, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAccount } from "../account-context";

export default function AccountSettingsPage() {
  const t = useTranslations();
  const { id, account } = useAccount();

  return (
    <div className="max-w-2xl space-y-6">
      {/* Connection */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("accounts.settingsConnectionTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Field label={t("accounts.settingsDisplayName")} value={account.displayName} />
          <Field label={t("accounts.settingsStatus")}>
            <Badge variant="success" className="capitalize">
              {account.status}
            </Badge>
          </Field>
          <Field label={t("accounts.settingsMemberUrn")} value={account.memberUrn} mono />
        </CardContent>
      </Card>

      {/* Pointer to the profile tab */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("accounts.settingsProfileTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <a
            href={`/accounts/${id}/profile`}
            className="hover:border-foreground/20 hover:bg-accent/40 flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors"
          >
            <div className="bg-primary/10 text-primary grid size-9 place-items-center rounded-md">
              <Sparkles className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-medium">{t("accounts.settingsProfileGo")}</div>
              <p className="text-muted-foreground text-xs">{t("accounts.settingsProfileGoHint")}</p>
            </div>
            <ArrowRight className="text-muted-foreground size-4" />
          </a>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
  children,
}: {
  label: string;
  value?: string;
  mono?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      {children ?? <span className={mono ? "font-mono text-xs" : "font-medium"}>{value}</span>}
    </div>
  );
}
