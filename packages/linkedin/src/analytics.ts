/**
 * Member post analytics via LinkedIn's `memberCreatorPostAnalytics` endpoint
 * (scope: r_member_postAnalytics). This returns aggregate reporting metrics for
 * the authenticated member — NOT post content. Post text still comes from the
 * CSV export; these metrics enrich it.
 */

const ANALYTICS_URL = "https://api.linkedin.com/rest/memberCreatorPostAnalytics";

const METRIC_QUERY = {
  impressions: "IMPRESSION",
  membersReached: "MEMBERS_REACHED",
  reactions: "REACTION",
  comments: "COMMENT",
  reshares: "RESHARE",
} as const;

export type AggregateMetric = keyof typeof METRIC_QUERY;

export type AggregateAnalytics = Record<AggregateMetric, number>;

interface Config {
  accessToken: string;
  apiVersion?: string;
  fetchImpl?: typeof fetch;
}

export class MemberAnalyticsClient {
  private readonly fetch: typeof fetch;
  private readonly apiVersion: string;
  constructor(private readonly cfg: Config) {
    this.fetch = cfg.fetchImpl ?? fetch;
    this.apiVersion = cfg.apiVersion ?? "202601";
  }

  private async metric(queryType: string): Promise<number> {
    const url = new URL(ANALYTICS_URL);
    url.searchParams.set("q", "me");
    url.searchParams.set("queryType", queryType);
    url.searchParams.set("aggregation", "TOTAL");
    const res = await this.fetch(url, {
      headers: {
        Authorization: `Bearer ${this.cfg.accessToken}`,
        "LinkedIn-Version": this.apiVersion,
        "X-Restli-Protocol-Version": "2.0.0",
      },
    });
    if (!res.ok) throw new Error(`LinkedIn analytics ${queryType} failed: ${res.status}`);
    const json = (await res.json()) as { elements?: Array<{ count?: number }> };
    return json.elements?.[0]?.count ?? 0;
  }

  /** Lifetime aggregate metrics across all of the member's posts. */
  async aggregate(): Promise<AggregateAnalytics> {
    const entries = Object.entries(METRIC_QUERY) as [AggregateMetric, string][];
    const counts = await Promise.all(entries.map(([, q]) => this.metric(q)));
    const result = {} as AggregateAnalytics;
    entries.forEach(([key], i) => {
      result[key] = counts[i]!;
    });
    return result;
  }
}
