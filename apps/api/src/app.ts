import { Hono } from "hono";
import { cors } from "hono/cors";
import { readFile } from "node:fs/promises";
import { join, normalize, sep } from "node:path";
import { auth, type AuthUser } from "./auth.js";
import { env } from "./env.js";
import { uploadsDir } from "./images.js";
import { linkedinRoutes } from "./routes/linkedin.js";
import { profileRoutes } from "./routes/profile.js";
import { studioRoutes } from "./routes/studio.js";

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export type AppEnv = { Variables: { user: AuthUser | null } };

export function createApp() {
  const app = new Hono<AppEnv>();

  app.use("*", cors({ origin: env.WEB_ORIGIN, credentials: true }));

  app.get("/health", (c) => c.json({ status: "ok" }));

  // Public: serve saved images from disk. No auth — referenced directly by
  // <img src> in the web app. Implemented as a plain handler (rather than
  // @hono/node-server/serve-static) because serveStatic's `root` resolves
  // relative to `process.cwd()`, which differs between `tsx watch` (repo
  // root) and a built/packaged run; reading straight from `uploadsDir` (an
  // absolute path derived from `import.meta.url` in images.ts) is correct
  // regardless of cwd.
  app.get("/uploads/:name", async (c) => {
    const name = c.req.param("name");
    // Reject path traversal / nested paths; only a bare filename is valid.
    if (name.includes("/") || name.includes("\\") || normalize(name) !== name) {
      return c.json({ error: "not_found" }, 404);
    }
    const path = join(uploadsDir, name);
    if (!path.startsWith(uploadsDir + sep) && path !== uploadsDir) {
      return c.json({ error: "not_found" }, 404);
    }
    try {
      const bytes = await readFile(path);
      const ext = name.split(".").pop()?.toLowerCase() ?? "";
      const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";
      return new Response(bytes, { headers: { "Content-Type": contentType } });
    } catch {
      return c.json({ error: "not_found" }, 404);
    }
  });

  app.use("*", async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    c.set("user", session?.user ?? null);
    await next();
  });

  app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

  // Protected route group guard
  app.use("/linkedin/*", async (c, next) => {
    if (!c.get("user")) return c.json({ error: "unauthorized" }, 401);
    await next();
  });

  app.route("/linkedin", linkedinRoutes());

  app.use("/profiles/*", async (c, next) => {
    if (!c.get("user")) return c.json({ error: "unauthorized" }, 401);
    await next();
  });

  app.route("/profiles", profileRoutes());

  app.use("/studio/*", async (c, next) => {
    if (!c.get("user")) return c.json({ error: "unauthorized" }, 401);
    await next();
  });

  app.route("/studio", studioRoutes());

  return app;
}
