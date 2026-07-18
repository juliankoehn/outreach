"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { RefreshCw, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { Account } from "@/lib/accounts";
import type { ChatMessage, CreatorProfile } from "@/lib/profile";

type PageState = "loading" | "no-account" | "interview" | "profile";

interface EditableFields {
  goals: string;
  audience: string;
  pillars: string;
  noGos: string;
  toneWords: string;
  languages: string;
  positioning: string;
  brandBrief: string;
}

function toFields(p: CreatorProfile): EditableFields {
  return {
    goals: p.goals.join(", "),
    audience: p.audience,
    pillars: p.pillars.join(", "),
    noGos: p.noGos.join(", "),
    toneWords: p.toneWords.join(", "),
    languages: p.languages.join(", "),
    positioning: p.positioning,
    brandBrief: p.brandBrief,
  };
}

function toPayload(f: EditableFields) {
  const list = (s: string) =>
    s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  return {
    goals: list(f.goals),
    audience: f.audience,
    pillars: list(f.pillars),
    noGos: list(f.noGos),
    toneWords: list(f.toneWords),
    languages: list(f.languages),
    positioning: f.positioning,
    brandBrief: f.brandBrief,
  };
}

export default function ProfilePage() {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();

  const [accountId, setAccountId] = useState<string | null>(null);
  const [state, setState] = useState<PageState>("loading");

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const [profile, setProfile] = useState<CreatorProfile | null>(null);
  const [fields, setFields] = useState<EditableFields | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [hasPosts, setHasPosts] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeNote, setAnalyzeNote] = useState<{ text: string; muted?: boolean } | null>(null);

  const transcriptRef = useRef<HTMLDivElement>(null);

  const startInterview = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/profile/${id}/interview/start`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale }),
      });
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      if (res.ok) {
        const d = (await res.json()) as { messages: ChatMessage[] };
        setMessages(d.messages);
      }
      setState("interview");
    },
    [router, locale],
  );

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
        setState("no-account");
        return;
      }
      const { accounts } = (await accRes.json()) as { accounts: Account[] };
      const first = accounts[0];
      if (!first) {
        setState("no-account");
        return;
      }
      setAccountId(first.id);

      const postsRes = await fetch(`/api/linkedin/accounts/${first.id}/posts`, {
        credentials: "include",
      });
      if (alive && postsRes.ok) {
        const { posts } = (await postsRes.json()) as { posts: unknown[] };
        setHasPosts(posts.length > 0);
      }

      const res = await fetch(`/api/profile/${first.id}`, { credentials: "include" });
      if (!alive) return;
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      if (res.ok) {
        const { profile: p } = (await res.json()) as { profile: CreatorProfile | null };
        if (p?.status === "ready") {
          setProfile(p);
          setFields(toFields(p));
          setState("profile");
          return;
        }
      }
      void startInterview(first.id);
    })();
    return () => {
      alive = false;
    };
  }, [router, startInterview]);

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight });
  }, [messages, thinking]);

  async function sendReply() {
    const text = draft.trim();
    if (!text || !accountId || thinking) return;
    setDraft("");
    setMessages((m) => [...m, { role: "user", content: text }]);
    setThinking(true);
    const res = await fetch(`/api/profile/${accountId}/interview/reply`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, locale }),
    });
    setThinking(false);
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (res.ok) {
      const d = (await res.json()) as { reply: string };
      setMessages((m) => [...m, { role: "assistant", content: d.reply }]);
    }
  }

  async function finish() {
    if (!accountId) return;
    setFinishing(true);
    const res = await fetch(`/api/profile/${accountId}/interview/finalize`, {
      method: "POST",
      credentials: "include",
    });
    setFinishing(false);
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (res.ok) {
      const d = (await res.json()) as { profile: CreatorProfile };
      setProfile(d.profile);
      setFields(toFields(d.profile));
      setState("profile");
    }
  }

  async function save() {
    if (!accountId || !fields) return;
    setSaving(true);
    setSaved(false);
    const res = await fetch(`/api/profile/${accountId}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toPayload(fields)),
    });
    setSaving(false);
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (res.ok) {
      const d = (await res.json()) as { profile: CreatorProfile };
      setProfile(d.profile);
      setFields(toFields(d.profile));
      setSaved(true);
    }
  }

  async function analyze() {
    if (!accountId) return;
    setAnalyzing(true);
    setAnalyzeNote(null);
    const res = await fetch(`/api/profile/${accountId}/analyze`, {
      method: "POST",
      credentials: "include",
    });
    setAnalyzing(false);
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (res.status === 409) {
      setAnalyzeNote({ text: t("profile.analyzeNoPosts"), muted: true });
      return;
    }
    if (res.ok) {
      const d = (await res.json()) as { derived: NonNullable<CreatorProfile["derived"]> };
      setProfile((p) => (p ? { ...p, derived: d.derived } : p));
      setAnalyzeNote({ text: t("profile.analyzed") });
    } else {
      setAnalyzeNote({ text: t("errors.generic"), muted: true });
    }
  }

  function rerun() {
    if (!accountId) return;
    setProfile(null);
    setFields(null);
    setMessages([]);
    setState("loading");
    void startInterview(accountId);
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("profile.title")}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t("profile.subtitle")}</p>
      </div>

      {state === "loading" && (
        <div className="mt-6 space-y-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      )}

      {state === "no-account" && (
        <div className="text-muted-foreground mt-6 rounded-xl border border-dashed py-10 text-center text-sm">
          <p>{t("profile.emptyNoAccount")}</p>
          <Button asChild variant="outline" className="mt-4">
            <a href="/accounts">{t("profile.goToAccounts")}</a>
          </Button>
        </div>
      )}

      {state === "interview" && (
        <Card className="mt-6 gap-0 overflow-hidden py-0">
          <CardHeader className="border-b px-5 py-3">
            <CardTitle className="text-sm">{t("profile.interviewTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div ref={transcriptRef} className="max-h-[28rem] space-y-3 overflow-y-auto p-5">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
                >
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
                    {t("profile.thinking")}
                  </div>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 border-t p-3">
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void sendReply();
                  }
                }}
                placeholder={t("profile.messagePlaceholder")}
                disabled={thinking}
              />
              <Button onClick={() => void sendReply()} disabled={thinking || !draft.trim()} size="icon">
                <Send className="size-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {state === "interview" && (
        <div className="mt-4 flex justify-end">
          <Button variant="outline" onClick={() => void finish()} disabled={finishing}>
            <Sparkles className={cn("size-4", finishing && "animate-pulse")} />
            {finishing ? t("profile.finishing") : t("profile.finish")}
          </Button>
        </div>
      )}

      {state === "profile" && profile && fields && (
        <div className="mt-6 space-y-6">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="text-sm">{t("profile.profileReady")}</CardTitle>
              <Button variant="ghost" size="sm" onClick={rerun} className="text-muted-foreground -mr-2 h-7">
                <RefreshCw className="size-3.5" />
                {t("profile.rerun")}
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field label={t("profile.goals")} hint={t("profile.listHint")}>
                <Input value={fields.goals} onChange={(e) => setFields({ ...fields, goals: e.target.value })} />
              </Field>
              <Field label={t("profile.audience")}>
                <Input value={fields.audience} onChange={(e) => setFields({ ...fields, audience: e.target.value })} />
              </Field>
              <Field label={t("profile.pillars")} hint={t("profile.listHint")}>
                <Input value={fields.pillars} onChange={(e) => setFields({ ...fields, pillars: e.target.value })} />
              </Field>
              <Field label={t("profile.noGos")} hint={t("profile.listHint")}>
                <Input value={fields.noGos} onChange={(e) => setFields({ ...fields, noGos: e.target.value })} />
              </Field>
              <Field label={t("profile.toneWords")} hint={t("profile.listHint")}>
                <Input
                  value={fields.toneWords}
                  onChange={(e) => setFields({ ...fields, toneWords: e.target.value })}
                />
              </Field>
              <Field label={t("profile.languages")} hint={t("profile.listHint")}>
                <Input
                  value={fields.languages}
                  onChange={(e) => setFields({ ...fields, languages: e.target.value })}
                />
              </Field>
              <Field label={t("profile.positioning")}>
                <Input
                  value={fields.positioning}
                  onChange={(e) => setFields({ ...fields, positioning: e.target.value })}
                />
              </Field>
              <Field label={t("profile.brandBrief")}>
                <Textarea
                  value={fields.brandBrief}
                  onChange={(e) => setFields({ ...fields, brandBrief: e.target.value })}
                  className="min-h-40"
                />
              </Field>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <Button onClick={() => void save()} disabled={saving}>
                  {saving ? t("profile.saving") : t("profile.save")}
                </Button>
                {saved && <span className="text-success text-sm">{t("profile.saved")}</span>}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t("profile.derivedTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {profile.derived ? (
                <div className="space-y-3 text-sm">
                  <div>
                    <div className="text-muted-foreground text-xs font-medium">
                      {t("profile.voiceSummary")}
                    </div>
                    <p className="mt-1">{profile.derived.voiceSummary}</p>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs font-medium">{t("profile.themes")}</div>
                    <p className="mt-1">{profile.derived.themes.join(", ")}</p>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs font-medium">
                      {t("profile.styleTraits")}
                    </div>
                    <p className="mt-1">{profile.derived.styleTraits.join(", ")}</p>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs font-medium">{t("profile.cadence")}</div>
                    <p className="mt-1">{profile.derived.cadence}</p>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs font-medium">
                      {t("profile.topPatterns")}
                    </div>
                    <p className="mt-1">{profile.derived.topPatterns.join(", ")}</p>
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">
                  {hasPosts ? "" : t("profile.analyzeNoPosts")}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" onClick={() => void analyze()} disabled={analyzing || !hasPosts}>
                  <RefreshCw className={cn("size-4", analyzing && "animate-spin")} />
                  {analyzing ? t("profile.analyzing") : t("profile.analyze")}
                </Button>
                {analyzeNote && (
                  <span className={cn("text-sm", analyzeNote.muted ? "text-muted-foreground" : "text-success")}>
                    {analyzeNote.text}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-sm font-medium">
        {label}
        {hint && <span className="text-muted-foreground ml-2 text-xs font-normal">{hint}</span>}
      </label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
