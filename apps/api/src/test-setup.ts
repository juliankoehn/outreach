import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Bare `vitest run` does not auto-load the repo-root .env (unlike the app's
// runtime, which goes through a loader). Parse it here and fill in any keys
// that aren't already set, so the api test suite works without the caller
// having to manually export S3_*/WEB_ORIGIN etc. first.
function loadRepoRootEnv() {
  const here = dirname(fileURLToPath(import.meta.url));
  const envPath = join(here, "..", "..", "..", ".env");
  let contents: string;
  try {
    contents = readFileSync(envPath, "utf8");
  } catch {
    return;
  }
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadRepoRootEnv();

process.env.DATABASE_URL ??= "postgresql://outreach:outreach@localhost:5544/outreach";
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.BETTER_AUTH_SECRET ??= "test-secret";
process.env.BETTER_AUTH_URL ??= "http://localhost:8787";
process.env.WEB_ORIGIN ??= "http://localhost:3000";
process.env.LINKEDIN_CLIENT_ID ??= "cid";
process.env.LINKEDIN_CLIENT_SECRET ??= "csecret";
process.env.LINKEDIN_REDIRECT_URI ??= "http://localhost:8787/linkedin/callback";
