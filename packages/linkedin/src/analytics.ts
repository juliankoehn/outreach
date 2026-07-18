/**
 * Member post analytics via LinkedIn's `memberCreatorPostAnalytics` endpoint
 * (scope: r_member_postAnalytics). Returns reporting metrics — NOT post content.
 * `aggregate()` sums across all posts (q=me); `forPost()` returns metrics for a
 * single post URN (q=entity). Post text still comes from the CSV export.
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

/** Build the Rest.li `entity` param, e.g. `(share:urn%3Ali%3Ashare%3A123)`. */
function entityParam(urn: string): string {
  const kind = urn.includes(":ugcPost:") ? "ugc" : "share";
  return `(${kind}:${encodeURIComponent(urn)})`;
}

export class MemberAnalyticsClient {
  private readonly fetch: typeof fetch;
  private readonly apiVersion: string;
  constructor(private readonly cfg: Config) {
    this.fetch = cfg.fetchImpl ?? fetch;
    this.apiVersion = cfg.apiVersion ?? "202601";
  }

  private async count(query: string): Promise<number> {
    const res = await this.fetch(`${ANALYTICS_URL}?${query}`, {
      headers: {
        Authorization: `Bearer ${this.cfg.accessToken}`,
        "LinkedIn-Version": this.apiVersion,
        "X-Restli-Protocol-Version": "2.0.0",
      },
    });
    if (!res.ok) throw new Error(`LinkedIn analytics failed: ${res.status}`);
    const json = (await res.json()) as { elements?: Array<{ count?: number }> };
    return json.elements?.[0]?.count ?? 0;
  }

  private async allMetrics(base: string): Promise<AggregateAnalytics> {
    const entries = Object.entries(METRIC_QUERY) as [AggregateMetric, string][];
    const counts = await Promise.all(
      entries.map(([, q]) => this.count(`${base}&queryType=${q}&aggregation=TOTAL`)),
    );
    const result = {} as AggregateAnalytics;
    entries.forEach(([key], i) => {
      result[key] = counts[i]!;
    });
    return result;
  }

  /** Lifetime aggregate metrics across all of the member's posts. */
  aggregate(): Promise<AggregateAnalytics> {
    return this.allMetrics("q=me");
  }

  /** Metrics for a single post, given its share/ugcPost URN. */
  forPost(postUrn: string): Promise<AggregateAnalytics> {
    return this.allMetrics(`q=entity&entity=${entityParam(postUrn)}`);
  }
}
