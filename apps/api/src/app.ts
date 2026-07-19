import { Hono } from "hono";
import { cors } from "hono/cors";
import { auth, type AuthUser } from "./auth.js";
import { env } from "./env.js";
import { feedRoutes } from "./routes/feed.js";
import { linkedinRoutes } from "./routes/linkedin.js";
import { profileRoutes } from "./routes/profile.js";
import { resourcesRoutes } from "./routes/resources.js";
import { scheduleRoutes } from "./routes/schedule.js";
import { studioRoutes } from "./routes/studio.js";
import { getObject } from "./storage.js";

export type AppEnv = { Variables: { user: AuthUser | null } };

export function createApp() {
  const app = new Hono<AppEnv>();

  app.use("*", cors({ origin: env.WEB_ORIGIN, credentials: true }));

  app.get("/health", (c) => c.json({ status: "ok" }));

  // Public: serve AI-generated images from object storage. No auth —
  // referenced directly by <img src> in the web app.
  app.get("/generated/:name", async (c) => {
    const name = c.req.param("name");
    if (name.includes("/") || name.includes("\\")) return c.json({ error: "not_found" }, 404);
    const obj = await getObject(`generated/${name}`);
    if (!obj) return c.json({ error: "not_found" }, 404);
    return new Response(obj.body, {
      headers: { "Content-Type": obj.contentType, "Cache-Control": "public, max-age=31536000" },
    });
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
  app.route("/linkedin", resourcesRoutes());

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

  app.use("/feed/*", async (c, next) => {
    if (!c.get("user")) return c.json({ error: "unauthorized" }, 401);
    await next();
  });

  app.route("/feed", feedRoutes());

  app.use("/schedule/*", async (c, next) => {
    if (!c.get("user")) return c.json({ error: "unauthorized" }, 401);
    await next();
  });

  app.route("/schedule", scheduleRoutes());

  return app;
}
