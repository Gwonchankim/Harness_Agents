# Harness Agents

Local-first web app for composing and reusing **purpose-built agent teams**. A PO Agent refines vague requests into a concrete spec via dynamic Q&A, then a 5-agent team (1 lead) collaborates over a DAG to produce results. Teams persist as `AGENTS.md` + `team.json` and accumulate feedback across runs.

See [`PLAN.md`](./PLAN.md) for the full specification: domain model, DB schema, workflows, subsystems, file layout, and phased implementation plan.

## Stack

Next.js 16 (App Router) + TypeScript + Tailwind · SQLite + Prisma · Vercel AI SDK (OpenAI / Anthropic / Ollama) · SSE for realtime · `keytar` for secrets.

## Status

Greenfield — Phase 0 (scaffolding) not yet started. Working directory is the repo root.
