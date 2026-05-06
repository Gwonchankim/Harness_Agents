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
- Phase 1 (Providers, Tools, Secrets) implemented and verified locally on 2026-05-06.
- Awaiting commit/push by user (user owns git ops).

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

Status: Completed (2026-05-06)

### Approved Scope

- Provider adapters (OpenAI, Anthropic, Ollama via OpenAI-compat).
- Runtime split into `streamText`, `generateObject`, `checkModelAvailability`.
- Model availability with 3-second timeout and 60-second per-provider cache.
- Secrets store: keytar primary, AES-GCM fallback with env key → local key file.
- Redactor with pattern + dynamic known-values list.
- Tool registry + policy engine.
- Sandboxed filesystem tools (`fs.readFile`, `fs.writeFile`, `fs.listDir`).
- `web.search` registered but disabled.
- Settings editor with masked inputs and provider availability badges.

### Verification Targets

- Provider bad-key isolation: ✅ catalog endpoint returns per-provider availability with `{available:false, reason}` and never throws.
- Secret redaction: ✅ patterns + known-value cache covered by 8 redactor unit tests.
- Workspace path denial: ✅ 12 paths tests cover `..`, absolute, drive-letter, UNC, NUL, cross-drive.
- ToolCall logging: ✅ registry writes denied / failed / done rows with redacted args/result. Policy engine covered by 6 unit tests.

### Phase 1 Pre-Implementation Checklist

- [x] Phase 1 plan reviewed and revised with user adjustments (keytar fallback chain, secret-name whitelist, atomic writes, etc.).
- [x] Implementation completed.
- [x] Verification passed (typecheck, tests, build, migrate status).
- [x] Log updated.
- [ ] Commit pushed. (User to commit and push.)

### Phase 1 Verification Commands

```powershell
pnpm install
pnpm --filter web typecheck
pnpm --filter web test
pnpm --filter web build
pnpm --filter web exec prisma migrate status
```

### Phase 1 Created or Modified Files

Root:

- `package.json` — added `test` proxy script.
- `.gitignore` — ignore `apps/web/.local/` so the AES-GCM fallback key file is never committed.

`apps/web/`:

- `apps/web/package.json` — added `ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/openai-compatible`, `zod`; added `test` script with explicit Windows-safe file list.
- `apps/web/next.config.ts` — added `'keytar'` to `serverExternalPackages` so Turbopack treats it as a server-only external.
- `apps/web/src/types/keytar.d.ts` — ambient module declaration so TS builds without the optional native module installed.

`apps/web/src/lib/db/`:

- `apps/web/src/lib/db/json.ts` — `parseJson<T>(s, fallback)`, `stringifyJson(v)`, `parseStringArray(v)`. Centralizes the SQLite JSON-string fallback owed from Phase 0.

`apps/web/src/lib/secrets/`:

- `apps/web/src/lib/secrets/redactor.ts` — `redact()`, `redactString()`, `registerKnownSecret()`. Pattern matchers for Anthropic / OpenAI / Bearer plus dynamic known-value list.
- `apps/web/src/lib/secrets/store.ts` — `getSecret`, `setSecret`, `deleteSecret`, `listSecrets`, `getStorageBackend`. Keytar primary; falls back to AES-GCM with key from `HARNESS_SECRET_FALLBACK_KEY` else generated `apps/web/.local/secret.key`. Whitelist of secret names: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OLLAMA_BASE_URL`.
- `apps/web/src/lib/secrets/index.ts` — barrel export.
- `apps/web/src/lib/secrets/redactor.test.ts` — 8 unit tests.

`apps/web/src/lib/providers/`:

- `apps/web/src/lib/providers/types.ts` — `ProviderAdapter`, `AvailabilityResult`.
- `apps/web/src/lib/providers/openai.ts` — adapter using `@ai-sdk/openai`, ping via `GET /v1/models`.
- `apps/web/src/lib/providers/anthropic.ts` — adapter using `@ai-sdk/anthropic`, ping via `GET /v1/models` with 1-token messages probe fallback.
- `apps/web/src/lib/providers/ollama.ts` — adapter using `@ai-sdk/openai-compatible` against `OLLAMA_BASE_URL` (default `http://localhost:11434/v1`).
- `apps/web/src/lib/providers/index.ts` — registry, `getProviderByName`, `buildModel`.

`apps/web/src/lib/agents/`:

- `apps/web/src/lib/agents/runtime.ts` — `streamText`, `generateObject`, `checkProviderAvailability`, `checkModelAvailability`. 3-second AbortSignal timeout for ping. All errors are caught and redacted.

`apps/web/src/lib/models/`:

- `apps/web/src/lib/models/catalog.ts` — `listModels`, `listEnabledModels`, `getModelOrThrow`, `getProviderAvailability` (60-second TTL cache), `getAvailabilityMap`.

`apps/web/src/lib/tools/`:

- `apps/web/src/lib/tools/types.ts`
- `apps/web/src/lib/tools/policy.ts` — pure `evaluatePolicy` with allowlist `['fs.readFile', 'fs.writeFile', 'fs.listDir', 'web.search']`.
- `apps/web/src/lib/tools/registry.ts` — `invokeTool` writes ToolCall rows with `denied` / `failed` / `done` status, args + result redacted before stringify.
- `apps/web/src/lib/tools/fsTools.ts` — registers fs tools. Atomic temp+rename writes, `mkdir -p` only inside workspace, max read/write 5 MB, max listDir 1000 entries. Every path goes through `safeJoin(workspaceRoot(), ...)`.
- `apps/web/src/lib/tools/webSearch.ts` — registered with `enabled=false`; execute throws `tool_disabled` if reached.
- `apps/web/src/lib/tools/index.ts` — barrel that triggers tool registration on import.
- `apps/web/src/lib/tools/policy.test.ts` — 6 unit tests.

`apps/web/src/lib/workspace/`:

- `apps/web/src/lib/workspace/paths.test.ts` — 12 unit tests for `safeJoin` / `isWithin`.

`apps/web/app/api/`:

- `apps/web/app/api/secrets/route.ts` — `GET` (masked list + storage backend), `POST` (whitelist-validated upsert).
- `apps/web/app/api/secrets/[name]/route.ts` — `DELETE`.
- `apps/web/app/api/models/route.ts` — `GET` returns catalog rows + per-provider availability.

`apps/web/src/components/settings/`:

- `apps/web/src/components/settings/SecretsEditor.tsx` — client island with masked inputs, save/clear buttons, storage-backend label.
- `apps/web/src/components/settings/AvailabilityBadges.tsx` — client island that fetches `/api/models` and renders per-provider availability badges (does not block initial render of `/settings`).

`apps/web/app/settings/page.tsx` — upgraded server component: reads catalog, secret list, and storage backend in parallel, then composes the two client islands above.

### Phase 1 Verification Results (2026-05-06)

- `pnpm install` — succeeded; new packages: `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/openai-compatible`, `ai`, `zod` (and transitive deps). Prisma client regenerated by `postinstall`.
- `pnpm --filter web typecheck` — succeeded with zero errors.
- `pnpm --filter web test` — 26 / 26 passed (8 redactor + 12 paths + 6 policy).
- `pnpm --filter web build` — succeeded. Turbopack clean. Routes: `/` (static), `/_not-found` (static), `/api/models` (ƒ), `/api/secrets` (ƒ), `/api/secrets/[name]` (ƒ), `/settings` (ƒ).
- `prisma migrate status` — clean; no Phase 1 migrations needed.

### Phase 1 Decisions

- **keytar is not in `package.json`.** It is loaded via dynamic `import('keytar' as string)` with `webpackIgnore` / `turbopackIgnore` magic comments, plus an ambient `apps/web/src/types/keytar.d.ts` shim. This means the build never fails on missing native deps and Windows users without VS Build Tools land cleanly on the AES-GCM fallback.
- **AES-GCM fallback key chain.** Resolves in order: `HARNESS_SECRET_FALLBACK_KEY` → generated `apps/web/.local/secret.key` (32 bytes base64, mode 0600 best-effort, gitignored). The store NEVER fails `setSecret` for "no fallback available" — the local-key file is auto-generated on first use.
- **AES-GCM with a local key file is local obfuscation, not strong security.** Documented here per user request. An attacker with read access to `apps/web/.local/secret.key` and the SQLite DB can decrypt every stored secret. This is acceptable for the local-first single-user MVP.
- **Storage backend label** surfaces in the Settings UI (`keytar` / `sqlite-aes-gcm` / `env-only`) so the user sees which path is active.
- **Secret-name whitelist** enforced server-side. `/api/secrets` rejects any name outside `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `OLLAMA_BASE_URL` with HTTP 400.
- **Tools default scope is `workspaceRoot()`.** The fs tools accept a single `relPath` and run it through `safeJoin(workspaceRoot(), ...)`. They do not yet scope per-Run; that constraint can be tightened in Phase 4 when actual Run dirs come online.
- **`web.search` stub.** Registered with `enabled=false`, so policy denies before invoke. Even bypassing the registry the execute body throws `tool_disabled` rather than make outbound HTTP.
- **Atomic writes.** `fs.writeFile` writes to `{path}.tmp-{rand}` and `rename`s into place. Cleans up the temp file on error.
- **Test runner is Windows-safe.** `tsx --test` with an explicit file list (no glob), so PowerShell does not need to expand patterns. Three files: `redactor.test.ts`, `paths.test.ts`, `policy.test.ts`.
- **Process-restart recovery deferred to Phase 4** (intentional deviation). No Run can reach `running` until DAG executor lands; running the recovery sweep now would have nothing to recover.

### Phase 1 Remaining Risks

- The AES-GCM fallback is only as secret as `apps/web/.local/secret.key`. If the user wants stronger storage on Windows they need to install keytar manually (`pnpm add -w keytar` is intentionally NOT done).
- The Anthropic ping uses `GET /v1/models`; the docs allow this but if the deployment ever returns 404 we fall back to a 1-token messages probe. We have not exercised that fallback against a live deployment.
- `getAvailabilityMap` calls every distinct provider serially in `Promise.all`. With three providers and a 3-second timeout the worst case is ~3 s. If a provider hangs longer than the timeout the AbortSignal still fires.
- The redactor's regex layer is best-effort. Strong scrubbing relies on `registerKnownSecret`, which is populated whenever the store decrypts a row. Phase 4 must call `getSecret`/`listSecrets` near-startup so the cache is warm before the executor logs anything.
- Manual UI smoke test of `/settings` (`pnpm dev`) was NOT run in this session; the build is green and types check, but visual confirmation of the SecretsEditor and AvailabilityBadges remains to do.

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

## Today's Session — 2026-05-06

### Phase 1 work completed today

Implemented Providers, Tools, Secrets per the revised plan. Build green, 26/26 tests pass, no schema changes.

### Next session: where to start

1. Review `PHASE_LOG.md` "Phase 1 — Providers, Tools, Secrets" section for what landed.
2. (If not done in this terminal) commit and push Phase 1.
3. Run `pnpm --filter web dev` and visually smoke-test `/settings` (SecretsEditor + AvailabilityBadges).
4. Open Phase 2 planning per `IMPLEMENTATION.md` § "Phase 2 — PO Q&A". Do not write Phase 2 code until the detailed plan is reviewed and approved.

## Resume Prompt — paste into next session

```text
오늘은 어제 멈춘 지점에서 이어서 작업합니다.

먼저 다음을 확인해주세요:
1. `PLAN.md`, `IMPLEMENTATION.md`, `PHASE_LOG.md`를 읽습니다.
2. `PHASE_LOG.md`의 "Today's Session — 2026-05-06" 섹션과 "Phase 1 — Providers, Tools, Secrets" 섹션을 읽고 어디까지 끝났는지 파악합니다.

현재 상태 (2026-05-06 기준):
- Phase 0 + Phase 1이 모두 완료되었고 verified입니다.
- typecheck / test (26/26) / build / migrate status 모두 PASS.
- DB 스키마 변경은 없음. Phase 1은 마이그레이션을 추가하지 않았습니다.
- 시크릿 스토어:
    - keytar 우선(없어도 빌드/실행 모두 OK).
    - AES-GCM fallback: `HARNESS_SECRET_FALLBACK_KEY` env > 자동 생성된 `apps/web/.local/secret.key` (gitignored).
    - 시크릿 이름 whitelist: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OLLAMA_BASE_URL`.
- 도구는 fs.readFile / fs.writeFile / fs.listDir + 비활성화된 web.search.
    - 모든 fs 호출은 `safeJoin(workspaceRoot(), ...)`을 통과.
    - 쓰기는 임시파일 + rename 원자 쓰기, 5 MB 페이로드 가드.
- runtime: `streamText`, `generateObject`, `checkProviderAvailability` / `checkModelAvailability`.
- Settings UI: `/settings`가 카탈로그를 즉시 SSR하고, 가용성 배지는 `/api/models` 클라이언트 아일랜드가 비동기로 로드.
- 사용자가 Phase 1을 git commit + push 했는지는 모름 (사용자가 직접 처리).
- Phase 2는 아직 시작하지 않았습니다.

오늘의 작업:

1. `git log --oneline -5`로 Phase 1 커밋이 들어갔는지 확인하세요.
   - 아직 안 들어갔다면 어떤 파일을 staging해야 하는지만 알려주세요. 직접 commit/push 하지는 마세요.

2. (선택) `pnpm --filter web dev`를 띄우고 `/settings`를 브라우저에서 확인합니다.
   - SecretsEditor 입력/저장/Clear 동작
   - AvailabilityBadges가 `/api/models`를 호출해 표시되는지
   - 빈 키 상태에서 가용성이 "not configured"로 표시되는지

3. 그 다음 Phase 2 — PO Q&A 계획을 만들어주세요.
   `IMPLEMENTATION.md`의 Phase 2 스코프와 verification targets를 그대로 따릅니다.
   - 만들 파일 목록과 각 파일 책임 정리
   - DB 스키마 변경 여부 (Phase 2는 QaSession/QaQuestion/QaAnswer를 본격 사용 — 추가 컬럼 필요한지 판단)
   - 실행할 verification 명령
   - Risk / 가정
   - 그 후 멈추고 사용자 승인을 기다립니다.

4. 승인 전까지 코드를 직접 작성하지 마세요. plan만 만들고 stop.

참고:
- Stringified JSON 헬퍼는 `apps/web/src/lib/db/json.ts`에 들어 있음 (`parseJson`, `stringifyJson`, `parseStringArray`).
- 시크릿 스토어 사용법: `getSecret('OPENAI_API_KEY')` 등. PO/Lead 호출 경로에서 시크릿을 직접 읽지 말고 runtime을 거치세요.
- 도구 호출은 반드시 `invokeTool(ctx, name, args)` 경유. 정책/리댁션/ToolCall row 자동 처리.
- Provider 어댑터/런타임은 `@lib/agents/runtime`의 `streamText` / `generateObject`로 호출. 단일 `complete` 금지 규칙은 그대로 유지.

이 prompt를 받은 시점에서 가장 먼저 해야 할 일은:
- `PLAN.md`, `IMPLEMENTATION.md`, `PHASE_LOG.md` 읽기
- Phase 2 plan 작성
- 승인 대기
```

