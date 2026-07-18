import { randomBytes } from "node:crypto";

const AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const USERINFO_URL = "https://api.linkedin.com/v2/userinfo";

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
    const res = await this.fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`LinkedIn userinfo failed: ${res.status}`);
    const j = (await res.json()) as Record<string, unknown>;
    return {
      memberUrn: `urn:li:person:${String(j.sub)}`,
      displayName: String(j.name ?? "LinkedIn Member"),
      avatarUrl: j.picture ? String(j.picture) : undefined,
    };
  }
}
