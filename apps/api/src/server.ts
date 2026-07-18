import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { env } from "./env.js";

serve({ fetch: createApp().fetch, port: env.API_PORT }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`);
});
