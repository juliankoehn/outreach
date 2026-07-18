// apps/api/src/oauth-state.ts
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env.js";

// state payload = userId; we sign it so the callback can trust it without storage.
export function signState(userId: string, nonce: string): string {
  const body = `${userId}.${nonce}`;
  const sig = createHmac("sha256", env.BETTER_AUTH_SECRET).update(body).digest("hex");
  return `${body}.${sig}`;
}

export function verifyState(state: string): { userId: string } | null {
  const parts = state.split(".");
  if (parts.length !== 3) return null;
  const [userId, nonce, sig] = parts;
  const expected = createHmac("sha256", env.BETTER_AUTH_SECRET).update(`${userId}.${nonce}`).digest("hex");
  const a = Buffer.from(sig!);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { userId: userId! };
}
