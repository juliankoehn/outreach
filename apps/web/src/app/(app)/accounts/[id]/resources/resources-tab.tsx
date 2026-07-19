"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { FileText, ImagePlus, Loader2, Sparkles, Star, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface Resource {
  id: string;
  accountId: string;
  kind: "image" | "document";
  name: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  error: string | null;
  isImageRef: boolean;
  meta: { chunkCount?: number } | null;
  createdAt: string;
}

const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp";
const DOC_ACCEPT = ".pdf,.txt,.md";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export function ResourcesTab({ accountId }: { accountId: string }) {
  const t = useTranslations();
  const base = `/api/linkedin/accounts/${accountId}/resources`;

  const [resources, setResources] = useState<Resource[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Ids with an in-flight image-ref toggle (server runs a vision call, so it
  // can take a few seconds — keep that tile's control disabled meanwhile).
  const [pendingRef, setPendingRef] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState<{ image: boolean; document: boolean }>({
    image: false,
    document: false,
  });
  const [error, setError] = useState<string | null>(null);

  const imageInput = useRef<HTMLInputElement>(null);
  const docInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await fetch(base, { credentials: "include" });
    if (res.ok) setResources(((await res.json()) as { resources: Resource[] }).resources);
    setLoaded(true);
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  // While any document is still ingesting, poll so the row advances to
  // "ready" (with its chunk count) without a manual refresh.
  const ingesting = resources.some((r) => r.status === "pending" || r.status === "processing");
  useEffect(() => {
    if (!ingesting) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [ingesting, load]);

  async function upload(kind: "image" | "document", file: File | undefined) {
    if (!file) return;
    setUploading((u) => ({ ...u, [kind]: true }));
    setError(null);
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch(base, { method: "POST", credentials: "include", body: form });
      if (!res.ok) setError(t("resources.uploadFailed"));
    } catch {
      setError(t("resources.uploadFailed"));
    }
    await load();
    setUploading((u) => ({ ...u, [kind]: false }));
  }

  async function toggleRef(r: Resource) {
    setPendingRef((s) => new Set(s).add(r.id));
    setError(null);
    try {
      const res = await fetch(`${base}/${r.id}/image-ref`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ on: !r.isImageRef }),
      });
      if (!res.ok) setError(t("resources.toggleRefFailed"));
    } catch {
      setError(t("resources.toggleRefFailed"));
    }
    await load();
    setPendingRef((s) => {
      const next = new Set(s);
      next.delete(r.id);
      return next;
    });
  }

  async function remove(r: Resource) {
    // Optimistic removal — the row/tile vanishes immediately, but on a
    // server-side failure we re-sync via load() so it reappears rather than
    // leaving the UI showing a false "deleted" state.
    setResources((rs) => rs.filter((x) => x.id !== r.id));
    setError(null);
    try {
      const res = await fetch(`${base}/${r.id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) {
        setError(t("resources.deleteFailed"));
        await load();
      }
    } catch {
      setError(t("resources.deleteFailed"));
      await load();
    }
  }

  const images = resources.filter((r) => r.kind === "image");
  const documents = resources.filter((r) => r.kind === "document");

  return (
    <div className="space-y-10">
      {error && (
        <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-md border px-4 py-2.5 text-sm">
          {error}
        </div>
      )}

      {/* Images ------------------------------------------------------------ */}
      <section className="space-y-4">
        <SectionHeader
          title={t("resources.images")}
          subtitle={t("resources.imagesSubtitle")}
          count={loaded ? images.length : undefined}
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => imageInput.current?.click()}
              disabled={uploading.image}
            >
              {uploading.image ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ImagePlus className="size-4" />
              )}
              {uploading.image ? t("resources.uploading") : t("resources.uploadImage")}
            </Button>
          }
        />
        <input
          ref={imageInput}
          type="file"
          accept={IMAGE_ACCEPT}
          className="hidden"
          onChange={(e) => {
            void upload("image", e.target.files?.[0]);
            e.target.value = "";
          }}
        />

        {!loaded ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="aspect-square rounded-md" />
            ))}
          </div>
        ) : images.length === 0 ? (
          <EmptyState
            icon={<ImagePlus className="size-5" />}
            text={t("resources.imagesEmpty")}
            action={
              <Button size="sm" onClick={() => imageInput.current?.click()} disabled={uploading.image}>
                <Upload className="size-4" />
                {t("resources.uploadImage")}
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {images.map((r) => (
              <ImageTile
                key={r.id}
                resource={r}
                src={`${base}/${r.id}/content`}
                pending={pendingRef.has(r.id)}
                onToggleRef={() => void toggleRef(r)}
                onDelete={() => void remove(r)}
                labels={{
                  reference: t("resources.referenceOn"),
                  useAsReference: t("resources.useAsReference"),
                  analyzing: t("resources.analyzing"),
                  delete: t("resources.delete"),
                }}
              />
            ))}
          </div>
        )}
      </section>

      {/* Knowledge --------------------------------------------------------- */}
      <section className="space-y-4">
        <SectionHeader
          title={t("resources.knowledge")}
          subtitle={t("resources.knowledgeSubtitle")}
          count={loaded ? documents.length : undefined}
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => docInput.current?.click()}
              disabled={uploading.document}
            >
              {uploading.document ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Upload className="size-4" />
              )}
              {uploading.document ? t("resources.uploading") : t("resources.uploadDoc")}
            </Button>
          }
        />
        <input
          ref={docInput}
          type="file"
          accept={DOC_ACCEPT}
          className="hidden"
          onChange={(e) => {
            void upload("document", e.target.files?.[0]);
            e.target.value = "";
          }}
        />

        {!loaded ? (
          <Card className="gap-0 py-0">
            <CardContent className="space-y-3 p-5">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </CardContent>
          </Card>
        ) : documents.length === 0 ? (
          <EmptyState
            icon={<FileText className="size-5" />}
            text={t("resources.knowledgeEmpty")}
            action={
              <Button size="sm" onClick={() => docInput.current?.click()} disabled={uploading.document}>
                <Upload className="size-4" />
                {t("resources.uploadDoc")}
              </Button>
            }
          />
        ) : (
          <Card className="gap-0 py-0">
            <CardContent className="p-0">
              <ul className="divide-y">
                {documents.map((r) => (
                  <DocRow
                    key={r.id}
                    resource={r}
                    onDelete={() => void remove(r)}
                    deleteLabel={t("resources.delete")}
                  />
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}

function SectionHeader({
  title,
  subtitle,
  count,
  action,
}: {
  title: string;
  subtitle: string;
  count?: number;
  action: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          {title}
          {count != null && count > 0 && (
            <span className="text-muted-foreground text-sm font-normal tabular-nums">{count}</span>
          )}
        </h2>
        <p className="text-muted-foreground mt-0.5 max-w-prose text-sm">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

function EmptyState({
  icon,
  text,
  action,
}: {
  icon: React.ReactNode;
  text: string;
  action: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed px-6 py-10 text-center">
      <div className="text-muted-foreground bg-muted mx-auto grid size-10 place-items-center rounded-full">
        {icon}
      </div>
      <p className="text-muted-foreground mx-auto mt-3 max-w-sm text-sm">{text}</p>
      <div className="mt-4 flex justify-center">{action}</div>
    </div>
  );
}

function ImageTile({
  resource,
  src,
  pending,
  onToggleRef,
  onDelete,
  labels,
}: {
  resource: Resource;
  src: string;
  pending: boolean;
  onToggleRef: () => void;
  onDelete: () => void;
  labels: { reference: string; useAsReference: string; analyzing: string; delete: string };
}) {
  const isRef = resource.isImageRef;
  return (
    <div className="group bg-muted focus-within:ring-ring/50 relative aspect-square overflow-hidden rounded-md border transition-colors focus-within:ring-2 hover:border-foreground/20">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={resource.name} className="size-full object-cover" />

      {isRef && (
        <span className="bg-primary text-primary-foreground absolute top-1.5 left-1.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium shadow-sm">
          <Sparkles className="size-3" />
          {labels.reference}
        </span>
      )}

      <button
        type="button"
        onClick={onDelete}
        aria-label={labels.delete}
        className="bg-background/80 text-muted-foreground hover:text-destructive absolute top-1.5 right-1.5 grid size-7 place-items-center rounded opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
      >
        <Trash2 className="size-3.5" />
      </button>

      {/* Reference toggle — anchored to the bottom, always visible when a
          reference (so the state reads at a glance), hover-revealed otherwise. */}
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-1.5 transition-opacity",
          isRef ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100",
        )}
      >
        <button
          type="button"
          onClick={onToggleRef}
          disabled={pending}
          aria-pressed={isRef}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded bg-white/10 px-2 py-1 text-[11px] font-medium text-white backdrop-blur-sm transition-colors hover:bg-white/20 disabled:opacity-70"
        >
          {pending ? (
            <>
              <Loader2 className="size-3 animate-spin" />
              {labels.analyzing}
            </>
          ) : (
            <>
              <Star className={cn("size-3", isRef && "fill-current")} />
              {isRef ? labels.reference : labels.useAsReference}
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function DocRow({
  resource,
  onDelete,
  deleteLabel,
}: {
  resource: Resource;
  onDelete: () => void;
  deleteLabel: string;
}) {
  const locale = useLocale();
  return (
    <li className="group flex items-center gap-3 px-5 py-3.5">
      <div className="bg-muted text-muted-foreground grid size-9 shrink-0 place-items-center rounded-md">
        <FileText className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{resource.name}</p>
        <div className="text-muted-foreground mt-0.5 flex items-center gap-2 text-xs">
          <span className="tabular-nums">{formatSize(resource.sizeBytes)}</span>
          <span aria-hidden>·</span>
          <DocStatus resource={resource} />
        </div>
      </div>
      <span className="text-muted-foreground/70 hidden text-xs tabular-nums sm:inline">
        {new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(
          new Date(resource.createdAt),
        )}
      </span>
      <button
        type="button"
        onClick={onDelete}
        aria-label={deleteLabel}
        className="text-muted-foreground hover:text-destructive hover:bg-accent grid size-8 shrink-0 place-items-center rounded-md opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
      >
        <Trash2 className="size-4" />
      </button>
    </li>
  );
}

// The document's ingestion state — queued → analyzing → ready (with its section
// count) → failed. Replaces the old static "stored" badge so the row reflects
// what the RAG pipeline actually did.
function DocStatus({ resource }: { resource: Resource }) {
  const t = useTranslations();
  if (resource.status === "processing") {
    return (
      <span className="text-primary inline-flex items-center gap-1">
        <Loader2 className="size-3 animate-spin" />
        {t("resources.docProcessing")}
      </span>
    );
  }
  if (resource.status === "failed") {
    return (
      <span className="text-destructive" title={resource.error ?? undefined}>
        {t("resources.docFailed")}
      </span>
    );
  }
  if (resource.status === "ready") {
    return <span className="text-success">{t("resources.docReady", { count: resource.meta?.chunkCount ?? 0 })}</span>;
  }
  return <span>{t("resources.docQueued")}</span>; // pending
}
