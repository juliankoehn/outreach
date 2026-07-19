import { defineConfig } from "prisma/config";

// Prisma 7 moved the datasource connection URL out of schema.prisma. The CLI
// (migrate / db push / studio) reads it from here; the runtime client gets it
// via the pg driver adapter in src/client.ts.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.DATABASE_URL },
});
