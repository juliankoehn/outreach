import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url(),
  ENCRYPTION_KEY: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(1),
  BETTER_AUTH_URL: z.string().url(),
  API_PORT: z.coerce.number().default(8787),
  WEB_ORIGIN: z.string().url(),
  LINKEDIN_CLIENT_ID: z.string().min(1),
  LINKEDIN_CLIENT_SECRET: z.string().min(1),
  LINKEDIN_REDIRECT_URI: z.string().url(),
  // Rolling LinkedIn API version (YYYYMM). LinkedIn keeps only a recent window
  // active; bump this when calls start returning 426 NONEXISTENT_VERSION.
  LINKEDIN_API_VERSION: z.string().regex(/^\d{6}$/).default("202601"),
  AI_PROVIDER: z.string().default("openai"),
  AI_TEXT_MODEL: z.string().default("gpt-4o"),
  AI_IMAGE_MODEL: z.string().default("gpt-image-1"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_SECURE: z.coerce.boolean().default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default("Outreach <no-reply@localhost>"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}
export const env = parsed.data;
