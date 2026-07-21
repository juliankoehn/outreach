"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Post, PostSource } from "@/lib/accounts";

const SOURCE_VARIANT: Record<PostSource, "secondary" | "muted" | "success"> = {
  embed: "secondary",
  linkedin_api: "success",
  csv_import: "muted",
  manual: "muted",
};

export function PostRow({ post, accountId }: { post: Post; accountId: string }) {
  const t = useTranslations();
  const locale = useLocale();
  const nf = new Intl.NumberFormat(locale);
  const df = new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric" });

  const m = post.metrics;
  const stats: { n: number; label: string }[] = [];
  if (m?.impressions != null) stats.push({ n: m.impressions, label: t("accounts.impressions") });
  if (m?.reactions != null) stats.push({ n: m.reactions, label: t("accounts.reactions") });
  if (m?.comments != null) stats.push({ n: m.comments, label: t("accounts.comments") });

  return (
    <li>
      <Link
        href={`/accounts/${accountId}/posts/${post.id}`}
        className="hover:bg-accent/40 block px-5 py-4 transition-colors"
      >
        <div className="flex items-start gap-3">
          {post.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={post.imageUrl}
              alt=""
              className="size-14 shrink-0 rounded-md border object-cover"
            />
          )}
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                "line-clamp-3 text-sm whitespace-pre-line",
                !post.text && "text-muted-foreground italic",
              )}
            >
              {post.text || t("accounts.noText")}
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <Badge variant={SOURCE_VARIANT[post.source]} className="gap-1">
                {post.source === "embed" && <Sparkles className="size-3" />}
                {t(`accounts.source_${post.source}`)}
              </Badge>
              {post.mediaType && post.mediaType !== "none" && (
                <Badge variant="muted" className="capitalize">
                  {post.mediaType}
                </Badge>
              )}
              <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 text-xs">
                {stats.length > 0 ? (
                  stats.map((s) => (
                    <span key={s.label}>
                      <span className="text-foreground font-medium tabular-nums">{nf.format(s.n)}</span>{" "}
                      <span className="lowercase">{s.label}</span>
                    </span>
                  ))
                ) : (
                  <span className="text-muted-foreground/70">{t("accounts.noMetrics")}</span>
                )}
              </div>
              <span className="text-muted-foreground ml-auto text-xs">{df.format(new Date(post.publishedAt))}</span>
            </div>
          </div>
        </div>
      </Link>
    </li>
  );
}
