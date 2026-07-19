"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart, type UIMessage } from "ai";
import { useLocale, useTranslations } from "next-intl";
import { Loader2, Sparkles } from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
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

interface InterviewChatProps {
  profileId: string;
  onReady: () => void;
}

export function InterviewChat({ profileId, onReady }: InterviewChatProps) {
  const locale = useLocale();
  const [initial, setInitial] = useState<UIMessage[] | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch(`/api/profiles/${profileId}/interview/start`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale }),
      });
      if (res.ok) setInitial(((await res.json()) as { messages: UIMessage[] }).messages);
      else setInitial([]);
    })();
  }, [profileId, locale]);

  if (!initial) {
    return (
      <Card className="p-5">
        <Skeleton className="h-64 w-full" />
      </Card>
    );
  }
  return <InterviewChatInner profileId={profileId} locale={locale} initial={initial} onReady={onReady} />;
}

function InterviewChatInner({
  profileId,
  locale,
  initial,
  onReady,
}: {
  profileId: string;
  locale: string;
  initial: UIMessage[];
  onReady: () => void;
}) {
  const t = useTranslations();

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `/api/profiles/${profileId}/interview/agent`,
        credentials: "include",
        body: { locale },
      }),
    [profileId, locale],
  );

  const { messages, sendMessage, status } = useChat({ transport, messages: initial });

  // When the assistant calls buildProfile, the profile has been synthesized —
  // let the closing message stream in, then hand off to the editor.
  const building = messages.some((m) =>
    m.parts.some((p) => isToolUIPart(p) && p.type === "tool-buildProfile"),
  );
  const readyFired = useRef(false);
  useEffect(() => {
    const done = messages.some((m) =>
      m.parts.some((p) => isToolUIPart(p) && p.type === "tool-buildProfile" && p.state === "output-available"),
    );
    if (done && status === "ready" && !readyFired.current) {
      readyFired.current = true;
      const timer = setTimeout(onReady, 900);
      return () => clearTimeout(timer);
    }
  }, [messages, status, onReady]);

  return (
    <Card className="flex h-[62vh] flex-col gap-0 overflow-hidden py-0">
      <div className="flex items-center gap-2 border-b px-5 py-3">
        <Sparkles className="text-primary size-4" />
        <span className="text-sm font-medium">{t("profile.interviewTitle")}</span>
        {building && (
          <span className="text-muted-foreground ml-auto flex items-center gap-1.5 text-xs">
            <Loader2 className="size-3.5 animate-spin" />
            {t("profile.buildingProfile")}
          </span>
        )}
      </div>

      <Conversation className="min-h-0 flex-1">
        <ConversationContent className="gap-4">
          {messages.length === 0 && (
            <ConversationEmptyState icon={<Sparkles className="size-5" />} title={t("profile.interviewTitle")} />
          )}
          {messages.map((m) => (
            <Message from={m.role} key={m.id}>
              {m.parts.map((part, i) => {
                if (part.type === "text" && part.text.trim()) {
                  return (
                    <MessageContent key={i}>
                      <MessageResponse>{part.text}</MessageResponse>
                    </MessageContent>
                  );
                }
                return null;
              })}
            </Message>
          ))}
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
            if (text) void sendMessage({ text });
          }}
        >
          <PromptInputBody>
            <PromptInputTextarea placeholder={t("profile.messagePlaceholder")} />
          </PromptInputBody>
          <PromptInputFooter>
            <span />
            <PromptInputSubmit status={status} />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </Card>
  );
}
