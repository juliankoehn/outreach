import { randomBytes } from "node:crypto";

const AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
// /v2/me works with the `r_basicprofile` scope. We deliberately avoid the
// OpenID `/v2/userinfo` endpoint because it requires the `openid` scope, which
// isn't part of the Community Management API product.
const PROFILE_URL = "https://api.linkedin.com/v2/me";

export interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  scopes: string[];
}

export interface LinkedInProfile {
  memberUrn: string;
  displayName: string;
  avatarUrl?: string;
}

interface Config {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
}

export class LinkedInOAuthClient {
  private readonly fetch: typeof fetch;
  constructor(private readonly cfg: Config) {
    this.fetch = cfg.fetchImpl ?? fetch;
  }

  createAuthorization(scopes: string[]): { url: string; state: string } {
    const state = randomBytes(16).toString("hex");
    const params = new URLSearchParams({
      response_type: "code",
      client_id: this.cfg.clientId,
      redirect_uri: this.cfg.redirectUri,
      state,
      scope: scopes.join(" "),
    });
    return { url: `${AUTH_URL}?${params.toString()}`, state };
  }

  private parseTokens(json: Record<string, unknown>): TokenResponse {
    const scopeRaw = typeof json.scope === "string" ? json.scope : "";
    return {
      accessToken: String(json.access_token),
      refreshToken: json.refresh_token ? String(json.refresh_token) : undefined,
      expiresIn: Number(json.expires_in ?? 0),
      scopes: scopeRaw.split(/[ ,]+/).filter(Boolean),
    };
  }

  async exchangeCode(code: string): Promise<TokenResponse> {
    const res = await this.fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: this.cfg.redirectUri,
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
      }),
    });
    if (!res.ok) throw new Error(`LinkedIn token exchange failed: ${res.status}`);
    return this.parseTokens((await res.json()) as Record<string, unknown>);
  }

  async refresh(refreshToken: string): Promise<TokenResponse> {
    const res = await this.fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
      }),
    });
    if (!res.ok) throw new Error(`LinkedIn token refresh failed: ${res.status}`);
    return this.parseTokens((await res.json()) as Record<string, unknown>);
  }

  async fetchProfile(accessToken: string): Promise<LinkedInProfile> {
    const res = await this.fetch(PROFILE_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`LinkedIn profile fetch failed: ${res.status}`);
    const j = (await res.json()) as Record<string, unknown>;

    // Handle both the /v2/me shape (id + localizedFirstName/LastName) and the
    // OpenID userinfo shape (sub + name + picture), so either token works.
    const id = String(j.id ?? j.sub ?? "");
    const first = typeof j.localizedFirstName === "string" ? j.localizedFirstName : "";
    const last = typeof j.localizedLastName === "string" ? j.localizedLastName : "";
    const composed = `${first} ${last}`.trim();
    const displayName =
      composed || (typeof j.name === "string" ? j.name : "") || "LinkedIn Member";

    return {
      memberUrn: `urn:li:person:${id}`,
      displayName,
      avatarUrl: typeof j.picture === "string" ? j.picture : undefined,
    };
  }
}
