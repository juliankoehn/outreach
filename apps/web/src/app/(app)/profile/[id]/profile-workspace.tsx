"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, Check, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { Account } from "@/lib/accounts";
import type { CreatorProfile } from "@/lib/profile";
import { ProfileStudio } from "./profile-studio";

type PageState = "loading" | "not-found" | "ready";

// `embedded` = rendered inside an account's Profile tab (per-account profiles),
// where the account layout already provides the frame — so we drop the standalone
// back-link, page padding, account-assignment and delete affordances.
export function ProfileWorkspace({ profileId, embedded = false }: { profileId: string; embedded?: boolean }) {
  const id = profileId;
  const t = useTranslations();
  const router = useRouter();

  const [state, setState] = useState<PageState>("loading");
  const [profile, setProfile] = useState<CreatorProfile | null>(null);
  const [name, setName] = useState("");
  const [nameSaving, setNameSaving] = useState(false);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [assigning, setAssigning] = useState<string | null>(null);

  const [deleting, setDeleting] = useState(false);

  const loadProfile = useCallback(async () => {
    const res = await fetch(`/api/profiles/${id}`, { credentials: "include" });
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (res.status === 404 || !res.ok) {
      setState("not-found");
      return;
    }
    const { profile: p } = (await res.json()) as { profile: CreatorProfile };
    setProfile(p);
    setName(p.name);
    setState("ready");
  }, [id, router]);

  const loadAccounts = useCallback(async () => {
    const res = await fetch("/api/linkedin/accounts", { credentials: "include" });
    if (res.ok) {
      const { accounts: a } = (await res.json()) as { accounts: Account[] };
      setAccounts(a);
    }
    setAccountsLoaded(true);
  }, []);

  useEffect(() => {
    void loadProfile();
    void loadAccounts();
  }, [loadProfile, loadAccounts]);

  async function saveName() {
    if (!profile || name === profile.name) return;
    setNameSaving(true);
    const res = await fetch(`/api/profiles/${id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setNameSaving(false);
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (res.ok) {
      const d = (await res.json()) as { profile: CreatorProfile };
      setProfile(d.profile);
    }
  }


  async function deleteProfile() {
    setDeleting(true);
    const res = await fetch(`/api/profiles/${id}`, { method: "DELETE", credentials: "include" });
    setDeleting(false);
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (res.ok) router.push("/profile");
  }

  async function toggleAssign(accountId: string, assigned: boolean) {
    setAssigning(accountId);
    const res = await fetch(`/api/profiles/${id}/${assigned ? "unassign" : "assign"}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId }),
    });
    setAssigning(null);
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (res.ok) {
      await loadProfile();
    }
  }

  // For the account-scoped analyze CTA, prefer the account this profile belongs to.
  const assignedIds = new Set((profile?.accounts ?? []).map((a) => a.id));

  return (
    <div className={cn(embedded ? "flex h-full flex-col" : "p-6")}>
      {!embedded && (
        <a
          href="/profile"
          className="text-muted-foreground hover:text-foreground mb-5 inline-flex items-center gap-1.5 text-sm transition-colors"
        >
          <ArrowLeft className="size-4" />
          {t("profile.backToProfiles")}
        </a>
      )}

      {state === "loading" && (
        <div className="space-y-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      )}

      {state === "not-found" && (
        <div className="text-muted-foreground rounded-xl border border-dashed py-10 text-center text-sm">
          <p>{t("profile.notFound")}</p>
          {!embedded && (
            <Button asChild variant="outline" className="mt-4">
              <a href="/profile">{t("profile.backToProfiles")}</a>
            </Button>
          )}
        </div>
      )}

      {state === "ready" && profile && (
        <div className={cn(embedded ? "flex min-h-0 flex-1 flex-col gap-4" : "space-y-6")}>
          <div className="flex shrink-0 items-center gap-3">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => void saveName()}
              placeholder={t("profile.namePlaceholder")}
              className="text-lg font-medium"
            />
            <Badge variant={profile.status === "ready" ? "success" : "muted"} className="shrink-0 capitalize">
              {profile.status}
            </Badge>
            {nameSaving && <span className="text-muted-foreground shrink-0 text-xs">{t("profile.saving")}</span>}
          </div>

          <ProfileStudio profileId={id} embedded={embedded} />

          {/* Account assignment — only in the standalone library, not per-account tabs. */}
          {!embedded && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">{t("profile.assignTitle")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {!accountsLoaded && <Skeleton className="h-10 w-full" />}
                {accountsLoaded && accounts.length === 0 && (
                  <p className="text-muted-foreground text-sm">{t("profile.noAccounts")}</p>
                )}
                {accountsLoaded &&
                  accounts.map((a) => {
                    const isAssigned = assignedIds.has(a.id);
                    return (
                      <button
                        key={a.id}
                        type="button"
                        role="checkbox"
                        aria-checked={isAssigned}
                        disabled={assigning === a.id}
                        onClick={() => void toggleAssign(a.id, isAssigned)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-lg border px-3.5 py-2.5 text-left text-sm transition-colors disabled:opacity-60",
                          isAssigned ? "border-primary/40 bg-primary/5" : "hover:bg-accent/40",
                        )}
                      >
                        <span
                          className={cn(
                            "grid size-[18px] shrink-0 place-items-center rounded-[5px] border transition-colors",
                            isAssigned ? "bg-primary border-primary text-primary-foreground" : "border-input",
                          )}
                        >
                          {isAssigned && <Check className="size-3" strokeWidth={3} />}
                        </span>
                        <span className="font-medium">{a.displayName}</span>
                      </button>
                    );
                  })}
                <p className="text-muted-foreground pt-1 text-xs">{t("profile.assignHint")}</p>
              </CardContent>
            </Card>
          )}

          {!embedded && (
            <div className="flex justify-end border-t pt-4">
              <Button
                variant="ghost"
                onClick={() => void deleteProfile()}
                disabled={deleting}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-4" />
                {t("profile.delete")}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
