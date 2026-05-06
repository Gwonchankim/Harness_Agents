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
- Phase 0 correction pass applied and re-verified on 2026-05-05 (schema alignment with `PLAN.md` / `IMPLEMENTATION.md`, `safeJoin` added).
- Awaiting commit/push by user (user owns git ops).
- **Next session first step:** see the "Resume Prompt" section at the bottom of this file. Phase 1 has not started.

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

## Today's Session — 2026-05-05

### Phase 0 work completed today

Initial Phase 0 scaffolding:

- pnpm workspace, root configs, Next.js 16 app under `apps/web`, Tailwind v4, TS strict.
- Prisma SQLite schema covering all 18 MVP models. `Json` fields stored as `String` JSON.stringify content per the SQLite fallback (revision #5).
- Default Project + 7-row ModelCatalog seed from `models.json`.
- Placeholder home page and read-only `/settings` page reading `ModelCatalog` server-side.

Phase 0 correction pass (applied later in the same session):

- ✅ `PHASE_LOG.md` Phase 0 status updated to **Completed (2026-05-05) + correction pass applied**, with created files, decisions, and risks recorded.
- ✅ `safeJoin` added to `apps/web/src/lib/workspace/paths.ts`. Rejects `..` traversal, absolute segments, Windows drive-letter prefixes, UNC paths, NUL bytes, and any final resolved path that escapes the workspace base. Existing `projectDir`/`runDir`/`teamDir`/`agentReportsDir` re-routed through `safeJoin`. Exposes `isWithin` and `SafePathError`.
- ✅ Prisma schema re-aligned with `PLAN.md` / `IMPLEMENTATION.md`:
  - `Team`: added `domain`, `tags` (JSON array, default `"[]"`), `leadAgentId` + `leadAgent` relation, `currentRevisionId` + `currentRevision` relation, `score`, `runCount` (default 0). Indexed on `leadAgentId` and `currentRevisionId`.
  - `Agent`: added `leadOf Team[] @relation("TeamLeadAgent")` back-relation.
  - `TeamRevision`: added `currentOf Team[] @relation("TeamCurrentRevision")` back-relation.
  - `QaQuestion`: added `status` (default `"active"`) + `staleAt`, indexed on `status`.
  - `QaAnswer`: added `choiceIndex`, `customText`, `isAutoJudged` (default `false`), indexed on `isAutoJudged`.
  - `ExecutionPlan`: added `tasks Task[]` back-relation.
  - `Task`: added `planId` + `plan` relation, `taskKey`, `expectedOutput`, `result`, `error`, `completedAt`. Renamed `endedAt` → `completedAt`, dropped `outputs` (replaced by `result`). New `@@unique([planId, taskKey])` and index on `planId`.
  - `ModelCatalog`: `id` is now a cuid; added `modelId @unique`, renamed `label` → `displayName`, added `endpointType`, `costTier`, `speedTier`, `recommendedUse`. Indexed on `enabled`.
- ✅ `models.json` (version 2): each entry now has `modelId`, `displayName`, `endpointType`, `costTier`, `speedTier`, `recommendedUse`.
- ✅ `apps/web/prisma/seed.ts`: upserts ModelCatalog by `modelId` and writes the new fields.
- ✅ `apps/web/app/settings/page.tsx`: renders `displayName`, `modelId`, `endpointType`, `costTier`, `speedTier`, `recommendedUse`. Order changed to `(provider, modelId)`.
- ✅ Schema correction migration generated and applied: `apps/web/prisma/migrations/20260505145009_align_phase0_planmd_fields/migration.sql` (130 lines).

### Files created/modified today (highlights)

Root:

- `pnpm-workspace.yaml`, `package.json`, `tsconfig.base.json`, `.editorconfig`, `.gitignore`, `.env.example`, `models.json`, `README.md`, `pnpm-lock.yaml`.
- `.prettierrc` was **skipped** (the active `pre:config-protection` hook blocks creation; not required for Phase 0 build).

`apps/web`:

- `apps/web/package.json`, `apps/web/next.config.ts`, `apps/web/tsconfig.json`, `apps/web/postcss.config.mjs`, `apps/web/.env` (local-only, gitignored).
- `apps/web/app/layout.tsx`, `apps/web/app/page.tsx`, `apps/web/app/globals.css`, `apps/web/app/settings/page.tsx`.
- `apps/web/prisma/schema.prisma`, `apps/web/prisma/seed.ts`.
- `apps/web/prisma/migrations/20260505143208_init/migration.sql`.
- `apps/web/prisma/migrations/20260505145009_align_phase0_planmd_fields/migration.sql`.
- `apps/web/prisma/migrations/migration_lock.toml`.
- `apps/web/src/db/client.ts`.
- `apps/web/src/lib/workspace/paths.ts` (with `safeJoin`).

Docs:

- `PHASE_LOG.md` updated (this file).

### Verification commands run today

```powershell
pnpm install
pnpm --filter web exec prisma migrate dev --name init --skip-seed
pnpm --filter web exec prisma db seed
pnpm --filter web build

# Correction pass (clean dev.db, re-apply both migrations)
Remove-Item apps/web/prisma/dev.db -ErrorAction SilentlyContinue
pnpm --filter web exec prisma migrate dev --name align_phase0_planmd_fields --skip-seed
pnpm --filter web exec prisma db seed
pnpm --filter web build
```

### Verification results

- `pnpm install` — succeeded after switching `Json` fields to `String` JSON. 59 packages added; Prisma client generated.
- `prisma migrate dev` (init) — succeeded; `20260505143208_init/migration.sql` applied. `dev.db` created.
- `prisma db seed` (init) — succeeded; 1 Default Project + 7 ModelCatalog rows.
- `next build` (init) — succeeded; routes `/`, `/_not-found`, `/settings (ƒ)`. Next 16.2.4 + Turbopack. TypeScript clean.
- `prisma migrate dev` (correction) — succeeded; both migrations applied on a clean `dev.db`. `20260505145009_align_phase0_planmd_fields/migration.sql` (130 lines).
- `prisma db seed` (correction) — succeeded; new ModelCatalog shape persisted.
- `next build` (correction) — succeeded; same three routes. TypeScript clean.

### Remaining items / corrections still owed

- Commit + push Phase 0 (user owns git). Suggested message: `feat(phase-0): scaffold monorepo, full Prisma schema, default seed, settings page, safeJoin`. Migrations under `apps/web/prisma/migrations/` MUST be included in the commit.
- Browser smoke test of `/` and `/settings` (`pnpm --filter web dev` → http://localhost:3000). Build is green; visual confirmation has not been done.
- A small typed JSON-string helper (parse/stringify with default) is owed in Phase 1 to keep the `String`-encoded JSON fields consistent across services.
- `.prettierrc` is still absent because the harness `pre:config-protection` hook blocks creation. Format consistency relies on `.editorconfig` and manual care until that's reconfigured.
- Optional: clean up the auxiliary `IMPLEMENTATION.md` / `PLAN.md` / `PHASE_LOG.md` working-tree state (`PLAN.md` shows as `M` in `git status`; the new content is intentional). User to review before commit.

### Next session: where to start

1. Review `PHASE_LOG.md` "Today's Session — 2026-05-05" and the Resume Prompt below.
2. (If not done in this terminal) commit and push Phase 0.
3. Open Phase 1 planning per `IMPLEMENTATION.md` § "Phase 1 — Providers, Tools, Secrets". Do not write Phase 1 code until the detailed Phase 1 plan is reviewed and approved.

## Resume Prompt — paste into next session

```text
오늘은 어제 멈춘 지점에서 이어서 작업합니다.

먼저 다음을 확인해주세요:
1. `PLAN.md`, `IMPLEMENTATION.md`, `PHASE_LOG.md`를 읽습니다.
2. `PHASE_LOG.md`의 "Today's Session — 2026-05-05" 섹션과 "Phase 0 — Scaffold and Database Foundation" 섹션을 읽고 어제 어디까지 끝났는지 파악합니다.

현재 상태 (2026-05-05 기준):
- Phase 0 (스캐폴딩 + 보정 패스)가 완료되었고 verified입니다.
- migrate / seed / build 모두 PASS.
- 마이그레이션 두 개:
    apps/web/prisma/migrations/20260505143208_init/
    apps/web/prisma/migrations/20260505145009_align_phase0_planmd_fields/
- `safeJoin`이 `apps/web/src/lib/workspace/paths.ts`에 추가되어 있고, 워크스페이스 외부 경로/`..` 트래버설/Windows drive prefix/UNC를 모두 거부합니다.
- Prisma 스키마는 `PLAN.md` / `IMPLEMENTATION.md`와 정렬되었습니다 (Team, QaQuestion, QaAnswer, Task, ModelCatalog 필드 추가/이름 변경).
- 사용자가 Phase 0를 git commit + push 했는지는 모름 (사용자가 직접 처리).
- Phase 1은 아직 시작하지 않았습니다.

오늘의 작업:

1. `git log --oneline -5`로 Phase 0 커밋이 들어갔는지 확인하세요.
   - 아직 안 들어갔다면 어떤 파일을 staging해야 하는지만 알려주세요. 직접 commit/push 하지는 마세요.

2. 그 다음 Phase 1 — Providers, Tools, Secrets 계획을 만들어주세요.
   `IMPLEMENTATION.md`의 Phase 1 스코프와 verification targets를 그대로 따릅니다.
   - 만들 파일 목록과 각 파일 책임을 짧게 정리
   - DB 스키마 변경이 필요하면 별도 항목으로 명시 (Phase 1에서는 마이그레이션이 필요 없을 가능성이 큼)
   - 실행할 verification 명령
   - Risk / 가정
   - 그 후 멈추고 사용자 승인을 기다립니다.

3. 승인 전까지 코드를 직접 작성하지 마세요. plan만 만들고 stop.

참고:
- DB 스키마는 SQLite + Prisma 5.22 환경. JSON-shaped 필드는 `String`에 stringify된 상태로 들어 있습니다. 이걸 다루는 typed helper가 Phase 1에 들어가야 합니다.
- 시크릿은 keytar 우선 + AES-GCM SQLite fallback. fallback master key는 `HARNESS_SECRET_FALLBACK_KEY` env. README에 local obfuscation only로 명시됨.
- 모든 fs 도구는 `safeJoin`을 통과해야 합니다. Phase 1에서 fs tools를 만들 때 이 규칙을 어기지 마세요.
- Provider 어댑터: OpenAI / Anthropic / Ollama. Ollama는 OpenAI-compatible 엔드포인트(`http://localhost:11434/v1`) 우선.
- 런타임은 `streamText`, `generateObject`, `checkModelAvailability` 세 함수로 분리. 단일 `complete` 금지.

이 prompt를 받은 시점에서 가장 먼저 해야 할 일은:
- `PLAN.md`, `IMPLEMENTATION.md`, `PHASE_LOG.md` 읽기
- Phase 1 plan 작성
- 승인 대기
```

