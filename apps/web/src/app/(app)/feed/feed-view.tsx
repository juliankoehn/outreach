"use client";

import { useCallback, useEffect, useMemo, useState, type ComponentPropsWithoutRef } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowLeft,
  ExternalLink,
  Loader2,
  Newspaper,
  PenLine,
  Plus,
  RefreshCw,
  Rss,
  Trash2,
} from "lucide-react";
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
import { MessageResponse } from "@/components/ai-elements/message";
import { cn } from "@/lib/utils";
import type { Account } from "@/lib/accounts";
import type { FeedItem, FeedSource } from "@/lib/feed";
import type { Draft } from "@/lib/studio";

type Filter = "new" | "all" | "dismissed";

const FILTERS: Filter[] = ["new", "all", "dismissed"];

// Feed URLs come from external content — guard against a `javascript:`/`data:`
// scheme reaching an href/src (the server already filters, this is belt-and-braces).
function safeHref(u: string | null | undefined): string | undefined {
  if (!u) return undefined;
  try {
    const p = new URL(u);
    return p.protocol === "http:" || p.protocol === "https:" ? u : undefined;
  } catch {
    return undefined;
  }
}

// urlTransform for the Markdown reader — the article body is untrusted feed
// content, so every link/image href is scrubbed: keep http(s)/mailto, keep
// scheme-less relative/anchor URLs (not executable), drop everything else
// (javascript:/data:/vbscript:). Paired with skipHtml on the renderer.
function safeMarkdownUrl(u: string): string {
  if (!u) return "";
  try {
    const p = new URL(u);
    return p.protocol === "http:" || p.protocol === "https:" || p.protocol === "mailto:" ? u : "";
  } catch {
    return u; // relative / #anchor (no scheme) — safe, keep it
  }
}

// Render Markdown links as plain, scrubbed anchors — bypasses Streamdown's
// link-safety popover, which renders a <div> inside the paragraph <p> and trips
// a hydration error on link-heavy feed content.
function FeedLink({ href, children }: ComponentPropsWithoutRef<"a">) {
  return (
    <a
      href={safeHref(href) ?? "#"}
      target="_blank"
      rel="noreferrer"
      className="underline underline-offset-2"
    >
      {children}
    </a>
  );
}
const FEED_MD_COMPONENTS = { a: FeedLink };

function formatDate(locale: string, iso: string | null): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}

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
  // Item ids with an in-flight status change — keeps that item's actions
  // disabled until the re-sync lands, so it can't be double-actioned.
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  // LinkedIn accounts, loaded on mount — gate/route the "turn into post" flow.
  const [accounts, setAccounts] = useState<Account[]>([]);
  // The item whose post is being created (spinner + guards against double-fire).
  const [postingId, setPostingId] = useState<string | null>(null);
  // When >1 account, clicking "post" defers to an account picker for this item.
  const [postItem, setPostItem] = useState<FeedItem | null>(null);
  // The article shown in the reader pane. Pinned as its own object so it keeps
  // rendering even after a status change drops it from the current filter.
  const [selectedItem, setSelectedItem] = useState<FeedItem | null>(null);

  // Prefer the freshest copy from the list (a poll may have filled in `content`),
  // but fall back to the pinned object if the item has left the current filter.
  const selected = useMemo(() => {
    if (!selectedItem) return null;
    return items.find((i) => i.id === selectedItem.id) ?? selectedItem;
  }, [items, selectedItem]);

  // Reader mode: RSS only carries a teaser, so when an article is opened, fetch
  // its full body from the source once and cache it onto the item.
  const [fullLoadedIds, setFullLoadedIds] = useState<Set<string>>(new Set());
  const [fullLoadingId, setFullLoadingId] = useState<string | null>(null);
  useEffect(() => {
    const id = selected?.id;
    if (!id || fullLoadedIds.has(id) || fullLoadingId === id) return;
    setFullLoadingId(id);
    void (async () => {
      const res = await fetch(`/api/feed/items/${id}/full`, {
        method: "POST",
        credentials: "include",
      }).catch(() => null);
      if (res && res.ok) {
        const { content } = (await res.json()) as { content: string | null };
        if (content) {
          setItems((prev) => prev.map((i) => (i.id === id ? { ...i, content } : i)));
          setSelectedItem((s) => (s && s.id === id ? { ...s, content } : s));
        }
      }
      setFullLoadedIds((s) => new Set(s).add(id));
      setFullLoadingId((cur) => (cur === id ? null : cur));
    })();
  }, [selected?.id, fullLoadedIds, fullLoadingId]);

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

  // Open an article in the reader. Marking it read is best-effort and mirrors
  // "opening" it — fire-and-forget (no re-sync) so it doesn't vanish from the
  // list mid-read; the list updates its status optimistically.
  function selectItem(item: FeedItem) {
    setSelectedItem(item.status === "new" ? { ...item, status: "read" } : item);
    if (item.status === "new") {
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: "read" } : i)));
      void fetch(`/api/feed/items/${item.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "read" }),
      }).catch(() => {});
    }
  }

  async function dismissSelected(item: FeedItem) {
    await setStatus(item, "dismissed");
    setSelectedItem(null);
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

  const sourceTitle = useCallback(
    (id: string) => sources.find((s) => s.id === id)?.title ?? t("feed.unknownSource"),
    [sources, t],
  );

  return (
    <div className="flex h-full flex-col lg:flex-row">
      {/* List pane -------------------------------------------------------- */}
      <div
        className={cn(
          "flex min-h-0 w-full flex-col border-b lg:w-[38%] lg:min-w-[22rem] lg:border-r lg:border-b-0",
          // On mobile the reader takes over the whole view when an item is open.
          selected ? "hidden lg:flex" : "flex",
        )}
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight">{t("feed.title")}</h1>
            <p className="text-muted-foreground mt-0.5 truncate text-xs">{t("feed.subtitle")}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {sources.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={refreshAll}
                disabled={refreshing}
                title={t("feed.refresh")}
                aria-label={t("feed.refresh")}
                className="h-8 px-2"
              >
                <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
              </Button>
            )}
            <Button size="sm" onClick={() => setDialogOpen(true)} className="h-8">
              <Plus className="size-4" />
              <span className="hidden sm:inline">{t("feed.addSource")}</span>
            </Button>
          </div>
        </div>

        {/* Sources chips */}
        <div className="px-5 pb-3">
          {!sourcesLoaded ? (
            <div className="flex flex-wrap gap-1.5">
              <Skeleton className="h-7 w-36 rounded-md" />
              <Skeleton className="h-7 w-28 rounded-md" />
            </div>
          ) : sources.length === 0 ? (
            <div className="rounded-md border border-dashed px-4 py-5 text-center">
              <div className="text-muted-foreground bg-muted mx-auto grid size-9 place-items-center rounded-full">
                <Rss className="size-4" />
              </div>
              <p className="text-muted-foreground mx-auto mt-2.5 max-w-xs text-xs">
                {t("feed.emptyNoSources")}
              </p>
              <Button size="sm" className="mt-3 h-8" onClick={() => setDialogOpen(true)}>
                <Plus className="size-4" />
                {t("feed.addSource")}
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
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
        </div>

        {/* Filter tabs */}
        <div className="px-5 pb-3">
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
        </div>

        {/* Item rows — the one scrolling region on the left */}
        <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3">
          {!itemsLoaded ? (
            <div className="grid gap-1.5 px-1">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full rounded-md" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="text-muted-foreground mx-2 rounded-md border border-dashed px-4 py-10 text-center text-sm">
              {t("feed.emptyNoItems")}
            </div>
          ) : (
            <div className="grid gap-0.5">
              {items.map((item) => (
                <FeedItemRow
                  key={item.id}
                  item={item}
                  sourceTitle={sourceTitle(item.sourceId)}
                  locale={locale}
                  active={item.id === selected?.id}
                  onSelect={() => selectItem(item)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Reader pane ------------------------------------------------------ */}
      <div
        className={cn(
          "min-h-0 flex-1 flex-col",
          selected ? "flex" : "hidden lg:flex",
        )}
      >
        {selected ? (
          <ArticleReader
            key={selected.id}
            item={selected}
            sourceTitle={sourceTitle(selected.sourceId)}
            locale={locale}
            busy={pending.has(selected.id)}
            posting={postingId === selected.id}
            canPost={accounts.length > 0}
            loadingFull={fullLoadingId === selected.id}
            labels={{
              back: t("feed.backToList"),
              post: t("feed.actionPost"),
              openOriginal: t("feed.openOriginal"),
              dismiss: t("feed.actionDismiss"),
              postNoAccount: t("feed.postNoAccount"),
              loadingFull: t("feed.loadingFull"),
            }}
            onBack={() => setSelectedItem(null)}
            onPost={() => handlePost(selected)}
            onDismiss={() => void dismissSelected(selected)}
          />
        ) : (
          <div className="grid flex-1 place-items-center p-8">
            <div className="max-w-xs text-center">
              <div className="text-muted-foreground bg-muted mx-auto grid size-12 place-items-center rounded-full">
                <Newspaper className="size-5" />
              </div>
              <p className="mt-4 text-sm font-medium">{t("feed.readerEmptyTitle")}</p>
              <p className="text-muted-foreground mt-1 text-sm">{t("feed.readerEmptyDesc")}</p>
            </div>
          </div>
        )}
      </div>

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
        "group bg-card hover:border-foreground/20 flex items-center gap-2 rounded-md border py-1 pr-1 pl-2.5 text-xs transition-colors",
        isError && "border-destructive/30",
      )}
    >
      <span
        aria-hidden
        className={cn("size-1.5 shrink-0 rounded-full", isError ? "bg-destructive" : "bg-success")}
      />
      <span
        className="max-w-[12rem] truncate"
        title={isError ? (source.error ?? undefined) : source.url}
      >
        {source.title}
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={removeLabel}
        className="text-muted-foreground hover:text-destructive hover:bg-accent grid size-5 shrink-0 place-items-center rounded opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
      >
        <Trash2 className="size-3" />
      </button>
    </div>
  );
}

function FeedItemRow({
  item,
  sourceTitle,
  locale,
  active,
  onSelect,
}: {
  item: FeedItem;
  sourceTitle: string;
  locale: string;
  active: boolean;
  onSelect: () => void;
}) {
  const date = formatDate(locale, item.publishedAt);
  const unread = item.status === "new";

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active}
      className={cn(
        "group flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left transition-colors",
        active ? "bg-accent" : "hover:bg-muted/60",
      )}
    >
      <span aria-hidden className="mt-1.5 flex w-1.5 shrink-0 justify-center">
        {unread && <span className="bg-primary size-1.5 rounded-full" />}
      </span>

      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "line-clamp-2 text-sm leading-snug",
            unread ? "font-medium" : "font-normal",
          )}
        >
          {item.title}
        </p>
        <div className="mt-1 flex items-center gap-2 overflow-hidden">
          <span className="text-muted-foreground max-w-[10rem] truncate text-xs">
            {sourceTitle}
          </span>
          {date && (
            <>
              <span aria-hidden className="text-muted-foreground/50 text-xs">
                ·
              </span>
              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{date}</span>
            </>
          )}
        </div>
      </div>

      {safeHref(item.imageUrl) && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={safeHref(item.imageUrl)}
          alt=""
          loading="lazy"
          className="bg-muted hidden size-12 shrink-0 rounded object-cover sm:block"
        />
      )}
    </button>
  );
}

function ArticleReader({
  item,
  sourceTitle,
  locale,
  busy,
  posting,
  canPost,
  loadingFull,
  labels,
  onBack,
  onPost,
  onDismiss,
}: {
  item: FeedItem;
  sourceTitle: string;
  locale: string;
  busy: boolean;
  posting: boolean;
  canPost: boolean;
  loadingFull: boolean;
  labels: {
    back: string;
    post: string;
    openOriginal: string;
    dismiss: string;
    postNoAccount: string;
    loadingFull: string;
  };
  onBack: () => void;
  onPost: () => void;
  onDismiss: () => void;
}) {
  const date = formatDate(locale, item.publishedAt);
  const href = safeHref(item.url);
  const body = item.content?.trim() || item.excerpt?.trim() || "";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Sticky action bar */}
      <div className="bg-background/80 flex flex-wrap items-center gap-2 border-b px-5 py-3 backdrop-blur">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="text-muted-foreground -ml-2 h-8 lg:hidden"
        >
          <ArrowLeft className="size-4" />
          {labels.back}
        </Button>

        <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
          <Button
            size="sm"
            className="h-8"
            onClick={onPost}
            disabled={busy || posting || !canPost}
            title={!canPost ? labels.postNoAccount : undefined}
          >
            {posting ? <Loader2 className="size-4 animate-spin" /> : <PenLine className="size-4" />}
            {labels.post}
          </Button>
          {href && (
            <Button asChild size="sm" variant="outline" className="h-8">
              <a href={href} target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" />
                {labels.openOriginal}
              </a>
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={onDismiss}
            disabled={busy}
            className="text-muted-foreground hover:text-destructive h-8"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {labels.dismiss}
          </Button>
        </div>
      </div>

      {/* Scrolling article body */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <article className="mx-auto max-w-2xl px-6 py-8">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="muted" className="max-w-[14rem] truncate">
              {sourceTitle}
            </Badge>
            {date && (
              <span className="text-muted-foreground text-xs tabular-nums">{date}</span>
            )}
            {item.author && (
              <span className="text-muted-foreground truncate text-xs">· {item.author}</span>
            )}
          </div>

          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-balance">
            {item.title}
          </h1>

          {safeHref(item.imageUrl) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={safeHref(item.imageUrl)}
              alt=""
              className="bg-muted mt-5 aspect-video w-full rounded-lg border object-cover"
            />
          )}

          {loadingFull && (
            <div className="text-muted-foreground mt-5 flex items-center gap-2 text-xs">
              <Loader2 className="size-3.5 animate-spin" />
              {labels.loadingFull}
            </div>
          )}

          {body ? (
            <MessageResponse
              className="mt-6 text-[0.95rem] leading-relaxed"
              skipHtml
              urlTransform={safeMarkdownUrl}
              components={FEED_MD_COMPONENTS}
            >
              {body}
            </MessageResponse>
          ) : (
            <p className="text-muted-foreground mt-6 text-sm">{item.excerpt}</p>
          )}
        </article>
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
