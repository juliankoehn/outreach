"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface Row {
  text: string;
  url: string;
  impressions: string;
  reactions: string;
  comments: string;
  source: "manual" | "embed";
  mediaType?: string;
  imageUrl?: string;
}

interface ParsedEmbed {
  urn: string | null;
  embedUrl: string;
  text: string;
  reactions?: number;
  comments?: number;
  imageUrl?: string;
  mediaType: string;
}

interface AddPostsDialogProps {
  accountId: string;
  trigger: React.ReactNode;
  onImported?: (result: { inserted: number; skipped: number }) => void;
}

const emptyRow = (): Row => ({
  text: "",
  url: "",
  impressions: "",
  reactions: "",
  comments: "",
  source: "manual",
});

function metricsOf(r: Row): Record<string, string> | undefined {
  const m: Record<string, string> = {};
  if (r.impressions.trim()) m.impressions = r.impressions.trim();
  if (r.reactions.trim()) m.reactions = r.reactions.trim();
  if (r.comments.trim()) m.comments = r.comments.trim();
  return Object.keys(m).length > 0 ? m : undefined;
}

export function AddPostsDialog({ accountId, trigger, onImported }: AddPostsDialogProps) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const [embed, setEmbed] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  const filled = rows.filter((r) => r.text.trim().length > 0);

  function reset() {
    setRows([emptyRow()]);
    setError(false);
    setBusy(false);
    setEmbed("");
    setParseError(null);
  }

  function update(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function parse() {
    const value = embed.trim();
    if (!value || parsing) return;
    setParsing(true);
    setParseError(null);
    const res = await fetch(`/api/linkedin/accounts/${accountId}/posts/parse`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embed: value }),
    });
    setParsing(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setParseError(body?.error === "no_embed" ? t("accounts.parseNoUrn") : t("accounts.parseFailed"));
      return;
    }
    const p = (await res.json()) as ParsedEmbed;
    const parsedRow: Row = {
      text: p.text,
      url: p.embedUrl,
      impressions: "",
      reactions: p.reactions != null ? String(p.reactions) : "",
      comments: p.comments != null ? String(p.comments) : "",
      source: "embed",
      mediaType: p.mediaType,
      imageUrl: p.imageUrl,
    };
    // Fill the first still-empty row, otherwise append.
    setRows((rs) => {
      const idx = rs.findIndex((r) => !r.text.trim() && r.source === "manual");
      if (idx >= 0) return rs.map((r, i) => (i === idx ? parsedRow : r));
      return [...rs, parsedRow];
    });
    setEmbed("");
  }

  async function submit() {
    if (filled.length === 0 || busy) return;
    setBusy(true);
    setError(false);
    const res = await fetch(`/api/linkedin/accounts/${accountId}/posts/manual`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        posts: filled.map((r) => ({
          text: r.text.trim(),
          url: r.url.trim() || undefined,
          source: r.source,
          mediaType: r.mediaType,
          imageUrl: r.imageUrl,
          metrics: metricsOf(r),
        })),
      }),
    });
    setBusy(false);
    if (res.ok) {
      const result = (await res.json()) as { inserted: number; skipped: number };
      onImported?.(result);
      setOpen(false);
      reset();
    } else {
      setError(true);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[88vh] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>{t("accounts.addPostsTitle")}</DialogTitle>
          <DialogDescription>{t("accounts.addPostsDesc")}</DialogDescription>
        </DialogHeader>

        <div className="max-h-[62vh] space-y-5 overflow-y-auto px-6 py-5">
          {/* Embed autofill */}
          <div className="border-primary/25 bg-primary/5 rounded-lg border p-3">
            <div className="flex items-center gap-1.5 text-sm font-medium">
              <Sparkles className="text-primary size-4" />
              {t("accounts.parseTitle")}
            </div>
            <p className="text-muted-foreground mt-1 text-xs">{t("accounts.parseHelp")}</p>
            <div className="mt-2.5 flex items-start gap-2">
              <Textarea
                value={embed}
                onChange={(e) => setEmbed(e.target.value)}
                placeholder={t("accounts.parsePlaceholder")}
                className="min-h-9 flex-1 resize-none bg-transparent text-xs"
                rows={1}
              />
              <Button type="button" onClick={parse} disabled={parsing || !embed.trim()} className="shrink-0">
                {parsing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                {parsing ? t("accounts.parsing") : t("accounts.parse")}
              </Button>
            </div>
            {parseError && <p className="text-destructive mt-2 text-xs">{parseError}</p>}
          </div>

          {rows.map((row, i) => (
            <div
              key={i}
              className={cn(
                "relative rounded-lg border p-3",
                row.source === "embed" ? "border-primary/30 bg-primary/[0.03]" : "bg-muted/30",
              )}
            >
              {row.source === "embed" && (
                <div className="mb-2 flex items-center gap-2">
                  <Badge variant="secondary" className="gap-1">
                    <Sparkles className="size-3" />
                    {t("accounts.source_embed")}
                  </Badge>
                  {row.mediaType && row.mediaType !== "none" && (
                    <Badge variant="muted" className="capitalize">
                      {row.mediaType}
                    </Badge>
                  )}
                  {row.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={row.imageUrl} alt="" className="ml-auto size-9 rounded border object-cover" />
                  )}
                </div>
              )}
              <Textarea
                value={row.text}
                onChange={(e) => update(i, { text: e.target.value })}
                placeholder={t("accounts.postContentPlaceholder")}
                className="min-h-[90px] resize-y bg-transparent"
              />
              <div className="mt-2 flex items-center gap-2">
                <Input
                  value={row.url}
                  onChange={(e) => update(i, { url: e.target.value })}
                  placeholder={t("accounts.shareUrlPlaceholder")}
                  className="h-8 text-xs"
                />
                {rows.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}
                    aria-label={t("accounts.removePost")}
                    className="text-muted-foreground hover:text-destructive shrink-0"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {(["impressions", "reactions", "comments"] as const).map((k) => (
                  <Input
                    key={k}
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={row[k]}
                    onChange={(e) => update(i, { [k]: e.target.value })}
                    placeholder={t(`accounts.metric_${k}`)}
                    className="h-8 text-xs"
                  />
                ))}
              </div>
              <p className="text-muted-foreground mt-1.5 text-[11px]">{t("accounts.engagementHint")}</p>
            </div>
          ))}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setRows((rs) => [...rs, emptyRow()])}
            className="w-full border-dashed"
          >
            <Plus className="size-4" />
            {t("accounts.addAnotherPost")}
          </Button>
        </div>

        <DialogFooter className="items-center border-t px-6 py-4">
          {error && <span className="text-destructive mr-auto text-sm">{t("errors.generic")}</span>}
          <DialogClose asChild>
            <Button variant="ghost">{t("common.cancel")}</Button>
          </DialogClose>
          <Button onClick={submit} disabled={busy || filled.length === 0}>
            {busy ? t("accounts.addingPosts") : t("accounts.addPostsSubmit", { count: filled.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
