"use client";

import { BookOpen, ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

// Shape returned by the agent's `searchKnowledge` tool (see
// packages/ai/src/*-studio.ts KnowledgePassage) — mirrored locally so the web
// app doesn't need to depend on @outreach/ai.
export interface KnowledgeSource {
  content: string;
  section: string | null;
  resourceName: string;
}

const SNIPPET_MAX = 180;

function truncate(text: string, max: number): string {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length > max ? `${clean.slice(0, max).trimEnd()}…` : clean;
}

/**
 * Renders the knowledge passages the agent grounded a post on. The post text
 * itself stays citation-free (enforced by the agent); the sources live here,
 * as a quiet collapsible the reader can open to check what was drawn on.
 *
 * `searching` → a subtle in-progress line while the tool runs.
 * otherwise → a "Based on N sources" summary that expands to the passages.
 */
export function KnowledgeSources({
  sources,
  searching,
}: {
  sources?: KnowledgeSource[];
  searching?: boolean;
}) {
  const t = useTranslations();

  if (searching) {
    return (
      <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <BookOpen className="size-3.5 animate-pulse" />
        {t("studio.sourcesSearching")}
      </div>
    );
  }

  // The agent searched but found nothing worth grounding on — nothing to show.
  if (!sources || sources.length === 0) return null;

  return (
    <Collapsible className="group bg-muted/40 w-full rounded-md border">
      <CollapsibleTrigger className="text-muted-foreground hover:text-foreground flex w-full items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors">
        <BookOpen className="size-3.5" />
        {t("studio.sourcesTitle", { count: sources.length })}
        <ChevronDown className="ml-auto size-3.5 transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2.5 px-3 pb-3">
        {sources.map((source, i) => (
          <div key={i} className="border-border/60 border-l-2 pl-2.5">
            <p className="text-foreground text-xs font-medium">{source.resourceName}</p>
            {source.section && (
              <p className="text-muted-foreground text-[11px]">{source.section}</p>
            )}
            <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
              {t("studio.sourceSnippet", { text: truncate(source.content, SNIPPET_MAX) })}
            </p>
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
