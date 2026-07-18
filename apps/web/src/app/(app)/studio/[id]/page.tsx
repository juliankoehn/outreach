"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, ImagePlus, RefreshCw, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { Account } from "@/lib/accounts";
import type { ChatMessage, Draft } from "@/lib/studio";

type PageState = "loading" | "not-found" | "ready";

function statusVariant(status: string): "success" | "muted" | "secondary" {
  if (status === "published") return "success";
  if (status === "scheduled") return "secondary";
  return "muted";
}

export default function StudioDraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations();
  const router = useRouter();

  const [accountId, setAccountId] = useState<string | null>(null);
  const [state, setState] = useState<PageState>("loading");
  const [draft, setDraft] = useState<Draft | null>(null);

  const [postText, setPostText] = useState("");
  const [imagePrompt, setImagePrompt] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [topic, setTopic] = useState("");

  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [thinking, setThinking] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [noProfile, setNoProfile] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const transcriptRef = useRef<HTMLDivElement>(null);
  const savedTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyDraft = useCallback((d: Draft) => {
    setDraft(d);
    setPostText(d.text);
    setImageUrl(d.imageUrl);
    setImagePrompt((prev) => {
      if (prev.trim()) return prev;
      if (d.imagePrompt) return d.imagePrompt;
      const firstLine = d.text.split("\n").find((line) => line.trim().length > 0) ?? "";
      return firstLine.trim();
    });
    setChat(d.chat);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const accRes = await fetch("/api/linkedin/accounts", { credentials: "include" });
      if (!alive) return;
      if (accRes.status === 401) {
        router.push("/login");
        return;
      }
      if (!accRes.ok) {
        setState("not-found");
        return;
      }
      const { accounts } = (await accRes.json()) as { accounts: Account[] };
      const first = accounts[0];
      if (!first) {
        setState("not-found");
        return;
      }
      setAccountId(first.id);

      const res = await fetch(`/api/studio/${first.id}/drafts/${id}`, { credentials: "include" });
      if (!alive) return;
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      if (res.status === 404) {
        setState("not-found");
        return;
      }
      if (res.ok) {
        const d = (await res.json()) as { draft: Draft };
        applyDraft(d.draft);
        setState("ready");
        return;
      }
      setState("not-found");
    })();
    return () => {
      alive = false;
    };
  }, [id, router, applyDraft]);

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight });
  }, [chat, thinking]);

  useEffect(() => {
    return () => {
      if (savedTimeout.current) clearTimeout(savedTimeout.current);
    };
  }, []);

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
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (res.ok) {
      const d = (await res.json()) as { draft: Draft };
      setDraft(d.draft);
      flashSaved();
    }
  }

  async function sendChat() {
    const instruction = chatDraft.trim();
    if (!instruction || !accountId || thinking) return;
    setChatDraft("");
    setChat((m) => [...m, { role: "user", content: instruction }]);
    setThinking(true);
    const res = await fetch(`/api/studio/${accountId}/drafts/${id}/chat`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruction }),
    });
    setThinking(false);
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (res.ok) {
      const d = (await res.json()) as { draft: Draft };
      applyDraft(d.draft);
    }
  }

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
    if (res.status === 401) {
      router.push("/login");
      return;
    }
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
      const d = (await res.json()) as { draft: Draft };
      applyDraft(d.draft);
    }
  }

  async function deleteDraft() {
    if (!accountId || deleting) return;
    setDeleting(true);
    const res = await fetch(`/api/studio/${accountId}/drafts/${id}`, {
      method: "DELETE",
      credentials: "include",
    });
    setDeleting(false);
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (res.ok) {
      router.push("/studio");
    }
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <a
        href="/studio"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
      >
        <ArrowLeft className="size-4" />
        {t("studio.back")}
      </a>

      {state === "loading" && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-96 w-full rounded-xl" />
          <Skeleton className="h-96 w-full rounded-xl" />
        </div>
      )}

      {state === "not-found" && (
        <div className="text-muted-foreground mt-6 rounded-xl border border-dashed py-10 text-center text-sm">
          <p>{t("studio.notFound")}</p>
          <Button asChild variant="outline" className="mt-4">
            <a href="/studio">{t("studio.back")}</a>
          </Button>
        </div>
      )}

      {state === "ready" && draft && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card className="gap-0 overflow-hidden py-0">
            <CardHeader className="border-b px-5 py-3">
              <CardTitle className="text-sm">{t("studio.chatTitle")}</CardTitle>
              <p className="text-muted-foreground text-xs">{t("studio.chatHint")}</p>
            </CardHeader>
            <CardContent className="p-0">
              <div ref={transcriptRef} className="max-h-[28rem] min-h-[16rem] space-y-3 overflow-y-auto p-5">
                {chat.length === 0 && !thinking && (
                  <p className="text-muted-foreground text-sm">{t("studio.chatEmpty")}</p>
                )}
                {chat.map((m, i) => (
                  <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                    <div
                      className={cn(
                        "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap",
                        m.role === "user"
                          ? "bg-primary text-primary-foreground rounded-br-sm"
                          : "bg-muted rounded-bl-sm",
                      )}
                    >
                      {m.content}
                    </div>
                  </div>
                ))}
                {thinking && (
                  <div className="flex justify-start">
                    <div className="bg-muted text-muted-foreground rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm">
                      {t("studio.thinking")}
                    </div>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 border-t p-3">
                <Input
                  value={chatDraft}
                  onChange={(e) => setChatDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void sendChat();
                    }
                  }}
                  placeholder={t("studio.chatPlaceholder")}
                  disabled={thinking}
                />
                <Button
                  onClick={() => void sendChat()}
                  disabled={thinking || !chatDraft.trim()}
                  size="icon"
                >
                  <Send className="size-4" />
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">{t("studio.canvasTitle")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
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
                  }}
                  onBlur={() => {
                    if (postText !== draft.text) void savePatch({ text: postText });
                  }}
                  placeholder={t("studio.postPlaceholder")}
                  className="min-h-56"
                />

                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    placeholder={t("studio.topicPlaceholder")}
                    className="max-w-xs"
                  />
                  <Button variant="outline" onClick={() => void regenerate()} disabled={regenerating}>
                    <RefreshCw className={cn("size-4", regenerating && "animate-spin")} />
                    {regenerating ? t("studio.regenerating") : t("studio.regenerate")}
                  </Button>
                  <div className="ml-auto flex items-center gap-2">
                    {saved && <span className="text-success text-sm">{t("studio.saved")}</span>}
                    <Button
                      variant="outline"
                      onClick={() => void savePatch({ text: postText })}
                      disabled={saving || postText === draft.text}
                    >
                      {saving ? t("studio.saving") : t("studio.save")}
                    </Button>
                  </div>
                </div>

                <div className="space-y-3 border-t pt-4">
                  {imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={imageUrl}
                      alt=""
                      className="max-h-72 w-full rounded-lg border object-contain"
                    />
                  )}
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
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle className="text-sm">{t("studio.metaTitle")}</CardTitle>
                <Badge variant={statusVariant(draft.status)} className="capitalize">
                  {draft.status}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="text-muted-foreground flex justify-between">
                  <span>{t("studio.created")}</span>
                  <span>{new Date(draft.createdAt).toLocaleString()}</span>
                </div>
                <div className="text-muted-foreground flex justify-between">
                  <span>{t("studio.updated")}</span>
                  <span>{new Date(draft.updatedAt).toLocaleString()}</span>
                </div>
                <p className="text-muted-foreground border-t pt-3 text-xs">
                  {t("studio.publishingSoon")}
                </p>
                <div className="border-t pt-3">
                  <Button
                    variant="ghost"
                    onClick={() => void deleteDraft()}
                    disabled={deleting}
                    className="text-muted-foreground hover:text-destructive -ml-2"
                  >
                    <Trash2 className="size-4" />
                    {t("studio.delete")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
