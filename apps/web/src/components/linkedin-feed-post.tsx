"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Globe, ImageIcon, Loader2, MessageSquare, MoreHorizontal, RefreshCw, Repeat2, Send, ShieldCheck, ThumbsUp } from "lucide-react";
import { cn } from "@/lib/utils";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "in";
  return (parts[0]![0]! + (parts[1]?.[0] ?? "")).toUpperCase();
}

// The LinkedIn feed-post chrome shared by the studio editor and the profile
// canvas preview: author header, a body slot (children), the reaction summary,
// and the action bar. Callers provide their own body (an editable textarea or
// read-only text) plus an optional <FeedPostImage> inside `children`.
export function FeedPostShell({
  authorName,
  avatarUrl,
  children,
}: {
  authorName: string;
  avatarUrl?: string | null;
  children: React.ReactNode;
}) {
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
            <span className="truncate text-[15px] font-semibold hover:text-[#0a66c2] hover:underline">{name}</span>
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

      {children}

      {/* Reaction summary */}
      <div className="text-muted-foreground flex items-center gap-1.5 px-4 pt-2.5 text-xs">
        <span className="flex -space-x-1" aria-hidden>
          <span className="grid size-4 place-items-center rounded-full bg-[#0a66c2] text-[8px] text-white">
            <ThumbsUp className="size-2.5 fill-white" />
          </span>
          <span className="grid size-4 place-items-center rounded-full bg-[#e06847] text-[8px] text-white">❤</span>
        </span>
        <span>{t("studio.lkReactions")}</span>
      </div>

      {/* Action bar */}
      <div className="mt-1.5 flex items-center justify-between border-t px-1 py-1">
        <FeedAction icon={<ThumbsUp className="size-[1.15rem]" />} label={t("studio.lkLike")} />
        <FeedAction icon={<MessageSquare className="size-[1.15rem]" />} label={t("studio.lkComment")} />
        <FeedAction icon={<Repeat2 className="size-[1.15rem]" />} label={t("studio.lkRepost")} />
        <FeedAction icon={<Send className="size-[1.15rem]" />} label={t("studio.lkSend")} />
      </div>
    </div>
  );
}

function FeedAction({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span
      className="text-muted-foreground flex flex-1 items-center justify-center gap-1.5 rounded-md py-2.5 text-sm font-medium"
      aria-hidden
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
}

// Fades + un-blurs the image once it decodes — a "developing" reveal each time a
// new src arrives (the closest we get to a streamed-image feel without partials).
function RevealImage({ src, dimmed }: { src: string; dimmed?: boolean }) {
  const [loaded, setLoaded] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    // `onLoad` does NOT fire for an already-cached/complete image (e.g. arriving
    // via client-side nav from the list, which already fetched the same URL) —
    // so it would stay stuck at opacity-0 until a reload. Detect completeness.
    const img = ref.current;
    setLoaded(!!img?.complete && img.naturalWidth > 0);
  }, [src]);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={ref}
      src={src}
      alt=""
      onLoad={() => setLoaded(true)}
      className={cn(
        // object-contain + w-auto: show the whole image at its true aspect ratio,
        // exactly as LinkedIn renders it — never crop to a fixed band.
        "mx-auto max-h-[32rem] w-auto max-w-full object-contain transition-all duration-700 ease-out",
        loaded ? "scale-100 blur-0 opacity-100" : "scale-105 opacity-0 blur-xl",
        dimmed && "opacity-60",
      )}
    />
  );
}

interface ContentCredentials {
  present: boolean;
  aiGenerated: boolean;
  generator: string | null;
}

// The "Content Credentials" (C2PA) badge — the same provenance LinkedIn surfaces,
// read from the image the model embedded it in. Hover reveals the details.
function ContentCredentialsBadge({ cred }: { cred: ContentCredentials }) {
  const t = useTranslations();
  return (
    <div className="group/cr absolute bottom-2 left-2 z-10">
      <div className="bg-background/80 text-foreground flex items-center gap-1 rounded-md border px-1.5 py-1 text-[11px] font-medium shadow-sm backdrop-blur">
        <ShieldCheck className="size-3.5" />
        <span>Cr</span>
      </div>
      <div className="bg-popover text-popover-foreground pointer-events-none absolute bottom-full left-0 mb-1.5 w-64 rounded-lg border p-3 text-xs opacity-0 shadow-md transition-opacity group-hover/cr:opacity-100">
        <p className="font-medium">{t("credentials.title")}</p>
        {cred.aiGenerated && <p className="text-muted-foreground mt-1">{t("credentials.aiGenerated")}</p>}
        {cred.generator && (
          <p className="text-muted-foreground mt-1">{t("credentials.generatedWith", { name: cred.generator })}</p>
        )}
      </div>
    </div>
  );
}

// The image slot for a feed post. Shows the whole image (never cropped), with a
// blur-up reveal. When `onRegenerate` is set it also offers a hover regenerate
// button (over an existing image) or a generate affordance (when empty), plus a
// busy overlay while a new image is rendering. Surfaces the embedded C2PA
// Content Credentials as a corner badge.
export function FeedPostImage({
  src,
  busy,
  dimmed,
  onRegenerate,
  regenerateLabel,
  generateLabel,
}: {
  src?: string | null;
  busy?: boolean;
  dimmed?: boolean;
  onRegenerate?: () => void;
  regenerateLabel?: string;
  generateLabel?: string;
}) {
  // Load the image's embedded Content Credentials (C2PA) for the badge. Only our
  // own generated images carry a readable manifest and live behind that endpoint
  // — skip external (e.g. LinkedIn CDN) images so we don't 404 the credentials call.
  const [cred, setCred] = useState<ContentCredentials | null>(null);
  useEffect(() => {
    setCred(null);
    if (!src?.startsWith("/generated/")) return;
    const name = src.split("/").pop();
    if (!name) return;
    let alive = true;
    void fetch(`/api/generated/${name}/credentials`, { credentials: "include" })
      .then((r) => (r.ok ? (r.json() as Promise<ContentCredentials>) : null))
      .then((d) => {
        if (alive && d?.present) setCred(d);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [src]);

  if (!src && !busy) {
    if (!onRegenerate) return null;
    return (
      <button
        type="button"
        onClick={onRegenerate}
        className="text-muted-foreground hover:border-foreground/20 hover:text-foreground mt-1 flex w-full items-center justify-center gap-2 border-y border-dashed py-6 text-sm transition-colors"
      >
        <ImageIcon className="size-4" />
        {generateLabel}
      </button>
    );
  }

  return (
    <div className="group/img bg-muted relative mt-1 border-y">
      {src && <RevealImage src={src} dimmed={dimmed} />}
      {src && !busy && cred && <ContentCredentialsBadge cred={cred} />}
      {busy && !src && (
        <div className="flex h-64 w-full items-center justify-center">
          <Loader2 className="text-muted-foreground size-5 animate-spin" />
        </div>
      )}
      {busy && src && (
        <div className="bg-background/30 absolute inset-0 grid place-items-center backdrop-blur-[2px]">
          <Loader2 className="text-foreground size-5 animate-spin" />
        </div>
      )}
      {onRegenerate && src && !busy && (
        <button
          type="button"
          onClick={onRegenerate}
          aria-label={regenerateLabel}
          className="bg-background/80 text-foreground hover:bg-background absolute top-2 right-2 flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium opacity-0 shadow-sm backdrop-blur transition-opacity group-hover/img:opacity-100"
        >
          <RefreshCw className="size-3.5" />
          {regenerateLabel}
        </button>
      )}
    </div>
  );
}
