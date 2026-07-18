// packages/linkedin/src/csv-ingestor.ts
import { parse } from "csv-parse/sync";
import type { RawPost, MediaType } from "@outreach/core";
import type { PostIngestor } from "./ingestor.js";

interface ShareRow {
  Date?: string;
  ShareLink?: string;
  ShareCommentary?: string;
  MediaUrl?: string;
}

function extractUrn(shareLink: string | undefined): string | null {
  if (!shareLink) return null;
  const m = shareLink.match(/urn:li:share:\d+/);
  return m ? m[0] : null;
}

export class CsvShareIngestor implements PostIngestor {
  private _skipped = 0;
  constructor(private readonly csvContent: string) {}

  get skipped(): number {
    return this._skipped;
  }

  async fetch(): Promise<RawPost[]> {
    this._skipped = 0;
    const rows = parse(this.csvContent, {
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
    }) as ShareRow[];

    const posts: RawPost[] = [];
    for (const row of rows) {
      const dateStr = row.Date?.trim();
      const text = row.ShareCommentary?.trim() ?? "";
      if (!dateStr || (!text && !row.MediaUrl)) {
        this._skipped++;
        continue;
      }
      const publishedAt = new Date(dateStr.replace(" ", "T") + "Z");
      if (Number.isNaN(publishedAt.getTime())) {
        this._skipped++;
        continue;
      }
      const mediaType: MediaType = row.MediaUrl?.trim() ? "image" : "none";
      posts.push({
        externalId: extractUrn(row.ShareLink),
        text,
        mediaType,
        publishedAt,
        raw: row,
      });
    }
    return posts;
  }
}
