"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { UIMessage } from "ai";
import { ArrowLeft, ImagePlus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { Account } from "@/lib/accounts";
import type { Draft } from "@/lib/studio";
import { StudioChat } from "./studio-chat";
import { LinkedInPreview } from "./linkedin-preview";

type PageState = "loading" | "not-found" | "ready";

function statusVariant(status: string): "success" | "muted" | "secondary" {
  if (status === "published") return "success";
  if (status === "scheduled") return "secondary";
  return "muted";
}

// Only rows the studio agent persisted (AI-SDK UI messages) can rehydrate the
// chat; older/other shapes are ignored rather than crashing the transcript.
function toInitialMessages(chat: unknown[]): UIMessage[] {
  return chat.filter(
    (m): m is UIMessage =>
      !!m &&
      typeof m === "object" &&
      typeof (m as { id?: unknown }).id === "string" &&
      ((m as { id: string }).id.length > 0) &&
      Array.isArray((m as { parts?: unknown }).parts),
  );
}

export default function StudioDraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations();
  const router = useRouter();

  const [accountId, setAccountId] = useState<string | null>(null);
  const [author, setAuthor] = useState<{ name: string; avatarUrl: string | null }>({ name: "", avatarUrl: null });
  const [state, setState] = useState<PageState>("loading");
  const [draft, setDraft] = useState<Draft | null>(null);

  const [postText, setPostText] = useState("");
  const [imagePrompt, setImagePrompt] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [topic, setTopic] = useState("");

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [noProfile, setNoProfile] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const savedTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyDraft = useCallback((d: Draft) => {
    setDraft(d);
    setPostText(d.text);
    setImageUrl(d.imageUrl);
    setImagePrompt((prev) => {
      if (prev.trim()) return prev;
      if (d.imagePrompt) return d.imagePrompt;
      return (d.text.split("\n").find((line) => line.trim().length > 0) ?? "").trim();
    });
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const accRes = await fetch("/api/linkedin/accounts", { credentials: "include" });
      if (!alive) return;
      if (accRes.status === 401) return router.push("/login");
      if (!accRes.ok) return setState("not-found");
      const { accounts } = (await accRes.json()) as { accounts: Account[] };
      const first = accounts[0];
      if (!first) return setState("not-found");
      setAccountId(first.id);
      setAuthor({ name: first.displayName, avatarUrl: first.avatarUrl ?? null });

      const res = await fetch(`/api/studio/${first.id}/drafts/${id}`, { credentials: "include" });
      if (!alive) return;
      if (res.status === 401) return router.push("/login");
      if (!res.ok) return setState("not-found");
      applyDraft(((await res.json()) as { draft: Draft }).draft);
      setState("ready");
    })();
    return () => {
      alive = false;
    };
  }, [id, router, applyDraft]);

  useEffect(() => {
    return () => {
      if (savedTimeout.current) clearTimeout(savedTimeout.current);
    };
  }, []);

  // The persisted transcript is read once, when the workspace first becomes
  // ready; useChat owns the live message state after that.
  const initialMessages = useMemo(() => (draft ? toInitialMessages(draft.chat) : []), [draft]);

  function flashSaved() {
    setSaved(true);
    if (savedTimeout.current) clearTimeout(savedTimeout.current);
    savedTimeout.current = setTimeout(() => setSaved(false), 2000);
  }

  async function savePatch(patch: Partial<Pick<Draft, "text" | "imageUrl" | "imagePrompt">>) {
    if (!accountId) return;
    setSaving(true);
    const res = await fetch(`/api/studio/${accountId}/drafts/${id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    setSaving(false);
    if (res.status === 401) return router.push("/login");
    if (res.ok) {
      setDraft(((await res.json()) as { draft: Draft }).draft);
      flashSaved();
    }
  }

  // The agent edits the canvas through its tools; these keep the UI in step as
  // the stream arrives, then re-sync the baseline once the turn completes.
  const handlePostText = useCallback((text: string) => setPostText(text), []);
  const handleImageUrl = useCallback((url: string) => setImageUrl(url), []);
  const handleTurnFinished = useCallback(async () => {
    if (!accountId) return;
    const res = await fetch(`/api/studio/${accountId}/drafts/${id}`, { credentials: "include" });
    if (res.ok) {
      const { draft: d } = (await res.json()) as { draft: Draft };
      setDraft(d);
      setPostText(d.text);
      setImageUrl(d.imageUrl);
    }
  }, [accountId, id]);

  async function generateImage() {
    if (!accountId || generatingImage || !imagePrompt.trim()) return;
    setGeneratingImage(true);
    const res = await fetch(`/api/studio/${accountId}/draft-image`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: imagePrompt.trim(), postText: postText.trim() || undefined }),
    });
    setGeneratingImage(false);
    if (res.status === 401) return router.push("/login");
    if (res.ok) {
      const d = (await res.json()) as { imageUrl: string };
      setImageUrl(d.imageUrl);
      await savePatch({ imageUrl: d.imageUrl, imagePrompt: imagePrompt.trim() });
    }
  }

  async function regenerate() {
    if (!accountId || regenerating) return;
    setRegenerating(true);
    setNoProfile(false);
    const res = await fetch(`/api/studio/${accountId}/drafts/${id}/regenerate`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: topic.trim() || undefined }),
    });
    setRegenerating(false);
    if (res.status === 401) return router.push("/login");
    if (res.status === 400) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (body?.error === "no_profile") return setNoProfile(true);
    }
    if (res.ok) applyDraft(((await res.json()) as { draft: Draft }).draft);
  }

  async function deleteDraft() {
    if (!accountId || deleting) return;
    setDeleting(true);
    const res = await fetch(`/api/studio/${accountId}/drafts/${id}`, { method: "DELETE", credentials: "include" });
    setDeleting(false);
    if (res.status === 401) return router.push("/login");
    if (res.ok) router.push("/studio");
  }

  if (state === "loading") {
    return (
      <div className="flex h-full">
        <div className="hidden w-[360px] shrink-0 border-r p-4 lg:block">
          <Skeleton className="h-8 w-full" />
        </div>
        <div className="flex-1 p-8">
          <Skeleton className="mx-auto h-full max-w-2xl rounded-xl" />
        </div>
      </div>
    );
  }

  if (state === "not-found") {
    return (
      <div className="mx-auto max-w-md p-10 text-center">
        <p className="text-muted-foreground text-sm">{t("studio.notFound")}</p>
        <Button asChild variant="outline" className="mt-4">
          <a href="/studio">{t("studio.back")}</a>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col-reverse lg:flex-row">
      {accountId && (
        <StudioChat
          accountId={accountId}
          draftId={id}
          initialMessages={initialMessages}
          onPostText={handlePostText}
          onImageUrl={handleImageUrl}
          onTurnFinished={handleTurnFinished}
        />
      )}

      {/* Canvas pane */}
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Toolbar */}
        <div className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
          <a
            href="/studio"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
          >
            <ArrowLeft className="size-4" />
            {t("studio.back")}
          </a>
          <Badge variant={statusVariant(draft?.status ?? "draft")} className="capitalize">
            {draft?.status}
          </Badge>
          <div className="ml-auto flex items-center gap-2">
            {saved && <span className="text-success text-xs">{t("studio.saved")}</span>}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void savePatch({ text: postText })}
              disabled={saving || postText === draft?.text}
            >
              {saving ? t("studio.saving") : t("studio.save")}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void deleteDraft()}
              disabled={deleting}
              aria-label={t("studio.delete")}
              className="text-muted-foreground hover:text-destructive size-8"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>

        {/* Document */}
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl px-6 py-8">
            {noProfile && (
              <div className="border-destructive/30 bg-destructive/10 text-destructive mb-4 rounded-lg border px-3 py-2.5 text-sm">
                {t("studio.noProfile")}{" "}
                <a href="/profile" className="font-medium underline underline-offset-2">
                  {t("studio.noProfileLink")}
                </a>
              </div>
            )}

            <LinkedInPreview
              authorName={author.name}
              avatarUrl={author.avatarUrl}
              value={postText}
              onChange={setPostText}
              onBlur={() => {
                if (draft && postText !== draft.text) void savePatch({ text: postText });
              }}
              imageUrl={imageUrl}
              placeholder={t("studio.postPlaceholder")}
            />

            {/* Compose controls */}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder={t("studio.topicPlaceholder")}
                className="w-44"
              />
              <Button variant="outline" size="sm" onClick={() => void regenerate()} disabled={regenerating}>
                <RefreshCw className={cn("size-4", regenerating && "animate-spin")} />
                {regenerating ? t("studio.regenerating") : t("studio.regenerate")}
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Input
                value={imagePrompt}
                onChange={(e) => setImagePrompt(e.target.value)}
                placeholder={t("studio.imagePromptPlaceholder")}
                className="min-w-0 flex-1"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => void generateImage()}
                disabled={generatingImage || !imagePrompt.trim()}
                className="shrink-0"
              >
                <ImagePlus className={cn("size-4", generatingImage && "animate-spin")} />
                {generatingImage ? t("studio.generatingImage") : t("studio.generateImage")}
              </Button>
            </div>

            <p className="text-muted-foreground mt-6 border-t pt-4 text-xs">{t("studio.publishingSoon")}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
