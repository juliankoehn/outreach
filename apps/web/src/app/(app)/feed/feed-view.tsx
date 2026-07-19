"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ExternalLink, Loader2, PenLine, Plus, RefreshCw, Rss, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { Account } from "@/lib/accounts";
import type { FeedItem, FeedSource } from "@/lib/feed";
import type { Draft } from "@/lib/studio";

type Filter = "new" | "all" | "dismissed";

const FILTERS: Filter[] = ["new", "all", "dismissed"];

export function FeedView() {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();

  const [sources, setSources] = useState<FeedSource[]>([]);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [sourcesLoaded, setSourcesLoaded] = useState(false);
  const [itemsLoaded, setItemsLoaded] = useState(false);
  const [filter, setFilter] = useState<Filter>("new");
  const [refreshing, setRefreshing] = useState(false);
  // Item ids with an in-flight status change — keeps that card's actions
  // disabled until the re-sync lands, so a card can't be double-actioned.
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  // LinkedIn accounts, loaded on mount — gate/route the "turn into post" flow.
  const [accounts, setAccounts] = useState<Account[]>([]);
  // The item whose post is being created (spinner + guards against double-fire).
  const [postingId, setPostingId] = useState<string | null>(null);
  // When >1 account, clicking "post" defers to an account picker for this item.
  const [postItem, setPostItem] = useState<FeedItem | null>(null);

  const loadSources = useCallback(async () => {
    const res = await fetch("/api/feed/sources", { credentials: "include" });
    if (res.ok) setSources(((await res.json()) as { sources: FeedSource[] }).sources);
    setSourcesLoaded(true);
  }, []);

  const loadItems = useCallback(async (f: Filter) => {
    const res = await fetch(`/api/feed/items?status=${f}`, { credentials: "include" });
    if (res.ok) setItems(((await res.json()) as { items: FeedItem[] }).items);
    setItemsLoaded(true);
  }, []);

  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  // Accounts drive the "turn into post" button (0 → disabled, 1 → direct,
  // >1 → picker). Best-effort: a failed load just leaves the button gated.
  useEffect(() => {
    (async () => {
      const res = await fetch("/api/linkedin/accounts", { credentials: "include" }).catch(
        () => null,
      );
      if (res && res.ok) setAccounts(((await res.json()) as { accounts: Account[] }).accounts);
    })();
  }, []);

  useEffect(() => {
    setItemsLoaded(false);
    void loadItems(filter);
  }, [filter, loadItems]);

  // Freshly-ingested articles land asynchronously (RSS fetch runs in a job),
  // so re-poll the current filter every 30s while the page is open.
  useEffect(() => {
    const id = setInterval(() => void loadItems(filter), 30_000);
    return () => clearInterval(id);
  }, [filter, loadItems]);

  async function refreshAll() {
    if (sources.length === 0 || refreshing) return;
    setRefreshing(true);
    await Promise.all(
      sources.map((s) =>
        fetch(`/api/feed/sources/${s.id}/refresh`, {
          method: "POST",
          credentials: "include",
        }).catch(() => {}),
      ),
    );
    // The job writes items behind the scenes; give it a beat, then re-sync.
    await loadSources();
    await loadItems(filter);
    setRefreshing(false);
  }

  async function removeSource(s: FeedSource) {
    // Optimistic — drop the chip immediately, re-sync on failure.
    setSources((rs) => rs.filter((x) => x.id !== s.id));
    const res = await fetch(`/api/feed/sources/${s.id}`, {
      method: "DELETE",
      credentials: "include",
    }).catch(() => null);
    if (!res || !res.ok) await loadSources();
    else void loadItems(filter);
  }

  async function setStatus(item: FeedItem, status: "read" | "dismissed") {
    setPending((s) => new Set(s).add(item.id));
    const res = await fetch(`/api/feed/items/${item.id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    }).catch(() => null);
    if (res && res.ok) await loadItems(filter);
    setPending((s) => {
      const next = new Set(s);
      next.delete(item.id);
      return next;
    });
  }

  // Create a Studio draft seeded from the article, then hand off to the studio
  // agent via ?prompt= (which auto-sends). Marking the item read is best-effort
  // and must never block the redirect.
  async function createPost(item: FeedItem, accountId: string) {
    if (postingId) return;
    setPostingId(item.id);
    void fetch(`/api/feed/items/${item.id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "read" }),
    }).catch(() => {});
    const res = await fetch(`/api/studio/${accountId}/drafts`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }).catch(() => null);
    if (res && res.ok) {
      const { draft } = (await res.json()) as { draft: Draft };
      const prompt = t("feed.postPrompt", {
        title: item.title,
        excerpt: item.excerpt,
        url: item.url,
      });
      router.push(`/studio/${draft.id}?prompt=${encodeURIComponent(prompt)}`);
      return; // keep postingId set: the page is navigating away
    }
    setPostingId(null);
  }

  function handlePost(item: FeedItem) {
    if (accounts.length === 0 || postingId) return;
    if (accounts.length === 1) void createPost(item, accounts[0]!.id);
    else setPostItem(item);
  }

  const sourceTitle = (id: string) =>
    sources.find((s) => s.id === id)?.title ?? t("feed.unknownSource");

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("feed.title")}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t("feed.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          {sources.length > 0 && (
            <Button variant="outline" onClick={refreshAll} disabled={refreshing}>
              <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
              {t("feed.refresh")}
            </Button>
          )}
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="size-4" />
            {t("feed.addSource")}
          </Button>
        </div>
      </div>

      {/* Sources ----------------------------------------------------------- */}
      <section className="space-y-2.5">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          {t("feed.sourcesTitle")}
          {sourcesLoaded && sources.length > 0 && (
            <span className="text-muted-foreground font-normal tabular-nums">{sources.length}</span>
          )}
        </h2>

        {!sourcesLoaded ? (
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-8 w-40 rounded-md" />
            <Skeleton className="h-8 w-32 rounded-md" />
          </div>
        ) : sources.length === 0 ? (
          <div className="rounded-lg border border-dashed px-6 py-8 text-center">
            <div className="text-muted-foreground bg-muted mx-auto grid size-10 place-items-center rounded-full">
              <Rss className="size-5" />
            </div>
            <p className="text-muted-foreground mx-auto mt-3 max-w-sm text-sm">
              {t("feed.emptyNoSources")}
            </p>
            <Button className="mt-4" onClick={() => setDialogOpen(true)}>
              <Plus className="size-4" />
              {t("feed.addSource")}
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {sources.map((s) => (
              <SourceChip
                key={s.id}
                source={s}
                removeLabel={t("feed.remove")}
                onRemove={() => void removeSource(s)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Stream ------------------------------------------------------------ */}
      <section className="space-y-4">
        <div className="bg-muted inline-flex items-center gap-0.5 rounded-md p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={cn(
                "rounded px-3 py-1 text-xs font-medium transition-colors",
                filter === f
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`feed.filter_${f}`)}
            </button>
          ))}
        </div>

        {!itemsLoaded ? (
          <div className="grid gap-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-28 w-full rounded-xl" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="text-muted-foreground rounded-xl border border-dashed py-12 text-center text-sm">
            {t("feed.emptyNoItems")}
          </div>
        ) : (
          <div className="grid gap-3">
            {items.map((item) => (
              <FeedItemCard
                key={item.id}
                item={item}
                sourceTitle={sourceTitle(item.sourceId)}
                locale={locale}
                busy={pending.has(item.id)}
                posting={postingId === item.id}
                canPost={accounts.length > 0}
                labels={{
                  post: t("feed.actionPost"),
                  read: t("feed.actionRead"),
                  dismiss: t("feed.actionDismiss"),
                  postNoAccount: t("feed.postNoAccount"),
                }}
                onPost={() => handlePost(item)}
                onRead={() => void setStatus(item, "read")}
                onDismiss={() => void setStatus(item, "dismissed")}
              />
            ))}
          </div>
        )}
      </section>

      <AddSourceDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onAdded={() => {
          void loadSources();
          void loadItems(filter);
        }}
      />

      <PostAccountDialog
        item={postItem}
        accounts={accounts}
        busy={postingId !== null}
        onConfirm={(accountId) => {
          if (postItem) void createPost(postItem, accountId);
        }}
        onClose={() => setPostItem(null)}
      />
    </div>
  );
}

function SourceChip({
  source,
  removeLabel,
  onRemove,
}: {
  source: FeedSource;
  removeLabel: string;
  onRemove: () => void;
}) {
  const isError = source.status === "error";
  return (
    <div
      className={cn(
        "group bg-card flex items-center gap-2 rounded-md border py-1.5 pr-1.5 pl-2.5 text-sm transition-colors hover:border-foreground/20",
        isError && "border-destructive/30",
      )}
    >
      <span
        aria-hidden
        className={cn("size-1.5 shrink-0 rounded-full", isError ? "bg-destructive" : "bg-success")}
      />
      <span className="max-w-[16rem] truncate" title={isError ? (source.error ?? undefined) : source.url}>
        {source.title}
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={removeLabel}
        className="text-muted-foreground hover:text-destructive hover:bg-accent grid size-6 shrink-0 place-items-center rounded opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}

function FeedItemCard({
  item,
  sourceTitle,
  locale,
  busy,
  posting,
  canPost,
  labels,
  onPost,
  onRead,
  onDismiss,
}: {
  item: FeedItem;
  sourceTitle: string;
  locale: string;
  busy: boolean;
  posting: boolean;
  canPost: boolean;
  labels: { post: string; read: string; dismiss: string; postNoAccount: string };
  onPost: () => void;
  onRead: () => void;
  onDismiss: () => void;
}) {
  const date = item.publishedAt
    ? new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric" }).format(
        new Date(item.publishedAt),
      )
    : null;

  return (
    <div
      className={cn(
        "bg-card flex gap-4 rounded-xl border p-4 shadow-sm transition-colors hover:border-foreground/20",
        item.status === "read" && "opacity-70",
      )}
    >
      {item.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.imageUrl}
          alt=""
          loading="lazy"
          className="bg-muted hidden size-24 shrink-0 rounded-md border object-cover sm:block"
        />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="muted" className="max-w-[12rem] truncate">
            {sourceTitle}
          </Badge>
          {date && <span className="text-muted-foreground text-xs tabular-nums">{date}</span>}
          {item.author && (
            <span className="text-muted-foreground truncate text-xs">· {item.author}</span>
          )}
        </div>

        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          className="group/link mt-1.5 flex items-start gap-1 font-medium hover:underline"
        >
          <span className="min-w-0">{item.title}</span>
          <ExternalLink className="text-muted-foreground mt-1 size-3.5 shrink-0 opacity-0 transition-opacity group-hover/link:opacity-100" />
        </a>

        {item.excerpt && (
          <p className="text-muted-foreground mt-1 line-clamp-2 text-sm">{item.excerpt}</p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={onPost}
            disabled={busy || posting || !canPost}
            title={!canPost ? labels.postNoAccount : undefined}
          >
            {posting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <PenLine className="size-4" />
            )}
            {labels.post}
          </Button>
          {item.status !== "read" && (
            <Button size="sm" variant="outline" onClick={onRead} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              {labels.read}
            </Button>
          )}
          {item.status !== "dismissed" && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onDismiss}
              disabled={busy}
              className="text-muted-foreground hover:text-destructive"
            >
              {labels.dismiss}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function AddSourceDialog({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
}) {
  const t = useTranslations();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setUrl("");
    setBusy(false);
    setError(null);
  }

  async function submit() {
    const value = url.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/feed/sources", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: value }),
    }).catch(() => null);
    setBusy(false);
    if (res && res.ok) {
      onAdded();
      onOpenChange(false);
      reset();
      return;
    }
    // Distinguish 409 duplicate / 400 unreachable via the JSON error code.
    const body = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
    if (res?.status === 409 || body?.error === "duplicate") setError(t("feed.sourceDuplicate"));
    else setError(t("feed.sourceUnreachable"));
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("feed.addSource")}</DialogTitle>
          <DialogDescription>{t("feed.addSourceDesc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
            placeholder={t("feed.addSourcePlaceholder")}
            type="url"
            autoFocus
          />
          {error && <p className="text-destructive text-sm">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !url.trim()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            {busy ? t("feed.addSourceBusy") : t("feed.addSourceSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Shown only when the user has >1 LinkedIn account — pick which one the
// article-seeded draft belongs to before kicking off the studio agent.
function PostAccountDialog({
  item,
  accounts,
  busy,
  onConfirm,
  onClose,
}: {
  item: FeedItem | null;
  accounts: Account[];
  busy: boolean;
  onConfirm: (accountId: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations();
  const [selected, setSelected] = useState("");

  // Default to the first account whenever the picker opens for a new item.
  useEffect(() => {
    if (item) setSelected((cur) => cur || (accounts[0]?.id ?? ""));
  }, [item, accounts]);

  return (
    <Dialog
      open={item !== null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("feed.pickAccount")}</DialogTitle>
          <DialogDescription>{t("feed.pickAccountDesc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">{t("studio.createAccount")}</label>
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => selected && onConfirm(selected)} disabled={busy || !selected}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <PenLine className="size-4" />}
            {t("feed.actionPost")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
