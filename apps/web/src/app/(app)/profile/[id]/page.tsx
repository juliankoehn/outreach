"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, Check, RefreshCw, Send, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { Account } from "@/lib/accounts";
import type { ChatMessage, CreatorProfile } from "@/lib/profile";

type PageState = "loading" | "not-found" | "interview" | "editor";

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

export default function ProfileWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();

  const [state, setState] = useState<PageState>("loading");
  const [profile, setProfile] = useState<CreatorProfile | null>(null);
  const [name, setName] = useState("");
  const [nameSaving, setNameSaving] = useState(false);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [assigning, setAssigning] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const [fields, setFields] = useState<EditableFields | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeNote, setAnalyzeNote] = useState<{ text: string; muted?: boolean } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const transcriptRef = useRef<HTMLDivElement>(null);

  const startInterview = useCallback(async () => {
    const res = await fetch(`/api/profiles/${id}/interview/start`, {
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
  }, [id, router, locale]);

  const loadProfile = useCallback(async () => {
    const res = await fetch(`/api/profiles/${id}`, { credentials: "include" });
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (res.status === 404) {
      setState("not-found");
      return;
    }
    if (!res.ok) {
      setState("not-found");
      return;
    }
    const { profile: p } = (await res.json()) as { profile: CreatorProfile };
    setProfile(p);
    setName(p.name);
    if (p.status === "ready") {
      setFields(toFields(p));
      setState("editor");
    } else {
      void startInterview();
    }
  }, [id, router, startInterview]);

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

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight });
  }, [messages, thinking]);

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

  async function sendReply() {
    const text = draft.trim();
    if (!text || thinking) return;
    setDraft("");
    setMessages((m) => [...m, { role: "user", content: text }]);
    setThinking(true);
    const res = await fetch(`/api/profiles/${id}/interview/reply`, {
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
    setFinishing(true);
    const res = await fetch(`/api/profiles/${id}/interview/finalize`, {
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
      setState("editor");
    }
  }

  async function save() {
    if (!fields) return;
    setSaving(true);
    setSaved(false);
    const res = await fetch(`/api/profiles/${id}`, {
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

  async function analyze(accountId: string) {
    setAnalyzing(true);
    setAnalyzeNote(null);
    const res = await fetch(`/api/profiles/${id}/analyze`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId }),
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
    setFields(null);
    setMessages([]);
    setState("loading");
    void startInterview();
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

  const assignedIds = new Set((profile?.accounts ?? []).map((a) => a.id));

  return (
    <div className="mx-auto max-w-3xl p-6">
      <a
        href="/profile"
        className="text-muted-foreground hover:text-foreground mb-5 inline-flex items-center gap-1.5 text-sm transition-colors"
      >
        <ArrowLeft className="size-4" />
        {t("profile.backToProfiles")}
      </a>

      {state === "loading" && (
        <div className="space-y-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      )}

      {state === "not-found" && (
        <div className="text-muted-foreground rounded-xl border border-dashed py-10 text-center text-sm">
          <p>{t("profile.notFound")}</p>
          <Button asChild variant="outline" className="mt-4">
            <a href="/profile">{t("profile.backToProfiles")}</a>
          </Button>
        </div>
      )}

      {(state === "interview" || state === "editor") && profile && (
        <div className="space-y-6">
          <div className="flex items-center gap-3">
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

          {state === "interview" && (
            <>
              <Card className="gap-0 overflow-hidden py-0">
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

              <div className="flex justify-end">
                <Button variant="outline" onClick={() => void finish()} disabled={finishing}>
                  <Sparkles className={cn("size-4", finishing && "animate-pulse")} />
                  {finishing ? t("profile.finishing") : t("profile.finish")}
                </Button>
              </div>
            </>
          )}

          {state === "editor" && fields && (
            <>
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
                    <Input
                      value={fields.audience}
                      onChange={(e) => setFields({ ...fields, audience: e.target.value })}
                    />
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
                    <p className="text-muted-foreground text-sm">{t("profile.analyzeHint")}</p>
                  )}

                  <div className="flex flex-wrap items-center gap-3">
                    {(() => {
                      const candidates = profile.accounts && profile.accounts.length > 0 ? profile.accounts : accounts;
                      const target = candidates[0];
                      return (
                        <Button
                          variant="outline"
                          onClick={() => target && void analyze(target.id)}
                          disabled={analyzing || !target}
                        >
                          <RefreshCw className={cn("size-4", analyzing && "animate-spin")} />
                          {analyzing ? t("profile.analyzing") : t("profile.analyze")}
                        </Button>
                      );
                    })()}
                    {analyzeNote && (
                      <span
                        className={cn("text-sm", analyzeNote.muted ? "text-muted-foreground" : "text-success")}
                      >
                        {analyzeNote.text}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          {/* Assignment section (both states) */}
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
                          isAssigned
                            ? "bg-primary border-primary text-primary-foreground"
                            : "border-input",
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
