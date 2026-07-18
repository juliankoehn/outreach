import { describe, it, expect, vi } from "vitest";
import { MemberAnalyticsClient } from "./analytics.js";

function metricResponse(count: number) {
  return new Response(JSON.stringify({ elements: [{ count }], paging: { total: 1 } }), { status: 200 });
}

describe("MemberAnalyticsClient", () => {
  it("aggregates all five metrics from q=me calls", async () => {
    const byMetric: Record<string, number> = {
      IMPRESSION: 137371,
      MEMBERS_REACHED: 90000,
      REACTION: 1041,
      COMMENT: 88,
      RESHARE: 12,
    };
    const fetchImpl = vi.fn(async (input: URL | RequestInfo) => {
      const q = new URL(String(input)).searchParams.get("queryType")!;
      return metricResponse(byMetric[q]!);
    }) as unknown as typeof fetch;

    const client = new MemberAnalyticsClient({ accessToken: "AT", fetchImpl });
    const a = await client.aggregate();
    expect(a).toEqual({
      impressions: 137371,
      membersReached: 90000,
      reactions: 1041,
      comments: 88,
      reshares: 12,
    });
  });

  it("defaults a missing metric count to 0", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ elements: [] }), { status: 200 }),
    ) as unknown as typeof fetch;
    const client = new MemberAnalyticsClient({ accessToken: "AT", fetchImpl });
    const a = await client.aggregate();
    expect(a.impressions).toBe(0);
  });

  it("sends q=me, aggregation=TOTAL, and the version header", async () => {
    const fetchImpl = vi.fn(async () => metricResponse(1)) as unknown as typeof fetch;
    const client = new MemberAnalyticsClient({ accessToken: "AT", apiVersion: "202601", fetchImpl });
    await client.aggregate();
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const u = new URL(String(url));
    expect(u.searchParams.get("q")).toBe("me");
    expect(u.searchParams.get("aggregation")).toBe("TOTAL");
    expect((init as RequestInit).headers).toMatchObject({ "LinkedIn-Version": "202601" });
  });

  it("throws when a metric call fails", async () => {
    const fetchImpl = vi.fn(async () => new Response("no", { status: 403 })) as unknown as typeof fetch;
    const client = new MemberAnalyticsClient({ accessToken: "AT", fetchImpl });
    await expect(client.aggregate()).rejects.toThrow(/analytics/i);
  });

  it("forPost queries q=entity with the URL-encoded post URN", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: URL | RequestInfo) => {
      calls.push(String(input));
      return metricResponse(5);
    }) as unknown as typeof fetch;
    const client = new MemberAnalyticsClient({ accessToken: "AT", fetchImpl });
    const a = await client.forPost("urn:li:share:999");
    expect(a.impressions).toBe(5);
    expect(a.reactions).toBe(5);
    expect(calls[0]).toContain("q=entity");
    expect(calls[0]).toContain("entity=(share:urn%3Ali%3Ashare%3A999)");
  });

  it("forPost uses the ugc entity kind for ugcPost URNs", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: URL | RequestInfo) => {
      calls.push(String(input));
      return metricResponse(1);
    }) as unknown as typeof fetch;
    const client = new MemberAnalyticsClient({ accessToken: "AT", fetchImpl });
    await client.forPost("urn:li:ugcPost:42");
    expect(calls[0]).toContain("entity=(ugc:urn%3Ali%3AugcPost%3A42)");
  });
});
