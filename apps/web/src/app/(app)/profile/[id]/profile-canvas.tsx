"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { FeedPostImage, FeedPostShell } from "@/components/linkedin-feed-post";

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

// The AI-written example post on the canvas, in the shared LinkedIn feed-post
// look, with an on-image regenerate button.
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
  return (
    <FeedPostShell authorName={authorName} avatarUrl={avatarUrl}>
      <p className="mt-2 px-4 pb-1 text-[15px] leading-[1.45] whitespace-pre-line">{text}</p>
      <FeedPostImage
        src={imageUrl}
        busy={!!imageLoading || !!regenerating}
        dimmed={regenerating}
        onRegenerate={onRegenerate}
        regenerateLabel={t("profile.regenerateImage")}
        generateLabel={t("profile.generateImage")}
      />
    </FeedPostShell>
  );
}
