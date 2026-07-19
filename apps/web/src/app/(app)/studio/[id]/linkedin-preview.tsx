"use client";

import { useTranslations } from "next-intl";
import { Globe, MessageSquare, MoreHorizontal, Repeat2, Send, ThumbsUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface LinkedInPreviewProps {
  authorName: string;
  avatarUrl?: string | null;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  imageUrl?: string | null;
  placeholder?: string;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "in";
  return (parts[0]![0]! + (parts[1]?.[0] ?? "")).toUpperCase();
}

// A LinkedIn-flavoured preview of the draft: author header, the editable post
// body styled like a real feed post, the image edge-to-edge, and a muted
// reaction bar. Adapts to the app theme rather than forcing LinkedIn's exact
// colours, so it reads as a preview in both light and dark.
export function LinkedInPreview({
  authorName,
  avatarUrl,
  value,
  onChange,
  onBlur,
  imageUrl,
  placeholder,
}: LinkedInPreviewProps) {
  const t = useTranslations();
  const name = authorName.trim() || "Your name";

  return (
    <div className="bg-card overflow-hidden rounded-xl border shadow-sm">
      {/* Author header */}
      <div className="flex items-start gap-2.5 px-4 pt-4">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt="" className="size-12 shrink-0 rounded-full object-cover" />
        ) : (
          <div className="bg-primary/10 text-primary flex size-12 shrink-0 items-center justify-center rounded-full text-sm font-semibold">
            {initials(name)}
          </div>
        )}
        <div className="min-w-0 flex-1 leading-tight">
          <div className="flex items-center gap-1">
            <span className="truncate text-[15px] font-semibold hover:text-[#0a66c2] hover:underline">
              {name}
            </span>
            <span className="text-muted-foreground text-xs">· {t("studio.lkYou")}</span>
          </div>
          <p className="text-muted-foreground truncate text-xs">{t("studio.lkSubtitle")}</p>
          <p className="text-muted-foreground mt-0.5 flex items-center gap-1 text-xs">
            <span>{t("studio.lkNow")}</span>
            <span aria-hidden>·</span>
            <Globe className="size-3" />
          </p>
        </div>
        <button
          type="button"
          className="text-muted-foreground hover:bg-accent -mr-1 grid size-8 place-items-center rounded-full"
          aria-hidden
          tabIndex={-1}
        >
          <MoreHorizontal className="size-5" />
        </button>
      </div>

      {/* Post body — editable, styled like the feed */}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        rows={1}
        className="mt-2 field-sizing-content min-h-[7rem] w-full resize-none bg-transparent px-4 pb-1 text-[15px] leading-[1.45] outline-none placeholder:text-muted-foreground"
      />

      {/* Image, edge-to-edge like LinkedIn — show the whole image (no crop);
          our generated images are square, LinkedIn displays them in full. */}
      {imageUrl && (
        <div className="bg-muted mt-1 border-y">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="" className="mx-auto max-h-[32rem] w-auto max-w-full object-contain" />
        </div>
      )}

      {/* Reaction summary */}
      <div className="text-muted-foreground flex items-center gap-1.5 px-4 pt-2.5 text-xs">
        <span className="flex -space-x-1" aria-hidden>
          <span className="grid size-4 place-items-center rounded-full bg-[#0a66c2] text-[8px] text-white">
            <ThumbsUp className="size-2.5 fill-white" />
          </span>
          <span className="grid size-4 place-items-center rounded-full bg-[#e06847] text-[8px] text-white">
            ❤
          </span>
        </span>
        <span>{t("studio.lkReactions")}</span>
      </div>

      {/* Action bar */}
      <div className="mt-1.5 flex items-center justify-between border-t px-1 py-1">
        <PreviewAction icon={<ThumbsUp className="size-[1.15rem]" />} label={t("studio.lkLike")} />
        <PreviewAction icon={<MessageSquare className="size-[1.15rem]" />} label={t("studio.lkComment")} />
        <PreviewAction icon={<Repeat2 className="size-[1.15rem]" />} label={t("studio.lkRepost")} />
        <PreviewAction icon={<Send className="size-[1.15rem]" />} label={t("studio.lkSend")} />
      </div>
    </div>
  );
}

function PreviewAction({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span
      className={cn(
        "text-muted-foreground flex flex-1 items-center justify-center gap-1.5 rounded-md py-2.5 text-sm font-medium",
      )}
      aria-hidden
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
}
