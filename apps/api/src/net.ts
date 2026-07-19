// apps/api/src/net.ts
import { lookup } from "node:dns/promises";

/**
 * Classify a resolved IP (v4 or v6) as loopback/private/link-local — the
 * ranges an SSRF-hardened outbound fetch must never be allowed to reach, even
 * when the URL's hostname passes an allowlist (a malicious or compromised
 * redirect could point the hostname at an internal address).
 * Covers: 127.0.0.0/8, 10/8, 172.16/12, 192.168/16, 169.254/16, 0.0.0.0/8,
 * ::1, fc00::/7 (unique local), fe80::/10 (link-local), and IPv4-mapped IPv6
 * addresses (::ffff:a.b.c.d) recursed through the IPv4 rules.
 */
export function isPrivateOrLoopbackIp(ip: string): boolean {
  const v4Mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (v4Mapped) return isPrivateOrLoopbackIp(v4Mapped[1]!);

  if (ip.includes(".") && !ip.includes(":")) {
    const parts = ip.split(".").map((p) => Number(p));
    if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
      return true; // malformed address — reject rather than risk it
    }
    const [a, b] = parts as [number, number, number, number];
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
    if (a === 0) return true; // 0.0.0.0/8
    return false;
  }

  if (!ip.includes(":")) return true; // not a recognizable IPv4 or IPv6 literal — reject defensively

  const normalized = ip.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true; // loopback / unspecified
  if (/^f[cd][0-9a-f]{2}:/.test(normalized)) return true; // fc00::/7 unique local
  if (/^fe[89ab][0-9a-f]:/.test(normalized)) return true; // fe80::/10 link-local
  return false;
}

/**
 * Parse and validate a URL for outbound fetch: only http/https are allowed,
 * and every resolved address is checked against the private/loopback ranges
 * above so DNS can't be used to redirect a fetch to an internal host.
 */
export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("invalid_url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("bad_protocol");
  const addrs = await lookup(url.hostname, { all: true });
  for (const a of addrs) if (isPrivateOrLoopbackIp(a.address)) throw new Error("blocked_host");
  return url;
}

/**
 * Fetch a URL as text with SSRF hardening: redirects are followed manually
 * so every hop (not just the initial URL) is re-validated against the
 * public/private-IP guard above, and the response body is capped in size.
 */
export async function safeFetchText(
  raw: string,
  opts?: { maxBytes?: number; timeoutMs?: number; maxHops?: number },
): Promise<string> {
  const maxBytes = opts?.maxBytes ?? 5_000_000;
  const maxHops = opts?.maxHops ?? 5;
  let current = raw;
  for (let hop = 0; hop <= maxHops; hop++) {
    await assertPublicHttpUrl(current); // re-validate every hop (SSRF via redirect)
    const res = await fetch(current, {
      redirect: "manual",
      headers: {
        // Many feeds sit behind WAFs (Cloudflare, WordPress) that 403 non-browser
        // user-agents — present a real browser UA + Accept-Language so public
        // feeds are actually reachable.
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(opts?.timeoutMs ?? 12_000),
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error("redirect_no_location");
      current = new URL(loc, current).toString();
      continue;
    }
    if (!res.ok) throw new Error(`http_${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) throw new Error("too_large");
    return new TextDecoder().decode(buf.slice(0, maxBytes));
  }
  throw new Error("too_many_redirects");
}
