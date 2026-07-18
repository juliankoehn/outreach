"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ImagePlus, Save, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { Account } from "@/lib/accounts";
import type { Draft } from "@/lib/studio";

type PageState = "loading" | "no-account" | "ready";

export default function StudioPage() {
  const t = useTranslations();
  const router = useRouter();

  const [accountId, setAccountId] = useState<string | null>(null);
  const [state, setState] = useState<PageState>("loading");

  const [topic, setTopic] = useState("");
  const [postText, setPostText] = useState("");
  const [imagePrompt, setImagePrompt] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  const [generatingText, setGeneratingText] = useState(false);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [noProfile, setNoProfile] = useState(false);

  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [draftsLoaded, setDraftsLoaded] = useState(false);

  const loadDrafts = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/studio/${id}/drafts`, { credentials: "include" });
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      if (res.ok) {
        const d = (await res.json()) as { drafts: Draft[] };
        setDrafts(d.drafts);
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
      setAccountId(first.id);
      setState("ready");
      void loadDrafts(first.id);
    })();
    return () => {
      alive = false;
    };
  }, [router, loadDrafts]);

  async function generateText() {
    if (!accountId || generatingText) return;
    setGeneratingText(true);
    setNoProfile(false);
    const res = await fetch(`/api/studio/${accountId}/draft-text`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: topic.trim() || undefined }),
    });
    setGeneratingText(false);
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (res.status === 400) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (body?.error === "no_profile") {
        setNoProfile(true);
        return;
      }
    }
    if (res.ok) {
      const d = (await res.json()) as { text: string };
      setPostText(d.text);
      setSaved(false);
      if (!imagePrompt.trim()) {
        const firstLine = d.text.split("\n").find((line) => line.trim().length > 0) ?? "";
        setImagePrompt(firstLine.trim());
      }
    }
  }

  async function generateImage() {
    if (!accountId || generatingImage || !imagePrompt.trim()) return;
    setGeneratingImage(true);
    const res = await fetch(`/api/studio/${accountId}/draft-image`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: imagePrompt.trim() }),
    });
    setGeneratingImage(false);
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (res.ok) {
      const d = (await res.json()) as { imageUrl: string };
      setImageUrl(d.imageUrl);
      setSaved(false);
    }
  }

  async function saveDraft() {
    if (!accountId || !postText.trim() || saving) return;
    setSaving(true);
    setSaved(false);
    const res = await fetch(`/api/studio/${accountId}/drafts`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: postText,
        imageUrl: imageUrl ?? undefined,
        imagePrompt: imagePrompt.trim() || undefined,
      }),
    });
    setSaving(false);
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (res.ok) {
      const d = (await res.json()) as { draft: Draft };
      setDrafts((list) => [d.draft, ...list]);
      setSaved(true);
    }
  }

  async function deleteDraft(id: string) {
    if (!accountId) return;
    setDrafts((list) => list.filter((d) => d.id !== id));
    const res = await fetch(`/api/studio/${accountId}/drafts/${id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (!res.ok) {
      void loadDrafts(accountId);
    }
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("studio.title")}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t("studio.subtitle")}</p>
      </div>

      {state === "loading" && (
        <div className="mt-6 space-y-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-64 w-full rounded-xl" />
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
        <div className="mt-6 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t("studio.title")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2">
                <Input
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder={t("studio.topicPlaceholder")}
                />
                <Button onClick={() => void generateText()} disabled={generatingText} className="shrink-0">
                  <Sparkles className={cn("size-4", generatingText && "animate-pulse")} />
                  {generatingText ? t("studio.generating") : t("studio.generatePost")}
                </Button>
              </div>

              {noProfile && (
                <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border px-3 py-2.5 text-sm">
                  {t("studio.noProfile")}{" "}
                  <a href="/profile" className="font-medium underline underline-offset-2">
                    {t("studio.noProfileLink")}
                  </a>
                </div>
              )}

              <Textarea
                value={postText}
                onChange={(e) => {
                  setPostText(e.target.value);
                  setSaved(false);
                }}
                placeholder={t("studio.postPlaceholder")}
                className="min-h-48"
              />

              <div className="flex items-center gap-2">
                <Input
                  value={imagePrompt}
                  onChange={(e) => setImagePrompt(e.target.value)}
                  placeholder={t("studio.imagePromptPlaceholder")}
                />
                <Button
                  variant="outline"
                  onClick={() => void generateImage()}
                  disabled={generatingImage || !imagePrompt.trim()}
                  className="shrink-0"
                >
                  <ImagePlus className={cn("size-4", generatingImage && "animate-spin")} />
                  {generatingImage ? t("studio.generatingImage") : t("studio.generateImage")}
                </Button>
              </div>

              {imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={imageUrl}
                  alt=""
                  className="max-h-80 w-full rounded-lg border object-contain"
                />
              )}

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <Button onClick={() => void saveDraft()} disabled={saving || !postText.trim()}>
                  <Save className="size-4" />
                  {saving ? t("common.loading") : t("studio.saveDraft")}
                </Button>
                {saved && <span className="text-success text-sm">{t("studio.saved")}</span>}
              </div>
            </CardContent>
          </Card>

          <div>
            <h2 className="text-sm font-medium">{t("studio.draftsTitle")}</h2>
            <div className="mt-3 grid gap-3">
              {!draftsLoaded &&
                [0, 1].map((i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}

              {draftsLoaded && drafts.length === 0 && (
                <div className="text-muted-foreground rounded-xl border border-dashed py-8 text-center text-sm">
                  {t("studio.draftsEmpty")}
                </div>
              )}

              {draftsLoaded &&
                drafts.map((d) => (
                  <Card key={d.id} className="flex-row items-start gap-4 p-4">
                    {d.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={d.imageUrl}
                        alt=""
                        className="size-16 shrink-0 rounded-md border object-cover"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-3 text-sm whitespace-pre-wrap">{d.text}</p>
                      <div className="text-muted-foreground mt-1.5 text-xs">
                        {new Date(d.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive size-8 shrink-0"
                      onClick={() => void deleteDraft(d.id)}
                      aria-label={t("studio.delete")}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </Card>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
