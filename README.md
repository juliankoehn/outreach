# Outreach

A LinkedIn content engine that learns your voice and runs the whole loop for you:

**learn your voice → surface ideas → draft (AI) → schedule → publish → measure → learn again.**

Connect a LinkedIn account, let the studio interview you and analyse your past
posts into a brand brief, then draft posts with an AI writing partner (with a
writer↔reviewer quality loop and on-brand image generation), schedule them on a
calendar, auto-publish at the planned time, and pull back real engagement so the
next draft is grounded in what actually performed.

## Stack

- **Monorepo** — pnpm workspaces + Turborepo. TypeScript throughout.
- **`apps/api`** — [Hono](https://hono.dev) HTTP API + [pg-boss](https://github.com/timgit/pg-boss) background workers (feed polling, scheduled publishing, token refresh, metrics enrichment).
- **`apps/web`** — Next.js (App Router) + Tailwind + shadcn/ui, next-intl (en/de).
- **`packages/ai`** — Vercel AI SDK v7 (OpenAI): drafting, the writer↔reviewer review loop, image art-direction + generation, profile synthesis, RAG.
- **`packages/linkedin`** — LinkedIn OAuth + Posts/Images/Comments + analytics clients.
- **`packages/db`** — Prisma 7 (pg driver adapter) + pgvector for knowledge RAG.
- **`packages/core`** — shared crypto (AES-GCM token encryption) + types.
- **Infra (local)** — Postgres 17 + pgvector, MinIO (S3) via Docker Compose.

## Prerequisites

- **Node ≥ 22** and **pnpm 10.9** (`corepack enable` picks up the pinned version).
- **Docker** (for Postgres + MinIO).
- A **LinkedIn developer app** (Client ID/Secret) with the products enabling
  `r_basicprofile`, `r_member_postAnalytics`, and `w_member_social`, and the
  redirect URL `http://localhost:8787/linkedin/callback`.
- An **OpenAI API key** (drafting + images).

## Quick start

```bash
# 1. Install
pnpm install

# 2. Configure env — copy the example and fill in the blanks
cp .env.example .env
#   ENCRYPTION_KEY       openssl rand -base64 32
#   BETTER_AUTH_SECRET   openssl rand -base64 32
#   LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET   from your LinkedIn app
#   OPENAI_API_KEY       your OpenAI key
#   (defaults for DATABASE_URL / S3_* match the Docker Compose services below)

# 3. Start Postgres + MinIO (the S3 bucket is created automatically on first use)
pnpm db:up

# 4. Apply the database schema
pnpm db:migrate

# 5. Run everything (api + web) in watch mode
pnpm dev
```

Then open **http://localhost:3000**, create an account, and connect LinkedIn.

### Ports

| Service        | URL                         |
| -------------- | --------------------------- |
| Web            | http://localhost:3000       |
| API            | http://localhost:8787       |
| Postgres       | localhost:5544              |
| MinIO (S3)     | http://localhost:9000       |
| MinIO console  | http://localhost:9001       |

> If ports 9000/9001 are taken, override `MINIO_API_PORT` / `MINIO_CONSOLE_PORT`
> in `.env` and point `S3_ENDPOINT` at the chosen API port.

## Environment variables

All config lives in the gitignored root `.env` (loaded by both apps). See
[`.env.example`](./.env.example) for the full list. Highlights:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres (pgvector) connection |
| `ENCRYPTION_KEY` | AES-GCM key for encrypting LinkedIn tokens at rest |
| `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` | session auth |
| `LINKEDIN_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` | LinkedIn OAuth |
| `LINKEDIN_API_VERSION` | rolling `YYYYMM` LinkedIn API version (bump on a 426) |
| `OPENAI_API_KEY` | required when AI routes run |
| `AI_TEXT_MODEL` / `AI_IMAGE_MODEL` | model overrides (defaults: `gpt-4o` / `gpt-image-2`) |
| `S3_*` | MinIO/S3 for generated images + uploaded resources |

## Common commands

```bash
pnpm dev          # api + web in watch mode (Turborepo)
pnpm build        # typecheck/build all packages
pnpm test         # run all test suites (vitest)
pnpm lint         # typecheck all packages
pnpm db:up        # start Postgres + MinIO (docker compose)
pnpm db:migrate   # apply Prisma migrations (dev)
```

Run a single package's tests, e.g.: `pnpm --filter @outreach/api exec vitest run`.

## Background workers

The API process runs pg-boss workers on a schedule (no separate process needed):

- **feed poll** — refresh RSS/content sources.
- **publish-due** (every minute) — publish drafts whose scheduled time has arrived.
- **refresh-tokens** (6-hourly) — proactively refresh LinkedIn tokens nearing expiry.
- **enrich-metrics** (daily) — re-pull engagement for posts published in the last 30 days.

## Notes

- The Prisma client is generated (gitignored); `pnpm install` + `pnpm db:migrate`
  regenerate it. The knowledge-RAG uses a pgvector HNSW index — see the warning
  comment in `packages/db/prisma/schema.prisma` before touching migrations.
- Secrets never enter the repo: `.env`, `node_modules`, the generated Prisma
  client, and generated images are all gitignored.
