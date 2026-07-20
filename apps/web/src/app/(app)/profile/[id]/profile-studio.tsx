"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  isToolUIPart,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
} from "ai";
import { useLocale, useTranslations } from "next-intl";
import { Check, RefreshCw, Sparkles, X } from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { KnowledgeSources, type KnowledgeSource } from "@/components/ai-elements/knowledge-sources";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { Account } from "@/lib/accounts";
import type { CreatorProfile } from "@/lib/profile";
import { ProfileCanvas, type CanvasProfile, type ExamplePost } from "./profile-canvas";
import { VisualsCard } from "./visuals-card";

interface ProfileStudioProps {
  profileId: string;
  embedded?: boolean;
}

// Same patch shape the backend agent's `updateProfile` tool accepts (see
// packages/ai/src/profile-studio.ts) — kept local since the web app doesn't
// depend on @outreach/ai directly.
interface ProfilePatch {
  voice?: string;
  toneWords?: string[];
  pillars?: string[];
  audience?: string;
  positioning?: string;
  visualStyle?: string;
  noGos?: string[];
  brandBrief?: string;
}

// Embedded (account Profile tab) → fill the parent flex column so the chat
// input stays pinned and only the message list scrolls. Standalone → a tall
// fixed height (the page itself scrolls).
const studioHeight = (embedded?: boolean) =>
  embedded ? "min-h-0 flex-1" : "h-[calc(100vh-14rem)] min-h-[32rem]";

function mapProfileToCanvas(profile: CreatorProfile | null): CanvasProfile {
  if (!profile) return {};
  return {
    toneWords: profile.toneWords,
    pillars: profile.pillars,
    audience: profile.audience,
    positioning: profile.positioning,
    visualStyle: profile.derived?.visualStyle,
    noGos: profile.noGos,
    brandBrief: profile.brandBrief,
  };
}

function mergeDedupe(base: string[] | undefined, additions: string[] | undefined): string[] | undefined {
  if (!additions || additions.length === 0) return base;
  const arr = [...(base ?? [])];
  for (const raw of additions) {
    const val = raw.trim();
    if (val && !arr.some((x) => x.toLowerCase() === val.toLowerCase())) arr.push(val);
  }
  return arr;
}

// Mirrors the server's merge rules for `updateProfile` patches (see the route
// handler's comment in apps/api/src/routes/profile.ts): tone-ish arrays merge
// + dedupe, `voice` folds into toneWords, prose fields replace outright.
function applyProfilePatch(
  prev: CanvasProfile,
  patch: ProfilePatch,
): { next: CanvasProfile; changedKey: keyof CanvasProfile | null } {
  const next: CanvasProfile = { ...prev };
  let changedKey: keyof CanvasProfile | null = null;

  // `voice` is a prose description → the server folds it into the brand brief
  // (not the tone chips). Mirror that: only real toneWords become chips.
  if (patch.toneWords && patch.toneWords.length > 0) {
    next.toneWords = mergeDedupe(prev.toneWords, patch.toneWords);
    changedKey = "toneWords";
  }
  if (patch.pillars && patch.pillars.length > 0) {
    next.pillars = mergeDedupe(prev.pillars, patch.pillars);
    changedKey = "pillars";
  }
  if (patch.noGos && patch.noGos.length > 0) {
    next.noGos = mergeDedupe(prev.noGos, patch.noGos);
    changedKey = "noGos";
  }
  if (patch.audience !== undefined) {
    next.audience = patch.audience;
    changedKey = "audience";
  }
  if (patch.positioning !== undefined) {
    next.positioning = patch.positioning;
    changedKey = "positioning";
  }
  if (patch.visualStyle !== undefined) {
    next.visualStyle = patch.visualStyle;
    changedKey = "visualStyle";
  }
  if (patch.brandBrief !== undefined) {
    next.brandBrief = patch.brandBrief;
    changedKey = "brandBrief";
  }
  return { next, changedKey };
}

export function ProfileStudio({ profileId, embedded }: ProfileStudioProps) {
  const locale = useLocale();
  const [initial, setInitial] = useState<UIMessage[] | null>(null);
  const [initialProfile, setInitialProfile] = useState<CreatorProfile | null>(null);
  const [author, setAuthor] = useState<{ name: string; avatarUrl?: string | null }>({ name: "" });
  const [accountId, setAccountId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    setInitial(null);
    setReady(false);
    void (async () => {
      const [startRes, profileRes, accountsRes] = await Promise.all([
        fetch(`/api/profiles/${profileId}/interview/start`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ locale }),
        }),
        fetch(`/api/profiles/${profileId}`, { credentials: "include" }),
        fetch("/api/linkedin/accounts", { credentials: "include" }),
      ]);
      if (!alive) return;

      setInitial(startRes.ok ? ((await startRes.json()) as { messages: UIMessage[] }).messages : []);

      const profile = profileRes.ok ? ((await profileRes.json()) as { profile: CreatorProfile }).profile : null;
      if (!alive) return;
      setInitialProfile(profile);

      const accounts = accountsRes.ok ? ((await accountsRes.json()) as { accounts: Account[] }).accounts : [];
      const assignedIds = new Set((profile?.accounts ?? []).map((a) => a.id));
      const chosen = accounts.find((a) => assignedIds.has(a.id)) ?? accounts[0] ?? null;
      if (!alive) return;
      setAccountId(chosen?.id ?? null);
      setAuthor(chosen ? { name: chosen.displayName, avatarUrl: chosen.avatarUrl ?? null } : { name: "" });
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, [profileId, locale]);

  if (!initial || !ready) {
    return (
      <div className={cn("flex flex-col-reverse lg:flex-row", studioHeight(embedded))}>
        <Card className="flex h-full w-full flex-col p-5 lg:w-[40%]">
          <Skeleton className="h-full w-full" />
        </Card>
        <div className="hidden flex-1 lg:block" />
      </div>
    );
  }

  return (
    <ProfileStudioInner
      profileId={profileId}
      locale={locale}
      initial={initial}
      embedded={embedded}
      initialProfile={initialProfile}
      author={author}
      accountId={accountId}
    />
  );
}

// Which tool-part types drive the canvas rather than the chat — we still
// surface a tiny "updated" chip for them, but never a full card.
function isCanvasToolType(type: string): boolean {
  return (
    type === "tool-updateProfile" ||
    type === "tool-writeExamplePost" ||
    type === "tool-generateExampleImage"
  );
}

function ProfileStudioInner({
  profileId,
  locale,
  initial,
  embedded,
  initialProfile,
  author,
  accountId,
}: {
  profileId: string;
  locale: string;
  initial: UIMessage[];
  embedded?: boolean;
  initialProfile: CreatorProfile | null;
  author: { name: string; avatarUrl?: string | null };
  accountId: string | null;
}) {
  const t = useTranslations();

  const [canvasProfile, setCanvasProfile] = useState<CanvasProfile>(() => mapProfileToCanvas(initialProfile));
  // Full profile row (kept alongside the mapped canvas view) so the Visuals card
  // has visualPreset/visualDirection/derived and stays in sync after analyze.
  const [fullProfile, setFullProfile] = useState<CreatorProfile | null>(initialProfile);
  const [examplePosts, setExamplePosts] = useState<ExamplePost[]>([]);
  const [regeneratingIndex, setRegeneratingIndex] = useState<number | null>(null);
  const [lastChangedKey, setLastChangedKey] = useState<keyof CanvasProfile | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeNote, setAnalyzeNote] = useState<{ text: string; muted?: boolean; addPostsAccountId?: string } | null>(
    null,
  );

  const refetchProfile = useCallback(async () => {
    const res = await fetch(`/api/profiles/${profileId}`, { credentials: "include" });
    if (res.ok) {
      const { profile } = (await res.json()) as { profile: CreatorProfile };
      setCanvasProfile(mapProfileToCanvas(profile));
      setFullProfile(profile);
    }
  }, [profileId]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `/api/profiles/${profileId}/studio`,
        credentials: "include",
        body: { locale },
      }),
    [profileId, locale],
  );

  const { messages, sendMessage, addToolResult, status } = useChat({
    transport,
    messages: initial,
    // Human-in-the-loop: proposeConfirm/proposeOptions have no server execute, so
    // the agent pauses after proposing. Once the user's decision is added as a
    // tool result, this auto-continues the agent (it commits + proposes next).
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onFinish: () => void refetchProfile(),
  });

  // Mirror the agent's `updateProfile`/`writeExamplePost` tool calls onto the
  // canvas live, once each call has fully landed (guards against re-applying
  // a still-streaming partial input more than once).
  const processedToolCalls = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const m of messages) {
      if (m.role !== "assistant") continue;
      for (const part of m.parts) {
        if (!isToolUIPart(part) || part.type === "dynamic-tool") continue;
        if (part.state !== "output-available") continue;
        if (processedToolCalls.current.has(part.toolCallId)) continue;

        if (part.type === "tool-updateProfile") {
          processedToolCalls.current.add(part.toolCallId);
          const patch = part.input as ProfilePatch | undefined;
          if (patch) {
            setCanvasProfile((prev) => {
              const { next, changedKey } = applyProfilePatch(prev, patch);
              if (changedKey) setLastChangedKey(changedKey);
              return next;
            });
          }
        } else if (part.type === "tool-writeExamplePost") {
          processedToolCalls.current.add(part.toolCallId);
          const text = (part.input as { text?: string } | undefined)?.text?.trim();
          // Only ever show THE current example post — a revision replaces it in
          // place rather than piling a second draft next to the old one. A new
          // post text drops any image from the previous one until regenerated.
          if (text) setExamplePosts([{ text }]);
        } else if (part.type === "tool-generateExampleImage") {
          processedToolCalls.current.add(part.toolCallId);
          const imageUrl = (part.output as { imageUrl?: string } | undefined)?.imageUrl;
          // Attach the generated image to the current example post in place.
          if (imageUrl) {
            setExamplePosts((prev) =>
              prev.length ? [{ ...prev[prev.length - 1]!, imageUrl }] : [{ text: "", imageUrl }],
            );
          }
        }
      }
    }
  }, [messages]);

  // The single unresolved proposal, if any. Human-in-the-loop tools stay
  // `input-available` until the user answers, and the agent won't proceed until
  // then — so there's at most one open proposal at a time.
  const pending = useMemo<{ toolCallId: string; tool: "proposeConfirm" | "proposeOptions" } | null>(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m?.role !== "assistant") continue;
      for (const part of m.parts) {
        if (!isToolUIPart(part) || part.type === "dynamic-tool") continue;
        if (part.type === "tool-proposeConfirm" && part.state === "input-available") {
          return { toolCallId: part.toolCallId, tool: "proposeConfirm" };
        }
        if (part.type === "tool-proposeOptions" && part.state === "input-available") {
          return { toolCallId: part.toolCallId, tool: "proposeOptions" };
        }
      }
    }
    return null;
  }, [messages]);

  // True while an image is being generated (tool called, output not back yet)
  // so the canvas can show a placeholder in the post preview.
  const imageLoading = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m?.role !== "assistant") continue;
      for (const part of m.parts) {
        if (!isToolUIPart(part) || part.type !== "tool-generateExampleImage") continue;
        if (part.state === "input-streaming" || part.state === "input-available") return true;
      }
    }
    return false;
  }, [messages]);

  async function editField(field: "audience" | "positioning", value: string) {
    setCanvasProfile((prev) => ({ ...prev, [field]: value }));
    await fetch(`/api/profiles/${profileId}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
  }

  // Regenerate the example post's image on demand, in the profile's current
  // image look — no chat round-trip needed.
  async function regenerateExampleImage(index: number) {
    const post = examplePosts[index];
    if (!post || regeneratingIndex !== null) return;
    setRegeneratingIndex(index);
    try {
      const res = await fetch(`/api/profiles/${profileId}/example-image`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postText: post.text }),
      });
      if (res.ok) {
        const { imageUrl } = (await res.json()) as { imageUrl: string };
        setExamplePosts((prev) => prev.map((p, i) => (i === index ? { ...p, imageUrl } : p)));
      }
    } finally {
      setRegeneratingIndex(null);
    }
  }

  async function analyze() {
    if (!accountId || analyzing) return;
    setAnalyzing(true);
    setAnalyzeNote(null);
    const res = await fetch(`/api/profiles/${profileId}/analyze`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId }),
    });
    setAnalyzing(false);
    if (res.status === 409) {
      setAnalyzeNote({ text: t("profile.analyzeNoPosts"), muted: true, addPostsAccountId: accountId });
      return;
    }
    if (res.ok) {
      await refetchProfile();
      setAnalyzeNote({ text: t("profile.analyzed") });
    } else {
      setAnalyzeNote({ text: t("errors.generic"), muted: true });
    }
  }

  return (
    <div className={cn("flex flex-col-reverse lg:flex-row", studioHeight(embedded))}>
      <aside className="flex h-[42vh] w-full shrink-0 flex-col border-t lg:h-full lg:w-[40%] lg:border-t-0 lg:border-r">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <Sparkles className="text-primary size-4" />
          <span className="text-sm font-medium">{t("profile.psTitle")}</span>
          <div className="ml-auto flex items-center gap-2">
            {analyzeNote && (
              <span className={cn("text-xs", analyzeNote.muted ? "text-muted-foreground" : "text-success")}>
                {analyzeNote.text}
                {analyzeNote.addPostsAccountId && (
                  <a
                    href={`/accounts/${analyzeNote.addPostsAccountId}/posts`}
                    className="text-foreground ml-1 font-medium underline underline-offset-4"
                  >
                    {t("profile.addPostsCta")}
                  </a>
                )}
              </span>
            )}
            {accountId && (
              <Button variant="outline" size="sm" onClick={() => void analyze()} disabled={analyzing} className="h-7">
                <RefreshCw className={cn("size-3.5", analyzing && "animate-spin")} />
                {analyzing ? t("profile.analyzing") : t("profile.analyze")}
              </Button>
            )}
          </div>
        </div>

        <Conversation className="min-h-0 flex-1">
          <ConversationContent className="gap-4">
            {messages.length === 0 && (
              <ConversationEmptyState icon={<Sparkles className="size-5" />} title={t("profile.psTitle")} />
            )}
            {messages.map((m, mi) => {
              return (
                <Message from={m.role} key={m.id || `m-${mi}`}>
                  {m.parts.map((part, i) => {
                    if (part.type === "text") {
                      if (!part.text.trim()) return null;
                      return (
                        <MessageContent key={i}>
                          <MessageResponse>{part.text}</MessageResponse>
                        </MessageContent>
                      );
                    }

                    if (!isToolUIPart(part) || part.type === "dynamic-tool") return null;

                    // Grounding sources render as their own quiet collapsible,
                    // independent of the proposal-card state gate below.
                    if (part.type === "tool-searchKnowledge") {
                      if (part.state === "output-available") {
                        return (
                          <MessageContent key={i}>
                            <KnowledgeSources sources={part.output as KnowledgeSource[] | undefined} />
                          </MessageContent>
                        );
                      }
                      if (part.state === "input-streaming" || part.state === "input-available") {
                        return (
                          <MessageContent key={i}>
                            <KnowledgeSources searching />
                          </MessageContent>
                        );
                      }
                      return null;
                    }

                    if (part.state !== "output-available" && part.state !== "input-available") return null;

                    if (part.type === "tool-proposeConfirm") {
                      const input = part.input as { summary?: string } | undefined;
                      const summary = input?.summary?.trim();
                      if (!summary) return null;
                      const done = part.state === "output-available";
                      const accepted = (part.output as { accepted?: boolean } | undefined)?.accepted;
                      return (
                        <MessageContent key={i}>
                          <Card className={cn("gap-3 p-4", done && "opacity-70")}>
                            <p className="text-sm">{summary}</p>
                            {done ? (
                              <p
                                className={cn(
                                  "flex items-center gap-1.5 text-xs font-medium",
                                  accepted ? "text-success" : "text-muted-foreground",
                                )}
                              >
                                {accepted ? <Check className="size-3.5" /> : <X className="size-3.5" />}
                                {accepted ? t("profile.psAccept") : t("profile.psReject")}
                              </p>
                            ) : (
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  onClick={() =>
                                    void addToolResult({
                                      tool: "proposeConfirm",
                                      toolCallId: part.toolCallId,
                                      output: { accepted: true },
                                    })
                                  }
                                >
                                  <Check className="size-4" />
                                  {t("profile.psAccept")}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    void addToolResult({
                                      tool: "proposeConfirm",
                                      toolCallId: part.toolCallId,
                                      output: { accepted: false },
                                    })
                                  }
                                >
                                  <X className="size-4" />
                                  {t("profile.psReject")}
                                </Button>
                              </div>
                            )}
                          </Card>
                        </MessageContent>
                      );
                    }

                    if (part.type === "tool-proposeOptions") {
                      const input = part.input as
                        | { question?: string; options?: Array<{ label?: string }>; multi?: boolean }
                        | undefined;
                      const question = input?.question?.trim();
                      const labels = (input?.options ?? []).map((o) => o.label ?? "").filter(Boolean);
                      if (!question || labels.length === 0) return null;
                      const done = part.state === "output-available";
                      const picked = (part.output as { picked?: string[] } | undefined)?.picked ?? [];
                      return (
                        <MessageContent key={i}>
                          <OptionsCard
                            question={question}
                            options={labels}
                            multi={!!input?.multi}
                            done={done}
                            picked={picked}
                            sendText={t("profile.psSend")}
                            onPick={(chosen) =>
                              void addToolResult({
                                tool: "proposeOptions",
                                toolCallId: part.toolCallId,
                                output: { picked: chosen },
                              })
                            }
                          />
                        </MessageContent>
                      );
                    }

                    if (isCanvasToolType(part.type) && part.state === "output-available") {
                      const label =
                        part.type === "tool-updateProfile" ? t("profile.psUpdated") : t("profile.psExampleWritten");
                      return (
                        <span key={i} className="text-muted-foreground text-xs italic">
                          {label}
                        </span>
                      );
                    }

                    return null;
                  })}
                </Message>
              );
            })}
            {status === "submitted" && (
              <div className="flex justify-start">
                <div className="bg-muted text-muted-foreground rounded-2xl rounded-bl-sm px-3.5 py-2 text-sm">
                  {t("profile.thinking")}
                </div>
              </div>
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <div className="border-t p-3">
          <PromptInput
            onSubmit={(message) => {
              const text = message.text.trim();
              if (!text) return;
              // If a proposal is open, deliver the free text as its note (this
              // resolves the tool call and auto-continues the agent). Otherwise
              // it's a normal message.
              if (pending) {
                void addToolResult({
                  tool: pending.tool,
                  toolCallId: pending.toolCallId,
                  output: pending.tool === "proposeConfirm" ? { accepted: false, note: text } : { picked: [], note: text },
                });
              } else {
                void sendMessage({ text });
              }
            }}
          >
            <PromptInputBody>
              <PromptInputTextarea placeholder={t("profile.psPlaceholder")} />
            </PromptInputBody>
            <PromptInputFooter>
              <span />
              <PromptInputSubmit status={status} />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </aside>

      {/* Canvas pane */}
      <div className="min-h-0 flex-1">
        <ProfileCanvas
          profile={canvasProfile}
          examplePosts={examplePosts}
          imageLoading={imageLoading}
          author={author}
          lastChangedKey={lastChangedKey}
          onEditField={(field, value) => void editField(field, value)}
          onRegenerateImage={(i) => void regenerateExampleImage(i)}
          regeneratingIndex={regeneratingIndex}
          visualsSlot={
            fullProfile && (
              <VisualsCard profileId={profileId} profile={fullProfile} onUpdated={setFullProfile} />
            )
          }
        />
      </div>
    </div>
  );
}

function OptionsCard({
  question,
  options,
  multi,
  done,
  picked: pickedOutput,
  sendText,
  onPick,
}: {
  question: string;
  options: string[];
  multi: boolean;
  done: boolean;
  picked: string[];
  sendText: string;
  onPick: (chosen: string[]) => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const selected = done ? new Set(pickedOutput) : picked;

  return (
    <Card className={cn("gap-3 p-4", done && "opacity-70")}>
      <p className="text-sm">{question}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const isPicked = selected.has(option);
          return (
            <button
              key={option}
              type="button"
              disabled={done}
              onClick={() => {
                if (done) return;
                if (!multi) {
                  onPick([option]);
                  return;
                }
                setPicked((prev) => {
                  const next = new Set(prev);
                  if (next.has(option)) next.delete(option);
                  else next.add(option);
                  return next;
                });
              }}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                isPicked ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted",
                done && "cursor-not-allowed",
              )}
            >
              {option}
            </button>
          );
        })}
      </div>
      {multi && !done && (
        <Button
          size="sm"
          className="self-start"
          disabled={picked.size === 0}
          onClick={() => onPick(Array.from(picked))}
        >
          {sendText}
        </Button>
      )}
    </Card>
  );
}
