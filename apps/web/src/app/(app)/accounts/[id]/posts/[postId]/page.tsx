"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, Check, ExternalLink, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FeedPostShell, FeedPostImage } from "@/components/linkedin-feed-post";
import { useAccount } from "../../account-context";
import type { PostDetail } from "@/lib/accounts";

function verdictVariant(verdict: string): "success" | "muted" | "secondary" {
  if (verdict === "over") return "success";
  if (verdict === "under") return "secondary";
  return "muted";
}

function MetricsGrid({ post }: { post: PostDetail }) {
  const t = useTranslations();
  const locale = useLocale();
  const nf = new Intl.NumberFormat(locale);
  const pf = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 });

  const m = post.metrics;
  const cells: { label: string; value: string }[] = [];
  if (m?.impressions != null) cells.push({ label: t("accounts.impressions"), value: nf.format(m.impressions) });
  if (m?.membersReached != null) cells.push({ label: t("posts.membersReached"), value: nf.format(m.membersReached) });
  if (m?.reactions != null) cells.push({ label: t("accounts.reactions"), value: nf.format(m.reactions) });
  if (m?.comments != null) cells.push({ label: t("accounts.comments"), value: nf.format(m.comments) });
  if (m?.reshares != null) cells.push({ label: t("posts.reshares"), value: nf.format(m.reshares) });
  cells.push({ label: t("posts.engagementRate"), value: pf.format(post.engagementRate) });

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {cells.map((c) => (
        <div key={c.label} className="rounded-lg border px-3 py-2.5">
          <div className="text-muted-foreground text-xs">{c.label}</div>
          <div className="mt-0.5 text-lg font-semibold tabular-nums">{c.value}</div>
        </div>
      ))}
    </div>
  );
}

function LearningRow({
  learning,
  onAccept,
  onDismiss,
}: {
  learning: { text: string; status: "pending" | "accepted" };
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const t = useTranslations();
  return (
    <li className="flex items-start justify-between gap-3 rounded-lg border px-3 py-2.5">
      <p className="min-w-0 flex-1 text-sm">{learning.text}</p>
      {learning.status === "accepted" ? (
        <span className="text-success shrink-0 text-xs font-medium">{t("posts.learningAdded")}</span>
      ) : (
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="text-success hover:bg-success/10 size-7"
            aria-label={t("posts.learningAccept")}
            onClick={onAccept}
          >
            <Check className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-destructive size-7"
            aria-label={t("posts.learningReject")}
            onClick={onDismiss}
          >
            <X className="size-4" />
          </Button>
        </div>
      )}
    </li>
  );
}

export default function PostDetailPage() {
  const t = useTranslations();
  const router = useRouter();
  const { id, postId } = useParams<{ id: string; postId: string }>();
  const { account } = useAccount();

  const [post, setPost] = useState<PostDetail | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [learnings, setLearnings] = useState<{ text: string; status: "pending" | "accepted" }[]>([]);

  const load = useCallback(async () => {
    const res = await fetch(`/api/linkedin/accounts/${id}/posts/${postId}`, { credentials: "include" });
    if (res.status === 401) return router.push("/login");
    if (res.ok) {
      const data = (await res.json()) as { post: PostDetail };
      setPost(data.post);
      setLearnings((data.post.analysis?.learnings ?? []).map((text) => ({ text, status: "pending" as const })));
    }
    setLoaded(true);
  }, [id, postId, router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function analyze() {
    setAnalyzing(true);
    const res = await fetch(`/api/linkedin/accounts/${id}/posts/${postId}/analyze`, {
      method: "POST",
      credentials: "include",
    });
    setAnalyzing(false);
    if (res.status === 401) return router.push("/login");
    if (res.ok) {
      const data = (await res.json()) as { post: PostDetail };
      setPost(data.post);
      setLearnings((data.post.analysis?.learnings ?? []).map((text) => ({ text, status: "pending" as const })));
    }
  }

  async function acceptLearning(text: string) {
    // Optimistically mark added, but revert if the save didn't stick — otherwise
    // a 401/error would silently drop a confirmed learning.
    setLearnings((ls) => ls.map((l) => (l.text === text ? { ...l, status: "accepted" } : l)));
    const res = await fetch(`/api/linkedin/accounts/${id}/posts/${postId}/learnings`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accepted: [text] }),
    });
    if (res.status === 401) return router.push("/login");
    if (!res.ok) {
      setLearnings((ls) => ls.map((l) => (l.text === text ? { ...l, status: "pending" } : l)));
    }
  }

  function dismissLearning(text: string) {
    setLearnings((ls) => ls.filter((l) => l.text !== text));
  }

  if (!loaded) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (!post) {
    return (
      <div className="mx-auto max-w-md p-10 text-center">
        <p className="text-muted-foreground text-sm">{t("accounts.notFound")}</p>
        <Button asChild variant="outline" className="mt-4">
          <a href={`/accounts/${id}/posts`}>{t("posts.back")}</a>
        </Button>
      </div>
    );
  }

  const analysis = post.analysis;

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-10">
      <div className="flex items-center justify-between gap-3">
        <a
          href={`/accounts/${id}/posts`}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
        >
          <ArrowLeft className="size-4" />
          {t("posts.back")}
        </a>
        {post.externalId && (
          <a
            href={`https://www.linkedin.com/feed/update/${encodeURIComponent(post.externalId)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
          >
            {t("posts.viewOnLinkedIn")}
            <ExternalLink className="size-3.5" />
          </a>
        )}
      </div>

      <FeedPostShell authorName={account.displayName} avatarUrl={account.avatarUrl}>
        <p className="mt-2 px-4 pb-1 text-[15px] leading-[1.45] whitespace-pre-line">{post.text}</p>
        <FeedPostImage src={post.imageUrl} />
      </FeedPostShell>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("posts.metrics")}</CardTitle>
        </CardHeader>
        <CardContent>
          <MetricsGrid post={post} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-sm">{t("posts.analysisTitle")}</CardTitle>
          {analysis && (
            <Button variant="outline" size="sm" onClick={() => void analyze()} disabled={analyzing}>
              <Sparkles className="size-4" />
              {analyzing ? t("posts.analyzing") : t("posts.reanalyze")}
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-5">
          {!analysis ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <p className="text-muted-foreground text-sm">{t("posts.notAnalyzed")}</p>
              <Button onClick={() => void analyze()} disabled={analyzing}>
                <Sparkles className="size-4" />
                {analyzing ? t("posts.analyzing") : t("posts.analyzeNow")}
              </Button>
            </div>
          ) : (
            <>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                    {t("posts.performance")}
                  </h3>
                  <Badge variant={verdictVariant(analysis.performance.verdict)}>
                    {t(`posts.verdict_${analysis.performance.verdict}`)}
                  </Badge>
                </div>
                <p className="mt-1.5 text-sm">{analysis.performance.summary}</p>
              </div>

              <div>
                <h3 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                  {t("posts.teardown")}
                </h3>
                <dl className="mt-1.5 grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
                  {(
                    [
                      ["hook", analysis.teardown.hook],
                      ["structure", analysis.teardown.structure],
                      ["pillar", analysis.teardown.pillar],
                      ["format", analysis.teardown.format],
                      ["cta", analysis.teardown.cta],
                      ["toneMatch", analysis.teardown.toneMatch],
                    ] as const
                  ).map(([key, value]) => (
                    <div key={key}>
                      <dt className="text-muted-foreground text-xs">{t(`posts.${key}`)}</dt>
                      <dd className="text-sm">{value}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              <div>
                <h3 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                  {t("posts.goalFit")}
                </h3>
                <p className="mt-1.5 text-sm">{analysis.goalFit}</p>
              </div>

              {learnings.length > 0 && (
                <div>
                  <h3 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                    {t("posts.learnings")}
                  </h3>
                  <ul className="mt-1.5 space-y-2">
                    {learnings.map((l) => (
                      <LearningRow
                        key={l.text}
                        learning={l}
                        onAccept={() => void acceptLearning(l.text)}
                        onDismiss={() => dismissLearning(l.text)}
                      />
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
