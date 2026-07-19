"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Account } from "@/lib/accounts";
import type { Draft } from "@/lib/studio";

type PageState = "loading" | "no-account" | "ready";

function draftTitle(text: string): string {
  const firstLine = text.split("\n").find((line) => line.trim().length > 0);
  return firstLine?.trim() || "";
}

function statusVariant(status: string): "success" | "muted" | "secondary" {
  if (status === "published") return "success";
  if (status === "scheduled") return "secondary";
  return "muted";
}

export default function StudioPage() {
  const t = useTranslations();
  const router = useRouter();

  const [accountId, setAccountId] = useState<string | null>(null);
  const [state, setState] = useState<PageState>("loading");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [draftsLoaded, setDraftsLoaded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [promptText, setPromptText] = useState("");

  const loadDrafts = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/studio/${id}/drafts`, { credentials: "include" });
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      if (res.ok) {
        const d = (await res.json()) as { drafts: Draft[] };
        setDrafts(
          [...d.drafts].sort(
            (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
          ),
        );
      }
      setDraftsLoaded(true);
    },
    [router],
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await fetch("/api/linkedin/accounts", { credentials: "include" });
      if (!alive) return;
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      if (!res.ok) {
        setState("no-account");
        return;
      }
      const { accounts } = (await res.json()) as { accounts: Account[] };
      const first = accounts[0];
      if (!first) {
        setState("no-account");
        return;
      }
      setAccounts(accounts);
      setSelectedAccountId(first.id);
      setAccountId(first.id);
      setState("ready");
      void loadDrafts(first.id);
    })();
    return () => {
      alive = false;
    };
  }, [router, loadDrafts]);

  async function createDraft() {
    const acct = selectedAccountId || accountId;
    if (!acct || creating) return;
    setCreating(true);
    const res = await fetch(`/api/studio/${acct}/drafts`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    setCreating(false);
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (res.ok) {
      const d = (await res.json()) as { draft: Draft };
      // Empty prompt → a default kickoff so the studio always opens with a
      // profile-based draft (never a blank canvas).
      const p = promptText.trim() || t("studio.createDefaultPrompt");
      setDialogOpen(false);
      router.push(`/studio/${d.draft.id}?prompt=${encodeURIComponent(p)}`);
    }
  }

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("studio.title")}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t("studio.subtitle")}</p>
        </div>
        {state === "ready" && (
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="size-4" />
            {t("studio.newDraft")}
          </Button>
        )}
      </div>

      {state === "loading" && (
        <div className="mt-6 grid gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      )}

      {state === "no-account" && (
        <div className="text-muted-foreground mt-6 rounded-xl border border-dashed py-10 text-center text-sm">
          <p>{t("studio.emptyNoAccount")}</p>
          <Button asChild variant="outline" className="mt-4">
            <a href="/accounts">{t("studio.goToAccounts")}</a>
          </Button>
        </div>
      )}

      {state === "ready" && (
        <div className="mt-6 grid gap-3">
          {!draftsLoaded &&
            [0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}

          {draftsLoaded && drafts.length === 0 && (
            <div className="text-muted-foreground rounded-xl border border-dashed py-10 text-center text-sm">
              <p>{t("studio.draftsEmpty")}</p>
              <Button onClick={() => setDialogOpen(true)} className="mt-4">
                <Plus className="size-4" />
                {t("studio.newDraft")}
              </Button>
            </div>
          )}

          {draftsLoaded &&
            drafts.map((d) => {
              const title = draftTitle(d.text);
              return (
                <a key={d.id} href={`/studio/${d.id}`} className="block">
                  <Card className="hover:border-foreground/20 hover:bg-accent/40 flex-row items-start gap-4 p-4 shadow-sm transition-colors">
                    {d.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={d.imageUrl}
                        alt=""
                        className="size-16 shrink-0 rounded-md border object-cover"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">
                          {title || t("studio.untitled")}
                        </span>
                        <Badge variant={statusVariant(d.status)} className="capitalize">
                          {d.status}
                        </Badge>
                      </div>
                      {title && (
                        <p className="text-muted-foreground mt-1 line-clamp-2 text-sm whitespace-pre-wrap">
                          {d.text}
                        </p>
                      )}
                      <div className="text-muted-foreground mt-1.5 text-xs">
                        {new Date(d.updatedAt).toLocaleString()}
                      </div>
                    </div>
                  </Card>
                </a>
              );
            })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("studio.createTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {accounts.length > 1 && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">{t("studio.createAccount")}</label>
                <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">{t("studio.createPrompt")}</label>
              <Textarea
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                placeholder={t("studio.createPromptPlaceholder")}
                rows={4}
                autoFocus
              />
              <p className="text-muted-foreground text-xs">{t("studio.createHint")}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={creating}>
              {t("studio.deleteCancel")}
            </Button>
            <Button onClick={() => void createDraft()} disabled={creating}>
              <Plus className="size-4" />
              {creating ? t("studio.creating") : t("studio.createGo")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
