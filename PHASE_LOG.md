# Harness Agents Phase Log

This file records Phase-by-Phase decisions, implementation summaries, verification results, and remaining risks.

Update this file at the end of each Phase.

## Current Status

- Repository initialized and first GitHub push completed.
- Planning documents created:
  - `PLAN.md`
  - `IMPLEMENTATION.md`
  - `PHASE_LOG.md`
- Phase 0 implemented and verified locally on 2026-05-05.
- Phase 0 correction pass applied (schema alignment with PLAN.md, `safeJoin` added).
- Awaiting commit/push by user. Phase 1 not started.

## Phase Workflow

For each Phase:

1. Review `PLAN.md`.
2. Review `IMPLEMENTATION.md`.
3. Review latest entries in this file.
4. Ask Claude for the Phase-specific implementation plan.
5. Review and approve the plan.
6. Implement the Phase.
7. Run verification.
8. Update this log.
9. Commit and push.

## Phase 0 — Scaffold and Database Foundation

Status: Completed (2026-05-05) + correction pass applied (2026-05-05)

### Approved Scope

- pnpm monorepo skeleton.
- Next.js 16 app under `apps/web`.
- Prisma SQLite schema.
- Default Project seed.
- ModelCatalog seed from `models.json`.
- Read-only `/settings` page.
- Buildable app.

### Phase 0 Pre-Implementation Checklist

- [x] Claude has read `PLAN.md`, `IMPLEMENTATION.md`, and `PHASE_LOG.md`.
- [x] Claude has produced a Phase 0 detailed implementation plan.
- [x] Phase 0 plan reviewed and approved.
- [x] Implementation started.
- [x] Verification passed.
- [x] Log updated.
- [ ] Commit pushed. (User to commit and push.)

### Phase 0 Verification Commands

```powershell
pnpm install
pnpm --filter web prisma migrate dev
pnpm --filter web prisma db seed
pnpm --filter web build
```

### Phase 0 Created or Modified Files

Root:

- `pnpm-workspace.yaml` — pnpm workspace manifest (`apps/*`, `packages/*`).
- `package.json` — engines `node >=20.9`, `pnpm >=9`; root scripts proxy to `apps/web`.
- `tsconfig.base.json` — TS strict + `noUncheckedIndexedAccess`, ES2022, Bundler resolution.
- `.editorconfig` — 2-space LF / UTF-8.
- `.gitignore` — ignores `dev.db`, `*.db-*`, `.next`, `node_modules`, `projects/`, `.env*`. Does NOT ignore `apps/web/prisma/migrations/*`.
- `.env.example` — `DATABASE_URL=file:./dev.db`, provider keys, Ollama URL, fallback master key, workspace root.
- `models.json` — 7 models (Anthropic 3, OpenAI 2, Ollama 2). Phase 0 correction added `displayName`, `modelId`, `endpointType`, `costTier`, `speedTier`, `recommendedUse` per PLAN §16.
- `README.md` — stack, layout, getting-started, Phase 0 acceptance, security note.
- `pnpm-lock.yaml` — lockfile.
- `.prettierrc` — skipped; the active `pre:config-protection` hook blocks creation. Phase 0 build does not depend on prettier.

`apps/web/`:

- `apps/web/package.json` — Next 16, React 19, Prisma 5.22, Tailwind 4, tsx; `prisma.seed` config.
- `apps/web/next.config.ts` — `typedRoutes: true` (top-level, not experimental); `serverExternalPackages: ['@prisma/client', 'prisma']`.
- `apps/web/tsconfig.json` — extends root base; aliases `@/*`, `@app/*`, `@db/*`, `@lib/*`.
- `apps/web/postcss.config.mjs` — `@tailwindcss/postcss` plugin.
- `apps/web/.env` — local-only `DATABASE_URL` (gitignored).
- `apps/web/app/layout.tsx` — root layout with header nav.
- `apps/web/app/page.tsx` — placeholder home.
- `apps/web/app/globals.css` — Tailwind v4 import + dark/light tokens.
- `apps/web/app/settings/page.tsx` — server component reading `ModelCatalog`.
- `apps/web/prisma/schema.prisma` — 18 models. Initial migration plus correction-pass alignment with PLAN.md.
- `apps/web/prisma/seed.ts` — upserts Default Project + ModelCatalog rows from `models.json`.
- `apps/web/prisma/migrations/20260505143208_init/` — initial migration (committed).
- `apps/web/prisma/migrations/<timestamp>_align_phase0_planmd_fields/` — schema correction migration (committed).
- `apps/web/src/db/client.ts` — `PrismaClient` singleton with HMR guard.
- `apps/web/src/lib/workspace/paths.ts` — `workspaceRoot`, `projectDir`, `runDir`, `teamDir`, `agentReportsDir`, plus `safeJoin` (resolves, rejects `..`, absolute, Windows drive prefix, and workspace-external paths).

### Phase 0 Verification Results (2026-05-05)

Initial pass:

- `pnpm install` — succeeded after switching the schema's `Json` fields to `String` JSON. Prisma 5.22 SQLite does not support native `Json` (revision #5 fallback applied).
- `pnpm --filter web exec prisma migrate dev --name init` — succeeded. Migration `20260505143208_init/migration.sql` written and applied. `dev.db` created.
- `pnpm --filter web exec prisma db seed` — succeeded: 1 Default Project + 7 ModelCatalog rows.
- `pnpm --filter web build` — succeeded. Next 16.2.4 + Turbopack. Routes built: `/` (static), `/_not-found` (static), `/settings` (dynamic ƒ).

Correction pass (after PLAN.md re-alignment, 2026-05-05):

- Removed local `apps/web/prisma/dev.db` so the new migration applies on a clean slate (only seed data was present).
- `pnpm --filter web exec prisma migrate dev --name align_phase0_planmd_fields --skip-seed` — succeeded. Both migrations applied: `20260505143208_init` and `20260505145009_align_phase0_planmd_fields/migration.sql` (130 lines).
- `pnpm --filter web exec prisma db seed` — succeeded: 1 Default Project + 7 ModelCatalog rows with the new `modelId`/`displayName`/`endpointType`/`costTier`/`speedTier`/`recommendedUse` shape.
- `pnpm --filter web build` — succeeded. Next 16.2.4 + Turbopack. Routes built: `/` (static), `/_not-found` (static), `/settings` (dynamic ƒ).

### Phase 0 Decisions

- `Json` fields stored as `String` containing `JSON.stringify` content per revision #5 fallback. Prisma 5.22 SQLite does not yet support native `Json`. Future migration to Prisma 7 can switch back if desired.
- Status / kind / provider / endpointType / costTier / speedTier kept as plain `String` (not Prisma enums) for SQLite migration stability.
- Tailwind v4 via `@tailwindcss/postcss`; no JS Tailwind config file required.
- `typedRoutes: true` placed at the top level of `next.config.ts` per Next 16.
- Path aliases configured in `tsconfig.json` (`@db/*`, `@lib/*`, `@app/*`, `@/*`).
- `Default Project` seeded with `slug=default`, `isDefault=true` so new Runs land here automatically.
- ModelCatalog primary key remains a cuid; `modelId` field added (`@unique`) so seed/upsert and provider lookups can use the canonical provider id.
- `safeJoin` rejects: `..` traversal, absolute path segments, Windows drive-letter prefixes (e.g., `C:foo`), and any final resolved path that is not contained within the resolved base.

### Phase 0 Remaining Risks

- Prisma 5 still does not support `Json` on SQLite. Continued use of `String`-encoded JSON requires every reader/writer to call `JSON.parse` / `JSON.stringify` consistently. Phase 1 should add a small typed helper to centralize this.
- `.prettierrc` is absent because the harness `pre:config-protection` hook blocks creation. Format consistency relies on `.editorconfig` + manual care until the hook is reconfigured.
- Process-restart recovery for in-flight Runs is not implemented yet. Phase 1/4 must mark `running` runs as `failed(process_restart)` on boot.
- Secret store and redactor are not implemented yet. No real provider keys should be stored until Phase 1 is complete.
- Migrations grow with Phase 1+ work. The team must keep the rule "migrations are committed; do not gitignore" intact.

## Phase 1 — Providers, Tools, Secrets

Status: Not started

### Approved Scope

- Provider adapters.
- Runtime functions.
- Model availability checks.
- Secrets store.
- Redactor.
- Tool registry.
- Policy engine.
- Sandboxed filesystem tools.
- Settings editor.

### Verification Targets

- Provider bad key isolation.
- Secret redaction.
- Workspace path denial.
- ToolCall logging.

### Completion Notes

Not completed yet.

## Phase 2 — PO Q&A

Status: Not started

### Approved Scope

- `/runs/new` prompt intake.
- Dynamic PO question generation.
- QuestionCard and Timeline.
- Answer edit and stale propagation.
- QaSession persistence.

### Verification Targets

- Complete 6-question flow.
- AI auto-judge answer path.
- Previous answer edit marks later questions stale.

### Completion Notes

Not completed yet.

## Phase 3 — Team Composition

Status: Not started

### Approved Scope

- Team recall recommendations.
- New Team proposal.
- TeamComposer UI.
- Initial TeamRevision.
- `AGENTS.md` and `team.json` export.

### Verification Targets

- Proposed team created.
- Agent model edit persists.
- Team files written.
- TeamRevision v1 exists.

### Completion Notes

Not completed yet.

## Phase 4 — DAG Executor and Run Progress

Status: Not started

### Approved Scope

- Lead DAG planning.
- Task rows.
- Sequential executor.
- RunEvents.
- SSE endpoint.
- Run detail UI.

### Verification Targets

- Plan and task events stream.
- Refresh replay works.
- Process restart marks running run failed.

### Completion Notes

Not completed yet.

## Phase 5 — Result, Feedback, Revision

Status: Not started

### Approved Scope

- Output synthesis.
- Result and per-Agent reports.
- FeedbackBatch and Feedback rows.
- Revision diff proposal.
- Approval creates TeamRevision v2+.

### Verification Targets

- Output files exist.
- Feedback rows exist.
- Diff panel renders.
- Approval updates files and preserves previous revision.

### Completion Notes

Not completed yet.

## Decision Log

### 2026-05-05 — Architecture Baseline

- Use pnpm monorepo.
- Place Next.js app in `apps/web`.
- Use SQLite + Prisma for local-first MVP.
- Use DB as source of truth.
- Treat markdown/json files as exports/cache.
- Use SSE + DB polling fallback.
- Exclude inter-team collaboration from MVP.
- Use Project -> Team -> Run hierarchy.
- Use PO recommendation plus user final selection for team recall.
- Use user approval before TeamRevision updates.

## Git Commit Guide

Commit after each verified Phase.

Suggested commit messages:

```powershell
git add PLAN.md IMPLEMENTATION.md PHASE_LOG.md
git commit -m "Add project planning documents"
git push

git add .
git commit -m "Scaffold phase 0 app foundation"
git push

git add .
git commit -m "Add phase 1 provider tool and secrets foundation"
git push

git add .
git commit -m "Add phase 2 PO Q&A flow"
git push

git add .
git commit -m "Add phase 3 team composition flow"
git push

git add .
git commit -m "Add phase 4 DAG run executor"
git push

git add .
git commit -m "Add phase 5 feedback revision flow"
git push
```

