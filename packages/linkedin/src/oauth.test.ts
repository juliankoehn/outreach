import { describe, it, expect, vi } from "vitest";
import { LinkedInOAuthClient } from "./oauth.js";

const cfg = { clientId: "cid", clientSecret: "secret", redirectUri: "http://localhost/cb" };

describe("LinkedInOAuthClient", () => {
  it("builds an authorization URL with state and scopes", () => {
    const client = new LinkedInOAuthClient(cfg);
    const { url, state } = client.createAuthorization(["openid", "profile", "w_member_social"]);
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://www.linkedin.com/oauth/v2/authorization");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("client_id")).toBe("cid");
    expect(u.searchParams.get("redirect_uri")).toBe("http://localhost/cb");
    expect(u.searchParams.get("scope")).toBe("openid profile w_member_social");
    expect(u.searchParams.get("state")).toBe(state);
    expect(state.length).toBeGreaterThan(16);
  });

  it("exchanges a code for tokens", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: "AT", refresh_token: "RT", expires_in: 3600, scope: "openid,w_member_social" }), { status: 200 }),
    ) as unknown as typeof fetch;
    const client = new LinkedInOAuthClient({ ...cfg, fetchImpl });
    const t = await client.exchangeCode("the-code");
    expect(t.accessToken).toBe("AT");
    expect(t.refreshToken).toBe("RT");
    expect(t.expiresIn).toBe(3600);
    expect(t.scopes).toEqual(["openid", "w_member_social"]);
  });

  it("throws a clear error on token exchange failure", async () => {
    const fetchImpl = vi.fn(async () => new Response("bad", { status: 400 })) as unknown as typeof fetch;
    const client = new LinkedInOAuthClient({ ...cfg, fetchImpl });
    await expect(client.exchangeCode("x")).rejects.toThrow(/token exchange failed/i);
  });

  it("maps a /v2/me (r_basicprofile) response to a member profile", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ id: "xyz789", localizedFirstName: "Julian", localizedLastName: "Koehn" }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;
    const client = new LinkedInOAuthClient({ ...cfg, fetchImpl });
    const p = await client.fetchProfile("AT");
    expect(p.memberUrn).toBe("urn:li:person:xyz789");
    expect(p.displayName).toBe("Julian Koehn");
    expect(p.avatarUrl).toBeUndefined();
  });

  it("still maps an OpenID userinfo response (sub/name/picture) as a fallback", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ sub: "abc123", name: "Jane Doe", picture: "http://img" }), { status: 200 }),
    ) as unknown as typeof fetch;
    const client = new LinkedInOAuthClient({ ...cfg, fetchImpl });
    const p = await client.fetchProfile("AT");
    expect(p.memberUrn).toBe("urn:li:person:abc123");
    expect(p.displayName).toBe("Jane Doe");
    expect(p.avatarUrl).toBe("http://img");
  });
});
