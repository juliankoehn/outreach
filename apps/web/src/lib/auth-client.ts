export type AuthErrorCode = "invalidCredentials" | "emailTaken" | "network" | "generic";

type AuthResult = { ok: true } | { ok: false; code: AuthErrorCode };

/**
 * Calls Better Auth (hosted on apps/api) through the web BFF proxy.
 * The doubled `/api/api` is intentional: the proxy prefix `/api` + the
 * backend's own `/api/auth` mount point.
 */
export async function authRequest(
  kind: "sign-in" | "sign-up",
  payload: Record<string, string>,
): Promise<AuthResult> {
  let res: Response;
  try {
    res = await fetch(`/api/api/auth/${kind}/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, code: "network" };
  }

  if (res.ok) return { ok: true };

  let msg = "";
  let beCode = "";
  try {
    const data = (await res.json()) as { message?: string; code?: string; error?: { message?: string; code?: string } };
    msg = (data.message ?? data.error?.message ?? "").toLowerCase();
    beCode = (data.code ?? data.error?.code ?? "").toUpperCase();
  } catch {
    /* non-JSON error body; fall through to status-based mapping */
  }

  if (kind === "sign-in" && (res.status === 401 || msg.includes("invalid") || msg.includes("credential"))) {
    return { ok: false, code: "invalidCredentials" };
  }
  if (
    kind === "sign-up" &&
    (beCode.includes("EXIST") || msg.includes("exist") || msg.includes("already") || res.status === 422)
  ) {
    return { ok: false, code: "emailTaken" };
  }
  return { ok: false, code: "generic" };
}
