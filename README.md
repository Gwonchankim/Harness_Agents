# Harness Agents

Local-first multi-agent workspace MVP. A Next.js app where you describe a task, a PO Agent
asks a few clarifying questions, a 5-agent team is assembled (one of them a Lead), and the
team executes a DAG of subtasks against your local LLM providers.

> **Status:** Phase 0 scaffolding only. No agents run yet. The pages exist as placeholders;
> the database schema and seed are wired up so later phases can build on a solid foundation.

## Stack

- pnpm workspace monorepo
- Next.js 16 (App Router) + React 19 + TypeScript strict
- Tailwind CSS
- SQLite via Prisma (DB is the source of truth; markdown/JSON files are exports)
- Vercel AI SDK with OpenAI / Anthropic / Ollama providers
- SSE for live run progress, with DB polling fallback

## Layout

```
.
├── apps/
│   └── web/                 # Next.js app (UI + API routes + Prisma)
│       └── prisma/
│           ├── schema.prisma
│           ├── migrations/  # COMMITTED — required for repeatable builds
│           └── seed.ts
├── models.json              # Source of truth for ModelCatalog seed
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .env.example
└── package.json
```

## Prerequisites

- Node.js ≥ 20.9
- pnpm ≥ 9 (`npm i -g pnpm` if you don't have it)

## Getting started

```bash
pnpm install
cp .env.example apps/web/.env
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Then open http://localhost:3000. The `/settings` page lists models seeded from `models.json`.

## Phase 0 acceptance criteria

- `pnpm install` succeeds
- `pnpm --filter web prisma migrate dev` succeeds
- `pnpm --filter web prisma db seed` succeeds (creates a Default Project + ModelCatalog rows)
- `pnpm --filter web build` succeeds
- `/` renders a placeholder
- `/settings` reads ModelCatalog server-side and renders the model list

## Security note (local MVP)

Provider API keys are stored via `keytar` when available, otherwise an AES-GCM-encrypted
SQLite fallback keyed by `HARNESS_SECRET_FALLBACK_KEY`. **The fallback is local
obfuscation, not a strong security boundary.** Anyone with read access to your home
directory can decrypt secrets stored that way. Do not use this build to hold third-party
keys you wouldn't be willing to leave in plaintext on this machine.

`run_events`, `ToolCall.args/result`, and error logs are redacted before persistence to
avoid leaking keys.

## Roadmap (post Phase 0)

- Phase 1 — Project & Run scaffolding, prompt-input page, in-memory queue
- Phase 2 — PO Q&A workflow with structured outputs
- Phase 3 — Team builder, AGENTS.md / team.json export
- Phase 4 — Lead DAG planner + Agent task runtime
- Phase 5 — SSE progress, result.md / report.md / agent reports
- Phase 6 — FeedbackBatch + TeamRevision proposals + diff approval

## License

Private MVP. No license granted yet.
