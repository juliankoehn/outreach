"use client";

import { useEffect, useMemo, useRef } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart, type ToolUIPart, type UIMessage } from "ai";
import { useTranslations } from "next-intl";
import { Sparkles } from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { KnowledgeSources, type KnowledgeSource } from "@/components/ai-elements/knowledge-sources";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "@/components/ai-elements/tool";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";

interface StudioChatProps {
  accountId: string;
  draftId: string;
  initialMessages: UIMessage[];
  onPostText: (text: string) => void;
  onImageUrl: (url: string) => void;
  onTurnFinished: () => void;
}

// Friendlier labels than the raw tool name for the collapsible tool cards.
function toolTitle(type: ToolUIPart["type"], t: (k: string) => string): string {
  if (type === "tool-updatePost") return t("studio.toolUpdatedPost");
  if (type === "tool-generateImage") return t("studio.toolGeneratedImage");
  if (type === "tool-findSimilarPosts") return t("studio.toolFindSimilar");
  return type.replace(/^tool-/, "");
}

export function StudioChat({
  accountId,
  draftId,
  initialMessages,
  onPostText,
  onImageUrl,
  onTurnFinished,
}: StudioChatProps) {
  const t = useTranslations();

  const transport = useMemo(
    () => new DefaultChatTransport({ api: `/api/studio/${accountId}/drafts/${draftId}/agent` }),
    [accountId, draftId],
  );

  const { messages, sendMessage, status } = useChat({
    transport,
    messages: initialMessages,
    onFinish: () => onTurnFinished(),
  });

  // Mirror the agent's tool activity onto the canvas as it streams: updatePost's
  // (partial) text types out live, generateImage's URL lands when it's ready.
  const lastText = useRef<string | null>(null);
  const lastImage = useRef<string | null>(null);
  useEffect(() => {
    for (const m of messages) {
      if (m.role !== "assistant") continue;
      for (const part of m.parts) {
        if (!isToolUIPart(part)) continue;
        if (part.type === "tool-updatePost") {
          const text = (part.input as { text?: string } | undefined)?.text;
          if (typeof text === "string" && text !== lastText.current) {
            lastText.current = text;
            onPostText(text);
          }
        }
        if (part.type === "tool-generateImage") {
          const url = (part.output as { imageUrl?: string } | undefined)?.imageUrl;
          if (typeof url === "string" && url !== lastImage.current) {
            lastImage.current = url;
            onImageUrl(url);
          }
        }
      }
    }
  }, [messages, onPostText, onImageUrl]);

  return (
    <aside className="bg-sidebar/40 flex h-[42vh] w-full shrink-0 flex-col border-t lg:h-full lg:w-[380px] lg:border-t-0 lg:border-r">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <span className="text-sm font-medium">{t("studio.chatTitle")}</span>
      </div>

      <Conversation className="min-h-0 flex-1">
        <ConversationContent className="gap-4">
          {messages.length === 0 && (
            <ConversationEmptyState
              icon={<Sparkles className="size-5" />}
              title={t("studio.chatTitle")}
              description={t("studio.chatHint")}
            />
          )}

          {messages.map((m, mi) => (
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
                // Our agent only defines static tools, so the part type is
                // always `tool-<name>` (never the dynamic-tool variant).
                if (isToolUIPart(part) && part.type !== "dynamic-tool") {
                  // The sources the agent grounded on render as a quiet
                  // collapsible, not the raw JSON tool card the others use.
                  if (part.type === "tool-searchKnowledge") {
                    if (part.state === "output-available") {
                      return (
                        <KnowledgeSources
                          key={i}
                          sources={part.output as KnowledgeSource[] | undefined}
                        />
                      );
                    }
                    if (part.state === "input-streaming" || part.state === "input-available") {
                      return <KnowledgeSources key={i} searching />;
                    }
                    return null;
                  }
                  return (
                    <Tool key={i} className="w-full">
                      <ToolHeader type={part.type} state={part.state} title={toolTitle(part.type, t)} />
                      <ToolContent>
                        <ToolInput input={part.input} />
                        <ToolOutput output={part.output} errorText={part.errorText} />
                      </ToolContent>
                    </Tool>
                  );
                }
                return null;
              })}
            </Message>
          ))}
          {status === "submitted" && (
            <div className="flex justify-start">
              <div className="bg-muted text-muted-foreground rounded-2xl rounded-bl-sm px-3.5 py-2 text-sm">
                {t("studio.thinking")}
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
            <PromptInputTextarea placeholder={t("studio.chatPlaceholder")} />
          </PromptInputBody>
          <PromptInputFooter>
            <span />
            <PromptInputSubmit status={status} />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </aside>
  );
}
