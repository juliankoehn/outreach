"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Globe, ImageIcon, Loader2, MessageSquare, MoreHorizontal, RefreshCw, Repeat2, Send, ThumbsUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface CanvasProfile {
  toneWords?: string[];
  pillars?: string[];
  audience?: string;
  positioning?: string;
  visualStyle?: string;
  noGos?: string[];
  brandBrief?: string;
}

// One example post on the canvas — its text plus an optional matching image
// the agent generated for it.
export type ExamplePost = { text: string; imageUrl?: string };

interface ProfileCanvasProps {
  profile: CanvasProfile;
  examplePosts: ExamplePost[];
  imageLoading?: boolean;
  author: { name: string; avatarUrl?: string | null };
  lastChangedKey?: keyof CanvasProfile | null;
  onEditField?: (field: "audience" | "positioning", value: string) => void;
  // Rendered at the top of the canvas — the editable Visuals settings.
  visualsSlot?: React.ReactNode;
  // Regenerate the image for the example post at `index`.
  onRegenerateImage?: (index: number) => void;
  regeneratingIndex?: number | null;
}

// The live "canvas" — three stacked, independently scrollable zones that
// mirror the profile as the studio chat builds it: identity chips, the brand
// brief prose, and read-only example-post previews.
export function ProfileCanvas({
  profile,
  examplePosts,
  imageLoading,
  author,
  lastChangedKey,
  onEditField,
  visualsSlot,
  onRegenerateImage,
  regeneratingIndex,
}: ProfileCanvasProps) {
  const t = useTranslations();

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
      {visualsSlot}

      {/* Zone 1 — identity chips */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ChipDimension
          label={t("profile.pcVoice")}
          empty={t("profile.pcEmpty")}
          values={profile.toneWords}
          highlighted={lastChangedKey === "toneWords"}
        />
        <ChipDimension
          label={t("profile.pcPillars")}
          empty={t("profile.pcEmpty")}
          values={profile.pillars}
          highlighted={lastChangedKey === "pillars"}
        />
        <TextDimension
          label={t("profile.pcAudience")}
          empty={t("profile.pcEmpty")}
          value={profile.audience}
          highlighted={lastChangedKey === "audience"}
          editable={!!onEditField}
          onSave={onEditField ? (value) => onEditField("audience", value) : undefined}
        />
        <TextDimension
          label={t("profile.pcPositioning")}
          empty={t("profile.pcEmpty")}
          value={profile.positioning}
          highlighted={lastChangedKey === "positioning"}
          editable={!!onEditField}
          onSave={onEditField ? (value) => onEditField("positioning", value) : undefined}
        />
        <ChipDimension
          label={t("profile.pcNoGos")}
          empty={t("profile.pcEmpty")}
          values={profile.noGos}
          highlighted={lastChangedKey === "noGos"}
        />
      </div>

      {/* Zone 2 — brand brief */}
      <Card className={cn("gap-3 transition-shadow", lastChangedKey === "brandBrief" && "ring-primary/40 ring-2")}>
        <CardHeader>
          <CardTitle className="text-sm">{t("profile.pcBrief")}</CardTitle>
        </CardHeader>
        <CardContent>
          {profile.brandBrief?.trim() ? (
            <p className="text-sm leading-relaxed whitespace-pre-line">{profile.brandBrief}</p>
          ) : (
            <p className="text-muted-foreground text-sm italic">{t("profile.pcBriefEmpty")}</p>
          )}
        </CardContent>
      </Card>

      {/* Zone 3 — example posts */}
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">{t("profile.pcExamples")}</h3>
        {examplePosts.length === 0 ? (
          <p className="text-muted-foreground text-sm italic">{t("profile.pcExamplesEmpty")}</p>
        ) : (
          examplePosts.map((post, i) => (
            <ExamplePostPreview
              key={i}
              authorName={author.name}
              avatarUrl={author.avatarUrl}
              text={post.text}
              imageUrl={post.imageUrl}
              imageLoading={imageLoading && !post.imageUrl}
              onRegenerate={onRegenerateImage ? () => onRegenerateImage(i) : undefined}
              regenerating={regeneratingIndex === i}
            />
          ))
        )}
      </div>
    </div>
  );
}

function useHighlight(active: boolean): boolean {
  const [show, setShow] = useState(active);
  useEffect(() => {
    if (!active) return;
    setShow(true);
    const id = setTimeout(() => setShow(false), 1500);
    return () => clearTimeout(id);
  }, [active]);
  return show;
}

function DimensionShell({
  label,
  highlighted,
  children,
}: {
  label: string;
  highlighted?: boolean;
  children: React.ReactNode;
}) {
  const show = useHighlight(!!highlighted);
  return (
    <div
      className={cn(
        "rounded-lg border p-3 transition-shadow duration-700",
        show && "ring-primary/40 ring-2",
      )}
    >
      <p className="text-muted-foreground mb-1.5 text-xs font-medium tracking-wide uppercase">{label}</p>
      {children}
    </div>
  );
}

function ChipDimension({
  label,
  values,
  empty,
  highlighted,
}: {
  label: string;
  values?: string[];
  empty: string;
  highlighted?: boolean;
}) {
  const items = values?.filter(Boolean) ?? [];
  return (
    <DimensionShell label={label} highlighted={highlighted}>
      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm italic">{empty}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {items.map((v) => (
            <Badge key={v} variant="secondary">
              {v}
            </Badge>
          ))}
        </div>
      )}
    </DimensionShell>
  );
}

function TextDimension({
  label,
  value,
  empty,
  highlighted,
  editable,
  onSave,
}: {
  label: string;
  value?: string;
  empty: string;
  highlighted?: boolean;
  editable?: boolean;
  onSave?: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");

  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  if (editable && editing) {
    return (
      <DimensionShell label={label} highlighted={highlighted}>
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            setEditing(false);
            if (draft.trim() !== (value ?? "").trim()) onSave?.(draft.trim());
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setDraft(value ?? "");
              setEditing(false);
            }
          }}
          className="h-8 text-sm"
        />
      </DimensionShell>
    );
  }

  return (
    <DimensionShell label={label} highlighted={highlighted}>
      <button
        type="button"
        onClick={() => editable && setEditing(true)}
        className={cn(
          "w-full text-left text-sm",
          !value?.trim() && "text-muted-foreground italic",
          editable && "hover:text-primary cursor-text",
        )}
      >
        {value?.trim() || empty}
      </button>
    </DimensionShell>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "in";
  return (parts[0]![0]! + (parts[1]?.[0] ?? "")).toUpperCase();
}

// Read-only variant of the LinkedIn feed-post look (see linkedin-preview.tsx)
// for rendering AI-written example posts on the canvas.
// Fades + un-blurs the image once it decodes — a "developing" reveal each time a
// new src arrives (the closest we get to a streamed-image feel without partials).
function RevealImage({ src, dimmed }: { src: string; dimmed?: boolean }) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => setLoaded(false), [src]);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      onLoad={() => setLoaded(true)}
      className={cn(
        "max-h-80 w-full object-cover transition-all duration-700 ease-out",
        loaded ? "scale-100 blur-0 opacity-100" : "scale-105 opacity-0 blur-xl",
        dimmed && "opacity-60",
      )}
    />
  );
}

function ExamplePostPreview({
  authorName,
  avatarUrl,
  text,
  imageUrl,
  imageLoading,
  onRegenerate,
  regenerating,
}: {
  authorName: string;
  avatarUrl?: string | null;
  text: string;
  imageUrl?: string;
  imageLoading?: boolean;
  onRegenerate?: () => void;
  regenerating?: boolean;
}) {
  const t = useTranslations();
  const name = authorName.trim() || "Your name";
  const busy = !!imageLoading || !!regenerating;

  return (
    <div className="bg-card overflow-hidden rounded-xl border shadow-sm">
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
            <span className="truncate text-[15px] font-semibold">{name}</span>
            <span className="text-muted-foreground text-xs">· {t("studio.lkYou")}</span>
          </div>
          <p className="text-muted-foreground truncate text-xs">{t("studio.lkSubtitle")}</p>
          <p className="text-muted-foreground mt-0.5 flex items-center gap-1 text-xs">
            <span>{t("studio.lkNow")}</span>
            <span aria-hidden>·</span>
            <Globe className="size-3" />
          </p>
        </div>
        <MoreHorizontal className="text-muted-foreground -mr-1 size-5 shrink-0" aria-hidden />
      </div>

      <p className="mt-2 px-4 pb-1 text-[15px] leading-[1.45] whitespace-pre-line">{text}</p>

      {imageUrl || busy ? (
        <div className="group/img relative mt-2 border-y">
          {imageUrl && <RevealImage src={imageUrl} dimmed={regenerating} />}
          {busy && !imageUrl && (
            <div className="bg-muted flex h-64 w-full items-center justify-center">
              <Loader2 className="text-muted-foreground size-5 animate-spin" />
            </div>
          )}
          {regenerating && imageUrl && (
            <div className="bg-background/30 absolute inset-0 grid place-items-center backdrop-blur-[2px]">
              <Loader2 className="text-foreground size-5 animate-spin" />
            </div>
          )}
          {onRegenerate && !busy && (
            <button
              type="button"
              onClick={onRegenerate}
              aria-label={t("profile.regenerateImage")}
              className="bg-background/80 text-foreground hover:bg-background absolute top-2 right-2 flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium opacity-0 shadow-sm backdrop-blur transition-opacity group-hover/img:opacity-100"
            >
              <RefreshCw className="size-3.5" />
              {t("profile.regenerateImage")}
            </button>
          )}
        </div>
      ) : onRegenerate ? (
        <button
          type="button"
          onClick={onRegenerate}
          className="text-muted-foreground hover:border-foreground/20 hover:text-foreground mt-2 flex w-full items-center justify-center gap-2 border-y border-dashed py-6 text-sm transition-colors"
        >
          <ImageIcon className="size-4" />
          {t("profile.generateImage")}
        </button>
      ) : null}

      <div className="text-muted-foreground flex items-center gap-1.5 px-4 pt-2.5 text-xs">
        <span className="flex -space-x-1" aria-hidden>
          <span className="grid size-4 place-items-center rounded-full bg-[#0a66c2] text-[8px] text-white">
            <ThumbsUp className="size-2.5 fill-white" />
          </span>
          <span className="grid size-4 place-items-center rounded-full bg-[#e06847] text-[8px] text-white">❤</span>
        </span>
        <span>{t("studio.lkReactions")}</span>
      </div>

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
      className="text-muted-foreground flex flex-1 items-center justify-center gap-1.5 rounded-md py-2.5 text-sm font-medium"
      aria-hidden
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
}
