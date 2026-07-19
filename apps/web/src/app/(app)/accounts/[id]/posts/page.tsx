"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { Post } from "@/lib/accounts";
import { useAccount } from "../account-context";
import { AddPostsDialog } from "../add-posts-dialog";
import { PostRow } from "../post-row";

export default function AccountPostsPage() {
  const t = useTranslations();
  const { id } = useAccount();

  const [posts, setPosts] = useState<Post[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [note, setNote] = useState<{ text: string; muted?: boolean } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/linkedin/accounts/${id}/posts`, { credentials: "include" });
    if (res.ok) setPosts(((await res.json()) as { posts: Post[] }).posts);
    setLoaded(true);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function enrich() {
    setEnriching(true);
    setNote(null);
    const res = await fetch(`/api/linkedin/accounts/${id}/enrich`, { method: "POST", credentials: "include" });
    setEnriching(false);
    if (res.ok) {
      const d = (await res.json()) as { enriched: number; total: number };
      if (d.total === 0) setNote({ text: t("accounts.enrichNone"), muted: true });
      else {
        setNote({ text: t("accounts.enriched", { count: d.enriched, total: d.total }) });
        void load();
      }
    } else setNote({ text: t("errors.generic"), muted: true });
  }

  const enrichable = posts.some((p) => p.externalId);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{t("accounts.postsTitle")}</h2>
          <p className="text-muted-foreground text-sm">{t("accounts.addPostsHelp")}</p>
        </div>
        <div className="flex items-center gap-2">
          {enrichable && (
            <Button variant="outline" onClick={enrich} disabled={enriching}>
              <RefreshCw className={cn("size-4", enriching && "animate-spin")} />
              {enriching ? t("accounts.enriching") : t("accounts.enrich")}
            </Button>
          )}
          <AddPostsDialog
            accountId={id}
            trigger={
              <Button>
                <Plus className="size-4" />
                {t("accounts.addPosts")}
              </Button>
            }
            onImported={(r) => {
              setNote({ text: t("accounts.imported", { inserted: r.inserted, skipped: r.skipped }) });
              void load();
            }}
          />
        </div>
      </div>

      {note && (
        <p className={cn("text-sm", note.muted ? "text-muted-foreground" : "text-success")}>{note.text}</p>
      )}

      <Card className="gap-0 py-0">
        <CardHeader className="flex-row items-center justify-between border-b px-5 py-4">
          <CardTitle className="text-sm">
            {t("accounts.allPosts")}
            {loaded && posts.length > 0 && (
              <span className="text-muted-foreground ml-2 font-normal">{posts.length}</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {!loaded ? (
            <div className="space-y-3 p-5">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : posts.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-muted-foreground text-sm">{t("accounts.postsEmpty")}</p>
              <AddPostsDialog
                accountId={id}
                trigger={
                  <Button className="mt-4">
                    <Plus className="size-4" />
                    {t("accounts.addPosts")}
                  </Button>
                }
                onImported={(r) => {
                  setNote({ text: t("accounts.imported", { inserted: r.inserted, skipped: r.skipped }) });
                  void load();
                }}
              />
            </div>
          ) : (
            <ul className="divide-y">
              {posts.map((p) => (
                <PostRow key={p.id} post={p} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
