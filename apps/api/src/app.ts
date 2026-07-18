import { Hono } from "hono";
import { cors } from "hono/cors";
import { auth, type AuthUser } from "./auth.js";
import { env } from "./env.js";

export type AppEnv = { Variables: { user: AuthUser | null } };

export function createApp() {
  const app = new Hono<AppEnv>();

  app.use("*", cors({ origin: env.WEB_ORIGIN, credentials: true }));

  app.use("*", async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    c.set("user", session?.user ?? null);
    await next();
  });

  app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

  app.get("/health", (c) => c.json({ status: "ok" }));

  // Protected route group guard
  app.use("/linkedin/*", async (c, next) => {
    if (!c.get("user")) return c.json({ error: "unauthorized" }, 401);
    await next();
  });

  app.get("/linkedin/accounts", (c) => c.json({ accounts: [] })); // filled in Task 12

  return app;
}
