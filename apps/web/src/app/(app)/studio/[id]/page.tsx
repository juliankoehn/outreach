"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import type { UIMessage } from "ai";
import { ArrowLeft, ImagePlus, Newspaper, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { Account } from "@/lib/accounts";
import type { Draft } from "@/lib/studio";
import { StudioChat } from "./studio-chat";
import { LinkedInPreview } from "./linkedin-preview";

type PageState = "loading" | "not-found" | "ready";

// Stable empty reference so the pre-load render doesn't churn useChat's messages.
const NO_MESSAGES: UIMessage[] = [];

type SourceFeedItem = { id: string; title: string; url: string };

function statusVariant(status: string): "success" | "muted" | "secondary" {
  if (status === "published") return "success";
  if (status === "scheduled") return "secondary";
  return "muted";
}

// An assistant turn is only worth rehydrating if it actually produced
// something: a non-empty text part, or a tool call that reached a terminal
// state (output-available/output-error). Turns interrupted mid-stream persist a
// tool part stuck in "input-available" (no output) — those rendered as a
// permanent "Running" card on reload. User/system messages are always kept.
function isRenderableMessage(m: UIMessage): boolean {
  if (m.role !== "assistant") return true;
  return m.parts.some((p) => {
    if (p.type === "text") return typeof p.text === "string" && p.text.trim().length > 0;
    if (typeof p.type === "string" && p.type.startsWith("tool-")) {
      const state = (p as { state?: string }).state;
      return state === "output-available" || state === "output-error";
    }
    return false;
  });
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
  ).filter(isRenderableMessage);
}

export default function StudioDraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations();
  const router = useRouter();
  const initialPrompt = useSearchParams().get("prompt") ?? undefined;
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [accountId, setAccountId] = useState<string | null>(null);
  const [author, setAuthor] = useState<{ name: string; avatarUrl: string | null }>({ name: "", avatarUrl: null });
  const [state, setState] = useState<PageState>("loading");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [sourceFeedItem, setSourceFeedItem] = useState<SourceFeedItem | null>(null);

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
      const data = (await res.json()) as { draft: Draft; sourceFeedItem?: SourceFeedItem | null };
      applyDraft(data.draft);
      setSourceFeedItem(data.sourceFeedItem ?? null);
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
  // Capture the chat history ONCE, on the first render a draft is loaded. After
  // that useChat owns the live message stream — re-syncing it from `draft` on
  // every setDraft (e.g. after each finished turn) churned the messages
  // reference and looped the canvas-mirror effect ("Maximum update depth
  // exceeded"). Navigating to another draft remounts this page, resetting it.
  const initialChatRef = useRef<UIMessage[] | null>(null);
  if (initialChatRef.current === null && draft) {
    initialChatRef.current = toInitialMessages(draft.chat);
  }
  const initialMessages = initialChatRef.current ?? NO_MESSAGES;

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
          initialPrompt={initialPrompt}
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
          {author.name && (
            <>
              <span className="text-border" aria-hidden>
                |
              </span>
              <a
                href={accountId ? `/accounts/${accountId}` : "#"}
                className="hover:bg-accent flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 transition-colors"
                title={t("studio.postingAs", { name: author.name })}
              >
                {author.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={author.avatarUrl} alt="" className="size-6 shrink-0 rounded-full object-cover" />
                ) : (
                  <div className="bg-primary/10 text-primary grid size-6 shrink-0 place-items-center rounded-full text-[10px] font-semibold">
                    {author.name.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <span className="text-muted-foreground hover:text-foreground truncate text-sm transition-colors">
                  {t("studio.postingAs", { name: author.name })}
                </span>
              </a>
            </>
          )}
          <Badge variant={statusVariant(draft?.status ?? "draft")} className="capitalize">
            {draft?.status}
          </Badge>
          {sourceFeedItem && (
            <a
              href={sourceFeedItem.url}
              target="_blank"
              rel="noreferrer"
              title={sourceFeedItem.title}
              className="text-muted-foreground hover:text-foreground hover:bg-accent flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors"
            >
              <Newspaper className="size-3.5 shrink-0" />
              <span className="max-w-[18rem] truncate">
                {t("studio.basedOn", { title: sourceFeedItem.title })}
              </span>
            </a>
          )}
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
              onClick={() => setConfirmDelete(true)}
              disabled={deleting}
              aria-label={t("studio.delete")}
              className="text-muted-foreground hover:text-destructive size-8"
            >
              <Trash2 className="size-4" />
            </Button>
            <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
              <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                  <DialogTitle>{t("studio.deleteTitle")}</DialogTitle>
                  <DialogDescription>{t("studio.deleteBody")}</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setConfirmDelete(false)} disabled={deleting}>
                    {t("studio.deleteCancel")}
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => {
                      setConfirmDelete(false);
                      void deleteDraft();
                    }}
                    disabled={deleting}
                  >
                    {t("studio.delete")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
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
