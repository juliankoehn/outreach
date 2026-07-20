"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, Check, Loader2, Sparkles, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAccount } from "../account-context";

export default function AccountSettingsPage() {
  const t = useTranslations();
  const { id, account } = useAccount();
  const needsReconnect = account.status === "expired" || account.status === "revoked";

  return (
    <div className="max-w-2xl space-y-6">
      <ImageProviderCard accountId={id} current={account.imageProvider ?? null} />
      {/* Connection */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("accounts.settingsConnectionTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Field label={t("accounts.settingsDisplayName")} value={account.displayName} />
          <Field label={t("accounts.settingsStatus")}>
            {needsReconnect ? (
              <Badge
                variant="outline"
                className="border-destructive/30 bg-destructive/10 text-destructive capitalize"
              >
                {account.status}
              </Badge>
            ) : (
              <Badge variant="success" className="capitalize">
                {account.status}
              </Badge>
            )}
          </Field>
          <Field label={t("accounts.settingsMemberUrn")} value={account.memberUrn} mono />

          {needsReconnect && (
            <div className="border-destructive/30 bg-destructive/10 mt-2 flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
              <div className="text-destructive flex items-start gap-2 text-xs">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  {account.status === "revoked"
                    ? t("accounts.revokedHint")
                    : t("accounts.expiredHint")}
                </span>
              </div>
              <Button asChild size="sm" className="shrink-0">
                <a href="/api/linkedin/connect">{t("accounts.reconnect")}</a>
              </Button>
            </div>
          )}
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

// The default image-generation model for this account. Only providers the
// operator has enabled (an API key is set) are offered; the choice persists via
// PATCH and governs every image generated from the studio.
function ImageProviderCard({ accountId, current }: { accountId: string; current: string | null }) {
  const t = useTranslations();
  const [providers, setProviders] = useState<Array<{ id: string; label: string }>>([]);
  const [value, setValue] = useState<string>(current ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    void fetch("/api/studio/image-providers", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { providers: [] }))
      .then((d: { providers?: Array<{ id: string; label: string }> }) => {
        if (!alive) return;
        const list = d.providers ?? [];
        setProviders(list);
        // Default the shown value to the first enabled provider when unset, so the
        // select always reflects what generation will actually use.
        setValue((v) => v || current || list[0]?.id || "");
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [current]);

  async function save(next: string) {
    setValue(next);
    setSaving(true);
    setSaved(false);
    const res = await fetch(`/api/linkedin/accounts/${accountId}/settings`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageProvider: next || null }),
    });
    setSaving(false);
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  }

  // No providers enabled at all (no API keys) — nothing to configure.
  if (providers.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{t("accounts.settingsImageTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground text-xs">{t("accounts.settingsImageHint")}</p>
        <div className="flex items-center gap-3">
          <Select value={value} onValueChange={(v) => void save(v)} disabled={saving}>
            <SelectTrigger size="sm" className="w-72">
              <SelectValue placeholder={t("studio.imageModel")} />
            </SelectTrigger>
            <SelectContent>
              {providers.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {saving && <Loader2 className="text-muted-foreground size-4 animate-spin" />}
          {saved && !saving && (
            <span className="text-muted-foreground flex items-center gap-1 text-xs">
              <Check className="size-3.5" /> {t("studio.saved")}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
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
