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
- Phase 2 (PO Q&A) implemented and verified locally on 2026-05-06.
- Phase 2 correction pass applied and re-verified on 2026-05-06 (stale-pending gate, isEdit fix, sessionState test file, inline UI hint).
- Phase 3 (Team Composition) implemented and verified locally on 2026-05-06.
- Phase 3 tiny correction (export size guard) applied and re-verified on 2026-05-06.
- Phase 3 pre-commit corrections (nav active state, two-dropdown PO model selector, QaFlow auto-advance fix) applied and re-verified on 2026-05-06.
- Phase 3 local Ollama QA timeout correction applied and re-verified on 2026-05-06 (provider-specific PO timeout, enriched 504 body, QaFlow error gate + Retry UI, Ollama hint).
- Phase 3 QA busy-state + interaction-lock UI correction applied and re-verified on 2026-05-06 (option-6 visual lockdown, pick() guard, Skip visual disable, Timeline flicker fix via interactionLocked).
- Phase 3 QA pending-operation status correction applied and re-verified on 2026-05-06 (replaced boolean busy with explicit pendingOperation enum so the answer→next handoff label never flickers).
- Phase 3 Compose Team correction applied and re-verified on 2026-05-07 (TeamComposer Provider + Model 2-stage selector with consistent provider/modelId state; in-place success panel replacing the 404-prone `router.push('/runs/[runId]')`; 409 `run_already_has_team` mapped to the same success panel).
- Phase 4 (DAG Executor and Run Progress) implemented and verified locally on 2026-05-07 on branch `phase-4-dag-executor`. No schema change, no migration, no new dependencies. 89 / 89 tests pass; 18 routes (4 new); typecheck and prisma migrate status clean.
- Phase 4 commit `09eada1 Add phase 4 DAG executor and run progress` pushed to `origin/phase-4-dag-executor` on 2026-05-07. PR / compare link: <https://github.com/Gwonchankim/Harness_Agents/compare/main...phase-4-dag-executor?expand=1>.
- Gemini provider/catalog update completed on 2026-05-22: added Google provider plumbing, `GOOGLE_GENERATIVE_AI_API_KEY`, and the requested Gemini 3.1/3.5 + 2.5 catalog entries. Manual Gemini smoke is next.
- Run/Q&A interaction polish completed on 2026-05-23: multi-select checkboxes now visibly fill on the left, and run start/planning now shows a blur-backed progress popup. Typecheck, 92 / 92 tests, build, and migrate status all pass.
- Run recovery and navigation polish completed on 2026-05-23: recoverable Lead-provider failures now show an inline team model editor, Home lists existing runs with resume links, and Q&A/Compose/Run pages use a sticky collapsible prompt header. Typecheck, 92 / 92 tests, build, and migrate status all pass.
- Phase 4 SSE custom-event correction applied on 2026-05-23: live Run progress now listens to named SSE events (`plan.created`, `task.started`, `run.completed`, etc.) instead of only the default `message` event. This fixes Runs that completed in the DB while the UI stayed stuck on the planning overlay.
- Run progress and Q&A error polish applied on 2026-05-24: the run progress popup now remains visible during `running` agent execution, and generic Q&A HTTP 500 copy now gives refresh/retry guidance instead of showing only `HTTP 500`.
- Final result output added on 2026-05-24: successful Runs now export `result.md`, emit `result.created`, and show a Final Result panel above per-agent outputs. Older completed Runs get a deterministic fallback final result assembled from existing task outputs.
- Q&A duplicate next-question race correction applied on 2026-05-24: the client now guards concurrent `/next` requests, and the server treats a duplicate question-order write as idempotent instead of surfacing HTTP 500.
- Compose already-team revisit correction applied on 2026-05-24: `/runs/new/{sessionId}/compose` now detects `Run.teamId` server-side and renders an already-composed success panel instead of calling recommendations and surfacing `run_already_has_team` as an error.
- Compose-to-run start shortcut added on 2026-05-24: team-confirmed panels now start the run directly from the compose success screen and then navigate to `/runs/{runId}`, removing the extra Open Run -> Start Run step.
- Lead planning recovery added on 2026-05-24: Lead DAG planning now retries schema failures once with a strict repair prompt, and persistent `lead_plan_schema_error` / `lead_plan_timeout:*` failures expose the existing team model editor so the user can switch the Lead to a stronger/faster model and reset the Run to `ready`.
- Run progress live-state reconciliation added on 2026-05-24: Run detail now falls back to polling if SSE stays in `connecting...`, and even healthy SSE sessions periodically reconcile DB state so completed runs move to the Final Result panel without manual refresh.
- Q&A auto-judge / progress / recovery correction applied on 2026-05-24: PO Q&A no longer blocks on provider availability preflight before generation, final-question progress displays the real final count, and process-restart recovery only sweeps stale planning/running Runs instead of freshly started Runs.
- Phase 6 (Reuse / History / Resume / Retry UX) implemented and verified locally on 2026-05-24 on branch `phase-6-reuse-history-ux`. No schema change, no migration, no new dependencies. typecheck clean; 116 / 116 tests; `next build` 26 routes (4 new: `/runs`, `/teams`, `/teams/[teamId]`, `/api/runs/[runId]/retry`); prisma migrate status clean. Plan in `PHASE6_PLAN.md`. Not yet committed/pushed (user handles git).
- Phase 6 browser smoke + Team Library search correction completed on 2026-05-24. `/runs`, `/teams`, `/teams/[teamId]`, feedback revisit, and failed-run recovery panels were checked in the in-app browser. Team search now filters non-matching queries instead of only re-ranking all teams. typecheck clean; 119 / 119 tests; `next build` 26 routes; prisma migrate status clean.
- Phase 7 (Run Control & Provider Stability) implemented and verified locally on 2026-05-25 on branch `phase-7-run-control`. Adds run cancel (`POST /api/runs/[runId]/cancel`), a unified provider-error classifier shared by po/lead/team/leadRevise/worker (adds rate_limit + model_not_found), and richer long-run progress UX (elapsed time, last-event age, transport, in-overlay Cancel). No schema migration, no new dependency. typecheck clean; 134 / 134 tests; `next build` 27 routes (1 new: `/api/runs/[runId]/cancel`); prisma migrate status clean. Plan in `PHASE7_PLAN.md`. Browser smoke checked cancel guards, model-recovery reset, Start -> planning overlay, Cancel -> `failed(user_cancelled)` + `run.cancelled`, and Retry -> `ready`; state-refresh polish keeps the server header and client panel in sync after Start/Cancel/Retry/model-reset. Provider-specific auth/timeout/rate-limit panels are still worth spot-checking when convenient. Not yet committed/pushed (user handles git).
- **Open issues carried forward** (still deferred):
  - Local Ollama compose is considered unreliable for team composition; use a paid/cloud PO model for now. Gemini support is now available for that path.
  - Phase 4 manual smoke (real Lead plan + agent execution + SSE) not yet exercised — first task on the next session before any merge to `main`.

## Phase 6 — Reuse / History / Resume / Retry UX (2026-05-24)

Status: Implemented and verified locally. Branch `phase-6-reuse-history-ux`. Plan: `PHASE6_PLAN.md`.

### Approved scope (decisions)

1. Team Library included: `/teams` + `/teams/[teamId]`.
2. AGENTS.md / team.json preview sourced from the DB snapshot (`TeamRevision.agentsMd` / `teamJson`); disk exports are cache only.
3. Retry is hybrid: failed run with no `ExecutionPlan` resets in place to `ready`; failed run that already has a plan/tasks clones a new run and preserves the failed one. Executor untouched.
4. Revision rollback excluded (history read/compare only).
5. Failed-run model editing keeps the existing `team-models` flow for provider/lead-plan failures; other failures are handled by the new retry action (model edit and retry stay separate).

### New files

- `src/lib/runs/resumeTarget.ts` (+ test) — pure status → continue-target mapping (extracted from home).
- `src/lib/runs/failureClass.ts` (+ test) — pure `failedReason` → category / recoveryAction / copy.
- `src/lib/runs/list.ts` — run-list query with status + prompt-search filters.
- `src/lib/runs/retry.ts` — hybrid retry (reset-in-place vs clone-new-run).
- `src/lib/teams/ratings.ts` (+ test) — pure read-only rating aggregation.
- `src/lib/teams/library.ts` — Team Library list + search (reuses `scoreTeams`).
- `src/lib/teams/teamDetail.ts` — team detail view assembly.
- `app/api/runs/[runId]/retry/route.ts` — thin retry route.
- `app/runs/page.tsx`, `app/teams/page.tsx`, `app/teams/[teamId]/page.tsx` — new pages.
- `src/components/runs/{RunFilterBar,RetryRunButton}.tsx`.
- `src/components/teams/{TeamCard,SnapshotPreview,RevisionHistory,LinkedRuns}.tsx`.

### Modified files (minimal)

- `app/page.tsx` — uses shared `resumeTarget`, adds Team Library / Runs entry cards + "View all runs".
- `app/runs/[runId]/feedback/page.tsx` — loads latest `FeedbackBatch` + feedback-driven `TeamRevision`, passes revisit state.
- `src/components/feedback/FeedbackForm.tsx` — `existing`/`teamId` props + already-submitted summary view (append-only resubmit preserved).
- `src/components/run/RunStream.tsx` — retry panel for `recoveryAction === 'retry'` failures (coexists with the model-edit panel).
- `src/components/navigation/AppNav.tsx` — `/runs` + `/teams` links, badge → Phase 6.
- `apps/web/package.json` — registered the 3 new pure-module tests.

### Verification

- `corepack pnpm --filter web typecheck` — PASS.
- `corepack pnpm --filter web test` — PASS, 119 / 119 after adding `src/lib/teams/library.test.ts`.
- `apps/web/node_modules/.bin/next.cmd build` — PASS, 26 routes (4 new).
- `apps/web/node_modules/.bin/prisma.cmd migrate status` — PASS, 3 migrations, schema clean (no migration added).
- Browser manual smoke — PASS for `/runs` status/search filters, `/teams` library, `/teams/[teamId]` active snapshot + revision diff + linked run, and `/runs/{runId}/feedback` revisit state. Failed Lead timeout/provider failures correctly show the model-edit recovery panel. Clone-new-run retry was not exercised because the local DB had no failed run with an existing execution plan.

### Phase 6 Smoke Correction (2026-05-24)

- Issue found: `/teams?q=...` updated the URL and ranking but still showed every active team even for a query with no matches.
- Fix: `apps/web/src/lib/teams/library.ts` now filters by name, description, domain, and tags before applying the existing `scoreTeams` ranking. Empty queries still return all teams.
- Test: `apps/web/src/lib/teams/library.test.ts` covers name/description/domain/tag matches, multi-token AND behavior, and empty-query pass-through.
- Browser re-check: `/teams?q=zzzz-no-match-token` shows `0 teams` + "No teams match this search."; `/teams?q=EduGrowth` shows `1 teams`.

### Deferred (Phase 7+)

- Revision rollback, resume-from-failed-task, embedding recall, AgentRating dashboards, project management UI, team archive/delete and direct (non-revision) team editing.

## Phase 7 — Run Control & Provider Stability (2026-05-25)

Status: Implemented and verified locally. Branch `phase-7-run-control`. Plan: `PHASE7_PLAN.md`.

### Approved scope (decisions)

1. Cancel representation: `Run.status='failed'` + `failedReason='user_cancelled'` (so the existing retry / recovery / terminal checks need no changes); a `run.cancelled` RunEvent preserves the audit trail and `endedAt` is the cancel time. The UI distinguishes it via `failureClass` category `cancelled` (neutral copy, not red).
2. On cancel, running + pending tasks → `status='cancelled'` (error `user_cancelled`, completedAt now); done/failed tasks preserved. `DagGraph` gained a `cancelled` style.
3. Cancel mechanism: per-run `AbortController` registry in `runRegistry`; `/start` registers + passes the signal, `/cancel` aborts it, and `cancel.ts` is the single writer of the cancelled terminal state. The executor's `signal.aborted` guards stop it without overwriting `user_cancelled` with `task_failed:*` / `lead_plan_aborted`.
4. Shared error modules under `lib/agents/` (`providerError.ts` classifier + `poErrorResponse.ts` route mapper). Error classes stay in `po.ts` (re-used, not moved).
5. resume-from-failed-task deferred to Phase 8; strict-repair stays one attempt; rate_limit auto-backoff not introduced (classify + surface only).

### Scope adjustment (reported during implementation)

- The plan listed 4 routes for `mapPoError` consolidation. Only 3 share an identical contract (`qa/[sessionId]/next`, `qa/[sessionId]/answer`, `teams/recommend`) and now use the shared `poErrorPayload`. The revision route was intentionally left on its own mapper because it has a different contract (e.g. aborted → 408, provider auth → 502) plus revision-specific errors; it received only additive `rate_limit` / `model_not_found` cases so its public contract is unchanged.

### New files

- `src/lib/agents/providerError.ts` (+ test) — pure classifier: `extractProviderErrorStatus`, `looksLikeRateLimit/ModelNotFound/SchemaError`, `classifyGenerateError` (abort/timeout/auth/rate_limit/model_not_found/schema/provider_unavailable).
- `src/lib/agents/poErrorResponse.ts` (+ test) — `poErrorPayload` (pure) + `poErrorResponse` (standard `Response`); shared route mapping for the 3 generation routes.
- `src/lib/runs/cancelState.ts` (+ test) — pure cancel policy (`canCancel`, `cancelTransition`).
- `src/lib/runs/cancel.ts` — Prisma + registry wiring: guard → abort → terminal write → task cancel → `run.cancelled` event.
- `app/api/runs/[runId]/cancel/route.ts` — thin cancel route.
- `src/components/run/CancelRunButton.tsx` — two-step confirm cancel (client).
- `src/components/run/RunProgressOverlay.tsx` — extracted from `RunStream` + elapsed time, last-event age, transport, provider hint, in-overlay Cancel.

### Modified files

- `src/lib/agents/po.ts` — added `RateLimitError` / `ModelNotFoundError` classes + `raiseProviderError` (single throw-mapper); `callGenerate` catch simplified.
- `src/lib/agents/{lead,team,leadRevise,worker}.ts` — replaced duplicated catch + helpers with `raiseProviderError`. The worker now distinguishes timeout/schema/abort/rate_limit/model_not_found/auth instead of collapsing everything to provider_unavailable.
- `src/lib/dag/executor.ts` — `mapPlanErrorReason` adds `lead_plan_rate_limit:*` / `lead_plan_model_not_found:*`; `signal.aborted` guards at plan catch, post-plan, pre-running, loop-top, task catch, and pre-succeeded so cancel is never overwritten.
- `src/lib/dag/runRegistry.ts` — added `registerRunController` / `getRunController` / `abortRun` / `clearRunController`.
- `src/lib/runs/failureClass.ts` — added `cancelled` (user_cancelled), `rate_limit`, `model_not_found` categories + copy.
- `app/api/runs/[runId]/start/route.ts` — register/clear AbortController + pass signal to `executeRun`.
- `app/api/qa/[sessionId]/{next,answer}/route.ts`, `app/api/teams/recommend/route.ts` — local `mapPoError` → shared `poErrorPayload`.
- `app/api/runs/[runId]/revision/route.ts` — additive `rate_limit` / `model_not_found` cases (own mapper preserved).
- `app/api/runs/[runId]/team-models/route.ts` — `canResetFailedRun` also covers `lead_plan_model_not_found:*`.
- `src/components/run/RunStream.tsx` — uses extracted overlay; handles `run.cancelled` (event + reducer); cancel wiring; `model_not_found` recovery panel/copy.
- `src/components/run/DagGraph.tsx` — `cancelled` task style.
- `app/runs/[runId]/page.tsx` — passes `startedAt` to `RunStream`.
- `apps/web/package.json` — registered `providerError.test.ts`, `poErrorResponse.test.ts`, `cancelState.test.ts`.

### Verification

- `corepack pnpm --filter web typecheck` — PASS.
- `corepack pnpm --filter web test` — PASS, 134 / 134.
- `next build` — PASS, 27 routes (1 new: `/api/runs/[runId]/cancel`).
- `prisma migrate status` — PASS, 3 migrations, schema clean (no migration added).
- Live smoke against the dev server (no provider cost): `POST /api/runs/<bad>/cancel` → 404 `run_not_found`; `POST /api/runs/<succeeded>/cancel` → 409 `run_not_cancellable`; `/runs`, `/teams`, and run detail (succeeded + failed) pages → 200 (Phase 6 + RunStream refactor no-regression).

- Interactive browser smoke (Ollama-backed ready run): model-recovery panel reset a failed Lead-planning run to `ready`; Start showed the Phase 7 progress overlay with elapsed time, transport, last-event age, local-provider hint, and Cancel; Confirm cancel wrote `Run.status='failed'`, `failedReason='user_cancelled'`, `endedAt`, and a `run.cancelled` event; Retry reset the no-plan cancelled run back to `ready`. A smoke correction reloads the run detail after Start / Cancel / Retry / model-reset so the server-rendered sticky header and client panel stay in sync.

### Pending (manual, interactive)

- Provider-backed smoke: start a real run, Cancel during planning/running → `failed(user_cancelled)` + `run.cancelled` + tasks `cancelled` + neutral copy; retry a cancelled run (reset vs clone); provider auth → Settings hint; Ollama timeout copy; Gemini schema_error after one repair; rate_limit / model_not_found panels.

### Deferred (Phase 8+)

- resume-from-failed-task, rate_limit auto-backoff, concurrency > 1 / worker extraction.

## Compose Already-Team Revisit Correction (2026-05-24)

Status: Implemented.

### Context

- After the Q&A duplicate `/next` race was corrected, reloading a completed Q&A session with an already confirmed team correctly reached `/runs/new/{sessionId}/compose`.
- The compose page still mounted `<TeamComposer>`, which immediately called `/api/teams/recommend`.
- The recommend endpoint intentionally returns `409 run_already_has_team` for a run that already has `teamId`, so the UI showed this as a red error even though the saved state was valid.

### Fix

- `apps/web/app/runs/new/[sessionId]/compose/page.tsx` now fetches `Run.teamId` and `team.name`.
- If a team is already linked, the server component renders an `AlreadyComposedPanel` with Run ID, Team ID, team name, `Open run ->`, and `Back to home`.
- In this branch the page does not mount `<TeamComposer>` and does not call the recommendation endpoint, so `run_already_has_team` is no longer displayed as a user-facing error on a successful revisit.

### Verification

- `corepack pnpm --filter web typecheck` — PASS.
- `corepack pnpm --filter web test` — PASS, 92 / 92.
- `apps/web/node_modules/.bin/next.cmd build` — PASS, 19 routes.
- `apps/web/node_modules/.bin/prisma.cmd migrate status` — PASS, 3 migrations, schema clean.
- Browser reload smoke — PASS: `http://localhost:3000/runs/new/cmpj5ur08003yshgqwqruzeor/compose` shows "Team already composed" + "Open run" and no longer shows `run_already_has_team` / recommendation error copy.

## Compose-to-Run Start Shortcut (2026-05-24)

Status: Implemented.

### Context

- After team confirmation, the success panel linked to `/runs/{runId}`.
- The user then had to click `Start run` on the run detail page, creating an unnecessary second step before execution actually began.

### Fix

- Added reusable client component `apps/web/src/components/run/StartRunButton.tsx`.
- The button calls `POST /api/runs/{runId}/start`; on success it navigates to `/runs/{runId}` where the progress UI takes over.
- `TeamComposer` success panels now show `Start run ->` instead of `Open run`.
- The compose revisit success panel also shows `Start run ->` when `Run.status === 'ready'`; for non-ready runs it still shows `Open run ->`.

### Verification

- `corepack pnpm --filter web typecheck` — PASS.
- `corepack pnpm --filter web test` — PASS, 92 / 92.
- `apps/web/node_modules/.bin/next.cmd build` — PASS, 19 routes.
- `apps/web/node_modules/.bin/prisma.cmd migrate status` — PASS, 3 migrations, schema clean.
- Browser render smoke — PASS: a ready compose revisit page shows `Team already composed` + `Start run` and no longer shows `Open run` or recommendation error copy. The button was not clicked during verification to avoid launching a real provider-backed run.

## Lead Planning Schema/Timeout Recovery (2026-05-24)

Status: Implemented.

### Context

- Manual run start reached `failed(lead_plan_schema_error)` in one run and `failed(lead_plan_timeout:120000ms)` in another.
- `lead_plan_schema_error` means the Lead model responded during DAG planning, but the response did not match the required structured execution-plan schema.
- `lead_plan_timeout:*` means the Lead model did not return an execution plan before the provider-specific timeout.
- The UI showed only the internal failure code and did not offer a recovery path.

### Fix

- `apps/web/src/lib/agents/lead.prompt.ts` now supports strict repair mode for execution-plan generation.
- `apps/web/src/lib/agents/lead.ts` retries Lead planning once with strict repair instructions after `PoSchemaError`.
- `apps/web/app/api/runs/[runId]/team-models/route.ts` treats `lead_plan_schema_error` and `lead_plan_timeout:*` as recoverable; saving team models resets the Run to `ready`.
- `apps/web/src/components/run/RunStream.tsx` includes both failure modes in the recoverable model-failure panel and shows friendly copy explaining whether the Lead planning model produced malformed DAG output or timed out.

### Verification

- `corepack pnpm --filter web typecheck` — PASS.
- `corepack pnpm --filter web test` — PASS, 92 / 92.
- `apps/web/node_modules/.bin/next.cmd build` — PASS, 19 routes.
- `apps/web/node_modules/.bin/prisma.cmd migrate status` — PASS, 3 migrations, schema clean.
- Browser smoke — PASS: `/runs/cmotlzjrt0002hnnkfzg57c49` now shows `Lead planning took too long`, model selectors, and `Save models and retry` for `lead_plan_timeout:*`. The same recovery branch covers `lead_plan_schema_error`.

## Run Progress Live-State Reconciliation (2026-05-24)

Status: Implemented.

### Context

- A Run could complete successfully in the DB, but the UI stayed on the planning overlay until manual refresh.
- In the observed case, the page transport stayed at `connecting...`; because the EventSource neither opened nor errored promptly, the existing polling fallback never started.
- Refreshing the page loaded the saved `succeeded` state and final result, confirming this was a client live-sync problem rather than an executor failure.

### Fix

- `<RunStream>` now starts polling automatically if EventSource remains unopened for 4 seconds.
- When SSE does open, `<RunStream>` still performs a 5-second DB reconciliation poll while the run is non-terminal.
- Reconciliation updates run status, tasks, events, and `finalResult`; terminal status closes the live stream.
- This keeps the UI moving to the Final Result panel without requiring a manual refresh, even if SSE is buffered or silently stuck by the dev server/browser path.

### Verification

- `corepack pnpm --filter web typecheck` — PASS.
- `corepack pnpm --filter web test` — PASS, 92 / 92.
- `apps/web/node_modules/.bin/next.cmd build` — PASS, 19 routes.
- `apps/web/node_modules/.bin/prisma.cmd migrate status` — PASS, 3 migrations, schema clean.
- Browser reload smoke — PASS: `/runs/cmpjamhap007pshgq0hkeo9lk` shows `succeeded` + `Final result` and no longer shows the planning overlay or `connecting...`.

## Provider Update — Gemini (2026-05-22)

Status: Implemented and verified locally.

### Scope

- Added Google Generative AI provider support through `@ai-sdk/google`.
- Added `GOOGLE_GENERATIVE_AI_API_KEY` to the secret allowlist, Settings UI, and `.env.example`.
- Added `google` to provider resolution, runtime model building, PO Q&A, Team Composition, Lead planning, Worker task execution, and the two-stage provider/model selectors.
- Added requested Gemini catalog rows to `models.json`:
  - `gemini-3.1-flash-lite`
  - `gemini-3.5-flash`
  - `gemini-3.1-pro-preview`
  - `gemini-2.5-flash`
  - `gemini-2.5-flash-lite`
- Ran Prisma seed after updating `models.json`; local catalog now reports 14 model rows, with exactly the 5 requested Google models enabled in the Google provider set.
- Kept schema unchanged. No migration.

### Notes

- Initial install of `@ai-sdk/google` latest produced `LanguageModelV3` types, incompatible with the app's current `ai@4` / `LanguageModelV1` runtime. Resolved by pinning compatible `@ai-sdk/google@^1.2.22`.
- Team Composition schema-error copy is now provider-neutral: "selected model" instead of "local model".
- Official reference points:
  - Google Gemini API models page and linked model detail pages list `gemini-3.1-flash-lite`, `gemini-3.5-flash`, `gemini-3.1-pro-preview`, `gemini-2.5-flash`, and `gemini-2.5-flash-lite`.
  - AI SDK Google provider page: `@ai-sdk/google`, `createGoogleGenerativeAI`, `GOOGLE_GENERATIVE_AI_API_KEY`, and `google('gemini-2.5-flash')` usage are documented.

### Verification

- `corepack pnpm --filter web typecheck` — PASS.
- `corepack pnpm --filter web test` — PASS, 89 / 89.
- `corepack pnpm --filter web exec next build` — PASS, 18 routes.
- `corepack pnpm --filter web exec prisma migrate status` — PASS, 3 migrations, schema clean.
- `corepack pnpm --filter web exec prisma db seed` — PASS, then stale Google catalog row `gemini-2.5-pro` was removed from the local DB.

## Gemini PO Q&A Schema Repair (2026-05-23)

Status: Implemented and verified locally.

### Context

- Manual smoke with `gemini-3.5-flash` reached PO Q&A question 2, then `/api/qa/[sessionId]/next` surfaced `po_schema_error` as "The model returned a malformed response."
- Team Composition already had a strict repair retry after `PoSchemaError`, but PO Q&A next-question generation and auto-judge did not.

### Fix

- Added strict repair suffixes to PO next-question and auto-judge prompts.
- `generateNextQuestion()` now retries once with strict repair guidance when the first structured response fails schema validation.
- `judgeAnswer()` now uses the same one-time strict repair retry.
- Tightened `nextQuestionSchema.kind` to `z.literal('single')` to match the actual MVP UI contract.

### Verification

- `corepack pnpm --filter web typecheck` — PASS.
- `corepack pnpm --filter web test` — PASS, 89 / 89.
- `corepack pnpm --filter web exec next build` — PASS, 18 routes.

## PO Q&A Loading UX and Reload Removal (2026-05-23)

Status: Implemented and verified locally.

### Context

- During manual Gemini Q&A smoke, next-question generation felt slow and the page looked static while waiting.
- The client also called `location.reload()` after `/api/qa/[sessionId]/next`, adding avoidable page reload time after the model had already produced the question.

### Fix

- `/api/qa/[sessionId]/next` now returns the full updated `SessionView` alongside the generated/regenerated question.
- `<QaFlow>` consumes that returned session directly, removing the full page reload on normal next-question and regenerate paths.
- Added a loading overlay while Q&A interactions are locked:
  - background content blurs and fades,
  - overlay shows the current operation,
  - step chips show answer-save / model-call / structured-validation progress,
  - Google and Ollama get provider-specific detail copy.

### Verification

- `corepack pnpm --filter web typecheck` — PASS.
- `corepack pnpm --filter web test` — PASS, 89 / 89.
- `corepack pnpm --filter web exec next build` — PASS, 18 routes.

## PO Q&A Multi-Select Answers (2026-05-23)

Status: Implemented and verified locally.

### Scope

- Q&A substantive options 1..4 can now be selected in any combination and submitted together.
- AI auto-judge (option 5) and custom answer (option 6) remain single-use alternatives.
- No schema migration: multi-select answers store `QaAnswer.choiceIndex = null` and persist the selected option set inside the existing JSON `value` column as `{ selectedValues: [...] }`.
- Timeline and PO history formatting now render multi-select answers as `(multiple) 1. ...; 3. ...`.

### Verification

- `corepack pnpm --filter web typecheck` — PASS.
- `corepack pnpm --filter web test` — PASS, 92 / 92.
- `corepack pnpm --filter web exec next build` — PASS, 18 routes.

## Run/Q&A Interaction Polish (2026-05-23)

Status: Implemented and verified locally.

### Context

- Manual Q&A smoke showed that selected multi-choice rows were shaded, but the left-side selection control itself did not visibly change.
- On `/runs/[runId]`, clicking `Start run` moved the Run to `planning`, but the screen still looked static while the Lead generated the DAG. This made it unclear whether the app was working or stuck.

### Fix

- `<QuestionCard>` now renders a filled left checkbox and a highlighted option number for selected multi-choice answers. The right-side marker was removed so the selection signal sits where users look first.
- `<RunStream>` now shows a blur-backed progress popup while the run is starting or in `planning`:
  - background content fades and blurs,
  - popup explains whether the app is starting the worker or the Lead is building the DAG,
  - step list shows `Start run -> Lead plans DAG -> Validate tasks -> Begin execution`,
  - the popup disappears automatically once `plan.created` moves the UI into `running`.

### Verification

- `corepack pnpm --filter web typecheck` -- PASS.
- `corepack pnpm --filter web test` -- PASS, 92 / 92.
- `corepack pnpm --filter web exec next build` -- PASS, 18 routes.
- `corepack pnpm --filter web exec prisma migrate status` -- PASS, 3 migrations, schema clean.

## Run Recovery and Navigation Polish (2026-05-23)

Status: Implemented and verified locally.

### Context

- Manual Phase 4 smoke hit `failed(lead_plan_provider_unavailable:anthropic)` because the confirmed Team still used Anthropic models, but Anthropic was not configured.
- The app did not yet provide a way to see previous work items, their current stage, or a direct resume target.
- Long project pages lacked a sticky context area showing the run topic and original prompt while scrolling.

### Fix

- Added `PATCH /api/runs/[runId]/team-models`:
  - validates every selected model against enabled `ModelCatalog` rows,
  - updates the linked Team's Agent `modelId` and provider,
  - resets recoverable Lead-provider failures back to `Run.status='ready'` so the user can start again.
- `<RunStream>` now shows an inline "Team model configuration needed" panel for recoverable Lead provider/auth/unknown-provider failures.
  - All Team agents can be switched with Provider + Model selectors.
  - Saving model changes returns the Run to the ready state when the failure is recoverable.
- Home (`/`) now lists recent project runs with:
  - current stage (`Q&A`, `Team composition`, `Ready to start`, `Team working`, `Needs attention`, etc.),
  - team name when attached,
  - original prompt,
  - direct Continue link to the right page.
- Added a reusable sticky `<RunContextHeader>` to Q&A, Team Compose, and Run Detail pages:
  - expanded state shows Run title, status/team, and prompt,
  - collapsed state keeps a compact title/status while scrolling.

### Verification

- `corepack pnpm --filter web typecheck` -- PASS.
- `corepack pnpm --filter web test` -- PASS, 92 / 92.
- `corepack pnpm --filter web exec next build` -- PASS, 19 routes.
- `corepack pnpm --filter web exec prisma migrate status` -- PASS, 3 migrations, schema clean.
- Browser smoke:
  - `/runs/cmphu0wvf001dq1pef9tjag80` shows the recoverable provider failure panel with editable Team model selectors.
  - `/` shows existing project runs and resume links.

## Phase 4 SSE Custom-Event Correction (2026-05-23)

Status: Implemented and verified locally.

### Context

- Manual smoke on `/runs/cmpi0epmr003pq1pe8m4ewamx` appeared stuck for hours at "Lead is building the DAG".
- Direct DB inspection showed the Run had actually completed in about 20 seconds with `Run.status='succeeded'`, 4 `Task.status='done'` rows, and a `run.completed` event.
- Root cause: `/api/runs/[runId]/events` emits named SSE frames (`event: plan.created`, `event: run.completed`, etc.), but `<RunStream>` only subscribed to the default `EventSource.onmessage`. Native EventSource does not deliver named events to `onmessage`.

### Fix

- `<RunStream>` now registers listeners for every Phase 4 event type:
  - `run.started`
  - `plan.created`
  - `task.started`
  - `agent.output.delta`
  - `agent.output.completed`
  - `task.completed`
  - `task.failed`
  - `run.completed`
- All named events share the same parser/reducer path as default `message` events, preserving `lastEventId` for reconnect/polling continuity.
- No schema change, migration, dependency change, or API contract change.

### Verification

- `corepack pnpm --filter web typecheck` -- PASS.
- `corepack pnpm --filter web test` -- PASS, 92 / 92.
- `corepack pnpm --filter web exec next build` -- PASS, 19 routes.
- `corepack pnpm --filter web exec prisma migrate status` -- PASS, 3 migrations, schema clean.
- Browser smoke: reloaded `/runs/cmpi0epmr003pq1pe8m4ewamx`; the planning overlay is gone and the page shows `Status: succeeded`, 4 completed DAG tasks, and closed transport.

## Final Result Output (2026-05-24)

Status: Implemented locally; verification below.

### Context

- The Run detail page showed each Agent/Task output, but did not provide a single final deliverable for the user.
- Some plans include a final compilation task, but this was not guaranteed by the platform contract and no `result.md` artifact was written.

### Fix

- Added `apps/web/src/lib/results/finalResult.ts`:
  - builds a deterministic final Markdown document from completed task outputs,
  - prefers an explicit final/compile/synthesis/documentation task when present,
  - still includes all supporting Agent outputs below the final section,
  - exports `projects/{projectSlug}/runs/{runId}/result.md` atomically.
- The executor now writes `result.md`, creates an `Artifact(kind='result_md')`, and emits `result.created` before `run.completed` on successful Runs.
- `/runs/[runId]` and the polling state endpoint load the final result content.
- `<RunStream>` renders a `Final result` panel above the DAG/Agent output area and fetches the final result when `result.created` / `run.completed` arrives.
- Older completed Runs without `result.md` get a deterministic fallback generated from their saved `Task.result` rows, so existing smoke-test Runs still show a final result after reload.

### Verification

- `corepack pnpm --filter web typecheck` -- PASS.
- `corepack pnpm --filter web test` -- PASS, 92 / 92.
- `corepack pnpm --filter web exec next build` -- PASS, 19 routes.
- `corepack pnpm --filter web exec prisma migrate status` -- PASS, 3 migrations, schema clean.
- Browser smoke: reloaded `/runs/cmpj58uce0002shgqjv43dytj`; the page shows `FINAL RESULT`, `Supporting Agent Outputs`, and `succeeded`.

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

Status: Completed (2026-05-06) + correction pass applied (2026-05-06)

### Phase 2 Correction Pass (2026-05-06)

A review surfaced two correctness gaps, one missing test file, and one UI gap. All fixed before commit. No schema change, no new dependencies, no migration.

**Issues fixed**

1. **`isEdit` underflagged re-answers.** Old check `view.questions.some(q => q.order > question.order && q.answer != null)` only fired when downstream questions had answers. New check fires whenever the current question already has an answer AND any downstream question exists (answered or not) — so re-answering Q3 also stales an unanswered Q4/Q5 that the next/regenerate path would otherwise leave intact.
2. **`/api/qa/[sessionId]/next` could create a new question while stale ones were pending.** Added an early `findLowestStaleOrder(view)` check: if stale questions exist and the request omitted `regenerateOrder`, the route now returns `409 { error: 'stale_questions_pending', lowestStaleOrder }`. Prevents creating Q6 while Q3..Q5 are stale.
3. **`sessionState.test.ts` was missing** from the Phase 2 plan and never landed. Now in place with 19 cases covering the gate (`isCurrentAnswer`), current-question derivation, stale detection, lowest-stale lookup, and the auto-complete rule.
4. **`<QaFlow>` only had a generic error display for the new 409.** Added an inline amber notice — "Regenerate stale questions before continuing" — and gated the active question card so the user is steered to the Timeline's Regenerate buttons instead of being shown the stale question's old content.

**Files touched**

- `apps/web/src/lib/qa/sessionState.ts` — extracted pure helpers `isCurrentAnswer`, `deriveCurrentQuestion`, `findStaleQuestions`, `findLowestStaleOrder`. Refactored `loadSession` to use them; semantics unchanged.
- `apps/web/app/api/qa/[sessionId]/next/route.ts` — added the stale-pending 409 gate ahead of the idempotency branch; imports `findLowestStaleOrder`.
- `apps/web/app/api/qa/[sessionId]/answer/route.ts` — replaced the `isEdit` predicate. Stale propagation block stays inside the same `prisma.$transaction`.
- `apps/web/src/components/qa/QaFlow.tsx` — added inline "Regenerate stale questions before continuing" amber notice; suppressed active question card while stale pending; treated 409 `stale_questions_pending` from `requestNext` distinctly from generic errors.
- `apps/web/src/lib/qa/sessionState.test.ts` — new file, 19 unit tests via `node:test`.
- `apps/web/package.json` — `test` script appended `src/lib/qa/sessionState.test.ts`.

**Verification commands run**

```powershell
pnpm --filter web typecheck
pnpm --filter web test
pnpm --filter web exec next build
pnpm --filter web exec prisma migrate status
```

**Verification results**

- `pnpm --filter web typecheck` — zero errors.
- `pnpm --filter web test` — 53 / 53 pass (19 new sessionState + 8 skipPolicy + 8 redactor + 12 paths + 6 policy).
- `pnpm --filter web exec next build` — clean Turbopack build, same 11 routes (no schema or route additions).
- `pnpm --filter web exec prisma migrate status` — clean (3 migrations, schema in sync).

**Decisions during the correction pass**

- The stale-pending 409 returns `{ error: 'stale_questions_pending', lowestStaleOrder }` (number) rather than the lowest stale question payload. The client doesn't need the body to drive Regenerate — Timeline already shows all stale rows with their Regenerate buttons. Returning just the order keeps the response shape minimal.
- The `isEdit` change deliberately stales downstream questions even when none have answers yet. Rationale: a generated-but-unanswered Q6 reflects context from the answer the user is now editing; the next-question generation should re-derive it, so the row must be marked stale and regenerated like any other downstream question.
- The QaFlow change suppresses the active card while stale pending so the user isn't tempted to re-answer the stale question's old content. The Timeline's Regenerate buttons remain the only forward path.

**Remaining items / corrections still owed**

- Manual smoke (clicking through `/runs/new`) was not run during the correction pass. The semantic changes are covered by unit tests; the UI tweak is a single-component edit that builds clean. Recommended path: `pnpm --filter web dev`, complete a session, edit Q3, observe Q4..Q6 marked stale and the inline amber notice + Regenerate buttons in Timeline.
- No schema changes; no migration; no dependency change.



### Approved Scope

- `/runs/new` prompt intake with PO model picker.
- Dynamic PO question generation (4 substantive choices + server-injected positions 5/6).
- QuestionCard, Timeline, QaFlow client orchestrator (`useReducer`).
- Answer edit and stale propagation (atomic Prisma transaction).
- Stale regeneration (in-place update, `regeneratedAt` set, prior answers preserved but UI-gated).
- QaSession persistence and auto-completion at `(order >= 5 && isFinal) || order === 6`.

### Phase 2 Pre-Implementation Checklist

- [x] Phase 2 plan reviewed, refined remotely via Ultraplan, and approved with eight required adjustments.
- [x] Implementation completed.
- [x] Verification passed (typecheck, tests, build, migrate status).
- [x] Log updated.
- [ ] Commit pushed. (User to commit and push.)

### Verification Targets

- New Run creates Run + QaSession via Default Project lookup: ✅ `/api/runs` POST, transactional create, `Run.status='po_qa'`, `Run.poModelId` set.
- Six-question flow with options 1–6 + skip: ✅ `QuestionCard` covers 1–4, 5 (auto-judge), 6 (custom), Skip → 5 via `coerceSkipToAutoJudge`.
- AI auto-judge stores `isAutoJudged=true` with `{chosenValue, rationale}`: ✅ enforced server-side in `/api/qa/[sessionId]/answer`.
- Editing earlier answer marks later questions stale: ✅ `prisma.$transaction` in answer route flips `status='stale'`, sets `staleAt`.
- Stale regenerate replaces prompt/options in place; prior answers gated by `updatedAt >= regeneratedAt`: ✅ `sessionState.loadSession` applies the gate.
- Idempotent `/api/qa/[sessionId]/next`: ✅ returns existing active unanswered question instead of creating a duplicate order.
- Disabled-model rejection on `POST /api/runs`: ✅ `getEnabledModelOrThrow` + `ModelDisabledError` → 400.
- No unsafe provider casts: ✅ `resolveProviderName` uses the existing guard; unknown providers throw `UnknownProviderError` (mapped to 500).
- Provider-availability invalidation on secret save/delete: ✅ POST/DELETE `/api/secrets` call `invalidateProviderAvailability(provider)`.

### Phase 2 Verification Commands

```powershell
pnpm install                                                                      # no new deps
pnpm --filter web exec prisma migrate dev --name phase2_qa_session_run_model_and_question_regen
pnpm --filter web typecheck
pnpm --filter web test                                                            # 26 prior + 8 new skipPolicy = 34 pass
pnpm --filter web exec next build                                                 # bypasses prisma generate (stale workers in shared session lock the DLL)
pnpm --filter web exec prisma migrate status
```

### Phase 2 Created or Modified Files

`apps/web/prisma/`:

- `apps/web/prisma/schema.prisma` — added `Run.poModelId`, `QaQuestion.regeneratedAt`, `QaQuestion.isFinal`, `QaAnswer.updatedAt @updatedAt`.
- `apps/web/prisma/migrations/20260506025357_phase2_qa_session_run_model_and_question_regen/migration.sql` — committed.

`apps/web/src/lib/models/`:

- `apps/web/src/lib/models/catalog.ts` — added `getEnabledModelOrThrow`, `ModelDisabledError`, `resolveProviderName`, `UnknownProviderError`, `invalidateProviderAvailability`.

`apps/web/src/lib/qa/`:

- `apps/web/src/lib/qa/skipPolicy.ts` — choice-1..6 semantics, `coerceSkipToAutoJudge`, `valueForChoice`, `isAnswerable`.
- `apps/web/src/lib/qa/sessionState.ts` — typed loader (`loadSession`), `shouldAutoComplete`, `buildHistoryLines`, `QA_LIMITS`.
- `apps/web/src/lib/qa/timeout.ts` — `runWithGenerateTimeout` (30s, `AbortSignal.any`), `GenerateAbortedError`, `GenerateTimeoutError`.
- `apps/web/src/lib/qa/skipPolicy.test.ts` — 8 unit tests.

`apps/web/src/lib/agents/`:

- `apps/web/src/lib/agents/po.prompt.ts` — Zod schemas (`nextQuestionSchema`, `judgeSchema`) plus prompt builders.
- `apps/web/src/lib/agents/po.ts` — `generateNextQuestion`, `judgeAnswer`. Wraps runtime via `runWithGenerateTimeout`. Emits `ProviderUnavailableError` / `PoSchemaError` / `PoAuthError`. Calls `invalidateProviderAvailability` on auth or unknown failures.

`apps/web/app/api/`:

- `apps/web/app/api/runs/route.ts` — `POST`. Validates prompt + modelId, enforces `getEnabledModelOrThrow`, looks up Default Project, creates Run + QaSession in a transaction.
- `apps/web/app/api/qa/[sessionId]/next/route.ts` — `POST`. Idempotent: returns existing active unanswered question if present. Otherwise generates next question (or regenerates a specific stale question via `{regenerateOrder}`).
- `apps/web/app/api/qa/[sessionId]/answer/route.ts` — `POST`. Upserts answer; on auto-judge calls `judgeAnswer`; on edit propagates stale via `prisma.$transaction`; auto-completes when rule satisfied.
- `apps/web/app/api/secrets/route.ts` — invalidates provider availability after successful set.
- `apps/web/app/api/secrets/[name]/route.ts` — invalidates provider availability after delete.

`apps/web/app/runs/`:

- `apps/web/app/runs/new/page.tsx` — server component. Lists enabled models, mounts `<NewRunForm>`.
- `apps/web/app/runs/new/[sessionId]/page.tsx` — server component. SSR via `loadSession`, mounts `<QaFlow>`.

`apps/web/src/components/`:

- `apps/web/src/components/runs/NewRunForm.tsx` — client island; POSTs `/api/runs`, navigates to session page.
- `apps/web/src/components/qa/QuestionCard.tsx` — six options + skip.
- `apps/web/src/components/qa/Timeline.tsx` — collapsible history with stale + regenerate CTAs and edit-answer buttons. Surfaces auto-judge rationale.
- `apps/web/src/components/qa/QaFlow.tsx` — `useReducer` orchestrator; talks only to `/api/qa/...` (idempotent next + answer).

`apps/web/app/`:

- `apps/web/app/layout.tsx` — status pill bumped `Phase 1` → `Phase 2`.
- `apps/web/app/page.tsx` — home description and CTA updated to point at `/runs/new`.

`apps/web/`:

- `apps/web/package.json` — `test` script appended `src/lib/qa/skipPolicy.test.ts`.

### Phase 2 Verification Results (2026-05-06)

- `prisma migrate dev --name phase2_qa_session_run_model_and_question_regen` — succeeded. Third migration committed.
- `prisma migrate status` — clean (3 migrations applied).
- `pnpm --filter web typecheck` — zero errors after fixing three TS issues during the run: PoSchemaError `cause` collision with built-in `Error.cause` (renamed to `schemaCause`), `nextQuestionSchema.kind` default conflict with generic `ZodType<T>` (default removed), and `noUncheckedIndexedAccess` issue in `runWithGenerateTimeout` (rewrote signal composition to avoid array indexing).
- `pnpm --filter web test` — 34 / 34 pass (8 skipPolicy + 12 paths + 8 redactor + 6 policy).
- `pnpm --filter web exec next build` — clean Turbopack build. 11 routes total. (Used `exec next build` to skip `prisma generate` because stale Node workers from earlier sessions hold a Windows file lock on `query_engine-windows.dll.node`. Schema unchanged since the last successful generate — equivalent for verification purposes.)

### Phase 2 Decisions

- **`QaAnswer.updatedAt @updatedAt`** instead of `answeredAt`. Prisma manages the timestamp on every `update()` and on initial insert via `now()` defaulting. The current-answer gate in `sessionState.loadSession` is `answer.updatedAt.getTime() >= question.regeneratedAt.getTime()` (with `regeneratedAt == null` ⇒ always current).
- **`Run.poModelId` (not `QaSession.poModelId`)** so Phase 3/4 can extend the Run with `leadModelId` etc. without re-migrating Phase 2 rows. Persisted as the canonical `ModelCatalog.modelId`; provider is looked up server-side every call.
- **`QaQuestion.isFinal`** added to schema (not just on the in-memory schema) so the auto-completion rule is evaluable from a fresh `loadSession` without consulting the original generation payload.
- **Idempotent next**. The route returns the existing active unanswered question instead of generating a new one when called twice in quick succession; this makes `useEffect`-driven calls and double-clicks safe.
- **Stale propagation keeps `QaAnswer` rows intact.** The `regeneratedAt` gate hides the orphaned answers from the UI without losing the audit trail. Re-answering upserts on the unique `[sessionId, questionId]` constraint.
- **Auto-completion rule** is the simpler MVP shape: `(order >= 5 && isFinal) || order === 6`, AND no stale questions outstanding. No "Continue / Finish" CTA in the UI.
- **Auto-judge rationale stored** in `QaAnswer.value` JSON as `{ chosenValue, rationale }`. Timeline surfaces the rationale beneath the answer.
- **Skip → option 5** mapped server-side in `coerceSkipToAutoJudge` so the client never has to know.
- **Provider safety**. `resolveProviderName` is the only path from `ModelCatalog.provider` to the runtime's `ProviderName` union. Unknown providers throw `UnknownProviderError` and the route returns HTTP 500 with `{error: 'unknown_provider'}` — never an unsafe cast.
- **Cache invalidation** on secret save/delete uses the new `invalidateProviderAvailability(provider)` export. The PO module also calls it on auth-shaped errors so the next probe is fresh.
- **Ollama path** is supported but untested in this session: the runtime / PO error mapping treats Ollama structured-output failures as either `po_schema_error` (502) or `provider_unavailable` (503) without crashing. The user's local Ollama can be used if no OpenAI/Anthropic keys are configured.
- **Test runner stays Windows-safe** — explicit file list, no glob expansion. `tsx --test src/lib/secrets/redactor.test.ts src/lib/workspace/paths.test.ts src/lib/tools/policy.test.ts src/lib/qa/skipPolicy.test.ts`.

### Phase 2 Deviations from `IMPLEMENTATION.md`

- `apps/web/src/lib/po/skipPolicy.ts` (per IMPLEMENTATION.md) → `apps/web/src/lib/qa/skipPolicy.ts`. Domain-folder consistency with Phase 1 (`secrets/`, `tools/`, `db/`). Agent-side logic stays at `apps/web/src/lib/agents/po.ts` and `apps/web/src/lib/agents/po.prompt.ts`.
- Added helpers `apps/web/src/lib/qa/sessionState.ts` and `apps/web/src/lib/qa/timeout.ts`, plus client orchestrator `apps/web/src/components/qa/QaFlow.tsx` and `apps/web/src/components/runs/NewRunForm.tsx`. None of these are listed in IMPLEMENTATION.md but are necessary to keep page files thin.
- Schema: added one extra field beyond the Phase 2 plan — `QaQuestion.isFinal` — so the auto-completion rule survives a session reload without re-deriving `isFinal` from the prompt round-trip. Same migration, no extra migration step.

### Phase 2 Remaining Risks

- **Manual smoke not yet executed in this session.** Build + types + tests are green; the live `/runs/new` flow with a real provider has not been clicked through. Recommended path: configure Ollama (no key required) or paste an Anthropic / OpenAI key into Settings, then walk Q1→Q6 + edit + regenerate.
- **`location.reload()` in `QaFlow`** is a pragmatic short-cut that re-fetches via the page's server-side `loadSession`. A future refactor can swap in a typed JSON GET for `/api/qa/[sessionId]` if the reload feels janky in practice.
- **Concurrent answer race.** Single-user MVP, no row-level locking. The `[sessionId, questionId]` unique constraint blocks duplicate answers; UI is disabled while in-flight. A double-click submits one row and the second 409s.
- **Auth-error detection** uses status-code probing + message regex. Some upstream errors don't expose `.status`; the regex on `\b401\b|unauthorized|\b403\b|forbidden` catches the common shapes but isn't exhaustive. False negatives degrade to `provider_unavailable` (503), which is still actionable.
- **PO schema strictness.** Smaller / weaker Ollama models may fail the Zod schema. The route returns 502 `po_schema_error` and the UI surfaces it; no auto-retry. Users may need to switch to a stronger model.
- **Process-restart recovery still deferred** to Phase 4 per the original deviation.

## Phase 3 — Team Composition

Status: Completed (2026-05-06)

### Approved Scope

- Team recall recommendations (keyword + tag + domain + history score; no embeddings).
- Team Architect proposal (5 agents, exactly 1 lead, server-resolved modelIds via `modelHint`).
- TeamComposer UI (edit roles / system prompts / models, single-select lead).
- Initial TeamRevision v1 with full snapshot.
- `AGENTS.md` and `team.json` export under `projects/{projectSlug}/teams/{teamId}/`.
- No DAG execution, no SSE, no Phase 5 feedback diff (kept scoped per user adjustment 10).

### Phase 3 Pre-Implementation Checklist

- [x] Phase 3 plan reviewed, refined remotely via Ultraplan, approved with ten required adjustments.
- [x] Implementation completed.
- [x] Verification passed (typecheck, tests, build, migrate status).
- [x] Log updated.
- [ ] Commit pushed. (User to commit and push.)

### Verification Targets

- Proposed team created with exactly 5 agents and 1 lead: ✅ Zod refinement + server validation in `/api/teams`.
- Agent model edit persists: ✅ `<TeamComposer>` updates the proposal, `POST /api/teams` re-validates the user-confirmed `modelId` via `getEnabledModelOrThrow`.
- Team files written under `projects/{projectSlug}/teams/{teamId}/`: ✅ `exportTeamFiles` via `safeJoin(workspaceRoot(), …)` with atomic temp+rename. Successes recorded as `Artifact` rows.
- TeamRevision v1 exists: ✅ created in the same `prisma.$transaction` as Team + Agents; `Team.currentRevisionId` linked.
- First run shows no recalled teams but shows proposed team: ✅ `recall(...)` returns `[]` for empty Project; UI shows "No recalled teams yet" notice.
- Idempotency: ✅ `/api/teams` returns 409 `run_already_has_team` if `Run.teamId` is already set.
- No `Team.runCount++` on selection: ✅ removed per adjustment 7. `runCount` is reserved for Phase 4/5 once Runs actually execute.
- No DB mutation in compose page GET: ✅ page only loads session and renders shell; client island calls `/api/teams/recommend`.

### Phase 3 Verification Commands

```powershell
pnpm install                                                                # no new deps
pnpm --filter web typecheck
pnpm --filter web test                                                      # 53 prior + 15 new (serialize + teamSearch) = 68
pnpm --filter web exec next build
pnpm --filter web exec prisma migrate status
```

### Phase 3 Created or Modified Files

`apps/web/src/lib/agents/`:

- `apps/web/src/lib/agents/team.prompt.ts` — Zod schemas (`teamProposalSchema`, agent schema with `modelHint` enum, tool allowlist refined against `lib/tools/policy.ALLOWED_TOOL_NAMES`).
- `apps/web/src/lib/agents/team.ts` — `proposeNewTeam`, `resolveModelHints`. Reuses Phase 2 error classes (`ProviderUnavailableError`, `PoSchemaError`, `PoAuthError`) and the `runWithGenerateTimeout` helper.

`apps/web/src/lib/search/`:

- `apps/web/src/lib/search/teamSearch.ts` — `recall` (Prisma) plus pure `scoreTeams` and helpers (`tokenize`, `jaccard`, `clamp01`, `deriveTagsFromTokens`).
- `apps/web/src/lib/search/teamSearch.test.ts` — 9 unit tests.

`apps/web/src/lib/team/`:

- `apps/web/src/lib/team/serialize.ts` — `toAgentsMd`, `toTeamJson`, `buildSnapshot`. Imports `ALLOWED_TOOL_NAMES` from `lib/tools/policy.ts` (single-source — no duplicate constant).
- `apps/web/src/lib/team/serialize.test.ts` — 6 unit tests.

`apps/web/src/lib/workspace/`:

- `apps/web/src/lib/workspace/exportService.ts` — `exportTeamFiles`. Atomic temp+rename via `safeJoin`; never throws; returns `{ wrote, errors }` so callers can record only successful writes as `Artifact` rows.

`apps/web/app/api/`:

- `apps/web/app/api/teams/recommend/route.ts` — `POST { sessionId }`. Returns `{ recalled, proposal, modelCatalog }`. Uses `Run.poModelId` for the LLM call. Rejects 409 if `Run.teamId` already set.
- `apps/web/app/api/teams/route.ts` — `POST { sessionId, choice, recalledTeamId? | proposal? }`. Single `prisma.$transaction` for new-team path: Team → Agents → TeamRevision v1, link `leadAgentId` and `currentRevisionId`, set `Run.teamId` and `Run.status='ready'`. Recalled path skips revision/exports and only flips `Run.teamId` + `Run.status`. Idempotent on `Run.teamId`. Export errors surface as `exportErrors` in 200 response.

`apps/web/app/runs/new/[sessionId]/compose/`:

- `apps/web/app/runs/new/[sessionId]/compose/page.tsx` — server shell only. Loads session, redirects to `/runs/new/{sessionId}` if not completed, mounts `<TeamComposer>`. **No DB mutation** per adjustment 1.

`apps/web/src/components/team/`:

- `apps/web/src/components/team/TeamComposer.tsx` — client orchestrator. Calls `/api/teams/recommend`, renders recalled-team cards + editable proposal panel (name, description, per-agent name/role/model/system-prompt/tools/lead-radio), surfaces `exportErrors` inline on success, redirects to `/runs/{runId}` on confirm.
- `apps/web/src/components/team/RevisionDiffViewer.tsx` — Phase 3 stub: renders the AGENTS.md preview as a `<pre>` block. **No `diff` / `react-diff-viewer-continued` dependency** per adjustment 3.

`apps/web/src/components/qa/`:

- `apps/web/src/components/qa/QaFlow.tsx` — added `useEffect` redirect to `/runs/new/{sessionId}/compose` once `state.view.isComplete` flips true.

`apps/web/app/`:

- `apps/web/app/layout.tsx` — pill `Phase 2` → `Phase 3`.
- `apps/web/app/page.tsx` — copy mentions team composition is wired.

`apps/web/`:

- `apps/web/package.json` — `test` script appended `src/lib/team/serialize.test.ts` and `src/lib/search/teamSearch.test.ts`.

No schema changes. No migrations. No new dependencies.

### Phase 3 Verification Results (2026-05-06)

- `pnpm --filter web typecheck` — zero errors after a one-line fix: removed `.default([])` from `tags` in `team.prompt.ts` (same Zod-default vs `ZodType<T>` generic mismatch we hit in Phase 2).
- `pnpm --filter web test` — 68 / 68 pass (6 serialize + 9 teamSearch + 19 sessionState + 8 skipPolicy + 8 redactor + 12 paths + 6 policy).
- `pnpm --filter web exec next build` — clean Turbopack build. **14 routes**, 3 new: `/api/teams`, `/api/teams/recommend`, `/runs/new/[sessionId]/compose`.
- `prisma migrate status` — clean (3 migrations, no Phase 3 schema work).

### Phase 3 Decisions

- **`modelHint` instead of `modelId`** in the proposal schema (adjustment 5). The LLM picks one of `'fast' | 'standard' | 'premium' | 'local'`; the server's `resolveModelHints` maps each hint to an enabled `ModelCatalog` row using `costTier`/`speedTier`/`provider` heuristics. `Run.poModelId` is the fallback if no row matches. The user can override the chosen model in `<TeamComposer>` before confirming; the `/api/teams` route then re-validates via `getEnabledModelOrThrow`.
- **Tool allowlist single-source** (adjustment 6). Both the Zod refinement in `team.prompt.ts` and the AGENTS.md/team.json serializers import `ALLOWED_TOOL_NAMES` from `lib/tools/policy.ts`. No duplicated constant.
- **Compose page is read-only** (adjustment 1). The page never sets `Run.status='composing'`; the only DB transitions are `Run.status='po_qa' → 'ready'` and `Run.teamId=null → set` inside `/api/teams`.
- **Client-side recommend fetch** (adjustment 2). `<TeamComposer>` mounts and immediately POSTs `/api/teams/recommend`. The first server render returns instantly (no LLM call blocking page paint).
- **No diff dependencies** (adjustment 3). `<RevisionDiffViewer>` is a single-`<pre>` preview component for Phase 3. Phase 5 will introduce the real two-revision diff.
- **No `Team.runCount++` on selection** (adjustment 7). `runCount` is incremented by Phase 4 once Runs actually start executing.
- **Export-after-commit** (adjustment 8). DB transaction commits the canonical Team/Agents/TeamRevision/Run-link first. `exportTeamFiles` runs after; failures surface as `exportErrors[]` in the 200 response. Only successful writes produce `Artifact` rows. The DB is never left in an ambiguous state.
- **Idempotent team confirmation** (adjustment 9). `Run.teamId != null` ⇒ both routes return 409 with the existing `teamId`. No second team is ever created for the same Run.
- **Recalled-team selection** does not create a TeamRevision and does not export new files. It only sets `Run.teamId` and `Run.status='ready'`.
- **Phase 3 schema unchanged** — `Team.tags`/`Agent.toolsAllowed` etc. were already provisioned in Phase 0; `TeamRevision` already has `agentsSnapshot`, `agentsMd`, `teamJson`, `proposedBy`, `approvedBy`, `sourceRunId`, `feedbackBatchId`, `reason`, `approvedAt`. Phase 5 will reuse this shape.

### Phase 3 Deviations from `IMPLEMENTATION.md`

- IMPLEMENTATION.md lists "Extend `apps/web/src/lib/agents/po.ts`". The implementation puts team-specific logic in a sibling `team.ts` + `team.prompt.ts` to keep `po.ts` focused on QA. The PO-side error classes (`PoAuthError`, `PoSchemaError`, `ProviderUnavailableError`) are shared between modules.
- IMPLEMENTATION.md does not list `apps/web/src/lib/team/serialize.test.ts` or `apps/web/src/lib/search/teamSearch.test.ts`. They are added so the pure logic is auditable without DB fixtures (matching the Phase 2 sessionState pattern).

### Phase 3 Remaining Risks

- **Manual smoke not yet executed** in this session. Build + types + tests are green; the live `/runs/new/{id}/compose` flow with a real provider has not been clicked through. Recommended path: complete a QaSession (Phase 2), confirm the redirect to `/compose` lands on `<TeamComposer>`, edit one agent's model and one system prompt, confirm, observe `projects/default/teams/{teamId}/AGENTS.md` and `team.json` on disk plus the matching `Artifact` rows in DB.
- **LLM may propose `modelHint` values the heuristics don't satisfy** (e.g. asking for `'local'` when no Ollama row is enabled). `resolveModelHints` falls back to `Run.poModelId`, which is always a valid enabled row. The user sees the fallback in the composer dropdown and can override.
- **Recall scoring is intentionally simple.** Tokenizer is whitespace + lowercase + tiny stopword set; no stemming or fuzzy matching. Embeddings are roadmap.
- **Export failure visibility** depends on the user reading the inline amber notice from `<TeamComposer>`. There is no automatic retry. A future "Re-export team files" affordance is left for Phase 5+ if the user requests it.
- **Concurrent team confirms** are blocked by the `Run.teamId` idempotency check, but two simultaneous `recommend` calls will both invoke the LLM. Cost is bounded by the user's session count and Ollama is free.

### Phase 3 Tiny Correction (2026-05-06) — export payload size guard

A review surfaced one missing guard: `exportService.ts` had no upper bound on the per-file payload size, while the runtime fs tool (`lib/tools/fsTools.ts`) already enforces a 5 MB limit. Aligned them.

**Change**

- `apps/web/src/lib/workspace/exportService.ts` — added `export const MAX_EXPORT_BYTES = 5 * 1024 * 1024;`. `writeAtomic` now checks `Buffer.byteLength(content, 'utf8')` before mkdir/temp-write and throws `export exceeds <N> bytes` if exceeded. The existing `try`/`catch` inside `exportTeamFiles` still routes the failure into `errors[]` per-file — so an oversize `AGENTS.md` does NOT block a normal `team.json` write, and the DB transaction stays committed regardless.

**Test added**

- `apps/web/src/lib/workspace/exportService.test.ts` (3 cases): guard surfaces oversize payload as a single `errors[]` entry without writing a file; the sibling under-limit file still writes; `MAX_EXPORT_BYTES` exposes the documented `5 * 1024 * 1024` value. Test reroutes `HARNESS_WORKSPACE_ROOT` to a `mkdtemp` sandbox and cleans up on exit.
- `apps/web/package.json` — `test` script appended `src/lib/workspace/exportService.test.ts`.

**Verification results**

- `pnpm --filter web typecheck` — zero errors.
- `pnpm --filter web test` — 71 / 71 pass (3 new exportService + 68 prior).
- `pnpm --filter web exec next build` — clean Turbopack build, same 14 routes (no schema or route additions).

No schema change. No new dependencies.

### Phase 3 Pre-Commit Corrections (2026-05-06) — nav, PO selector, QA auto-advance

Three issues surfaced during local smoke testing. All addressed without schema or dependency changes.

**Issues fixed**

1. **Top nav active state was wrong.** "Harness Agents" stayed visually highlighted even on `/settings`. Extracted nav into a client component so it can use `usePathname()`. New file `apps/web/src/components/navigation/AppNav.tsx`. Active rules per spec: `/` only when pathname === `/`; `/settings` when prefix matches; `/runs` when prefix matches. Active style is `font-semibold opacity-100`; inactive is `opacity-70 hover:opacity-100`. Added a "New run" link. Phase pill stays `Phase 3`. `apps/web/app/layout.tsx` is unchanged as a server component except it imports and renders `<AppNav />` in place of the inline JSX.
2. **PO model selector was a single flat dropdown.** Replaced with two cascading dropdowns in `apps/web/src/components/runs/NewRunForm.tsx`: (a) Provider — UI labels OpenAI / Anthropic / Local mapped to `openai` / `anthropic` / `ollama`; (b) Model — filtered by selected provider. Provider switch auto-selects the default within that provider, otherwise the first enabled model. If a provider has zero enabled models, the model dropdown disables itself and shows "No enabled models" — Submit stays disabled. Submit body unchanged: `{ prompt, modelId }`. API contract unchanged.
3. **QA did not advance after the first answer.** Root cause was the dependency list of `QaFlow`'s auto-advance `useEffect`: it tracked only `sessionId`, `questions.length`, `staleQuestions.length`, and `editingQuestionId`. After Q1 was answered, the question count stayed the same and `currentQuestion` was the value that actually flipped to `null` — so the effect never re-fired. Fix: `requestNext` is now wrapped in `useCallback` keyed only on `sessionId`. The effect's deps now include every value it reads (`busy`, `isComplete`, `currentQuestionId`, `staleQuestions.length`, `maxAnsweredOrder`, `editingQuestionId`, `requestNext`). The stale `// eslint-disable-next-line react-hooks/exhaustive-deps` is gone. Idempotency on the server (`/api/qa/[sessionId]/next` returns the existing active unanswered question instead of generating a duplicate) prevents any double-create from a transient busy-flip cycle. Stale-question behaviour is unchanged — when stale rows are pending the server still returns `409 stale_questions_pending` and `<QaFlow>` still renders the amber inline notice and Timeline regenerate buttons.

**Test note (requirement 6).** A focused component test would require introducing jsdom + a renderer just to drive `useEffect` timing — overhead disproportionate to a structural one-liner fix. We skip the component test and rely on the existing route idempotency contract (already exercised through `sessionState.test.ts` for the gate logic and through the manual smoke path). The auto-advance trigger condition itself is covered by the existing `deriveCurrentQuestion` test (returns `null` when all active questions have answers — exactly the signal the effect now keys off).

**Files touched**

- `apps/web/src/components/navigation/AppNav.tsx` — new client component (`usePathname` + active styling).
- `apps/web/app/layout.tsx` — server component now just renders `<AppNav />` inside the existing `<header>`.
- `apps/web/src/components/runs/NewRunForm.tsx` — two-dropdown provider/model selector with cascading defaults.
- `apps/web/src/components/qa/QaFlow.tsx` — `requestNext` is `useCallback`; effect deps audited; eslint-disable removed.

**Verification commands run**

```powershell
pnpm --filter web typecheck
pnpm --filter web test
pnpm --filter web exec next build
pnpm --filter web exec prisma migrate status
```

**Verification results**

- `pnpm --filter web typecheck` — zero errors.
- `pnpm --filter web test` — 71 / 71 pass (unchanged from the export-guard correction; component tests intentionally skipped per requirement 6).
- `pnpm --filter web exec next build` — clean Turbopack build, same 14 routes.
- `pnpm --filter web exec prisma migrate status` — clean (3 migrations, schema in sync).

No schema change. No new dependencies. No API contract change.

### Phase 3 Local Ollama QA Timeout Correction (2026-05-06)

**Symptom (manual smoke).** Running PO Q&A through local Ollama (`gemma4:e4b` @ `http://localhost:11434/v1`): Q1/Q2 (option pick) and Q3 (custom answer) saved correctly. After Q3, the auto-call to `POST /api/qa/[sessionId]/next` showed a `timeout` message. Q4 eventually appeared but the timeout banner stayed; after answering Q4 the same timeout message reappeared. The flow felt stuck.

**Root cause (two cooperating problems).**

1. **PO generate timeout was a fixed 30 s.** That is fine for OpenAI/Anthropic but local Ollama models routinely take longer to first-token. `gemma4:e4b` exceeded 30 s on a fresh run, the route returned `504 timeout`, and the user saw the failure even though the LLM continued running on Ollama and would have finished in ~60–90 s.
2. **`<QaFlow>` auto-advance ignored the error state.** Once Q1 was answered, the effect re-fired (correct from the prior pre-commit fix); but if `requestNext()` produced a 504 the resulting `state.error` did NOT short-circuit the next firing. The previously-completed answer also left the timeout banner stuck on screen because no handler cleared `state.error` on a successful retry/answer.

**Fix.**

1. **Provider-specific timeouts (`apps/web/src/lib/qa/timeout.ts`).** New helper `resolvePoGenerateTimeoutMs(provider)`:
   - `ollama` ⇒ default `OLLAMA_PO_GENERATE_TIMEOUT_MS = 120_000`.
   - `openai` / `anthropic` ⇒ default `PO_GENERATE_TIMEOUT_MS = 30_000`.
   - Env overrides: `HARNESS_OLLAMA_PO_GENERATE_TIMEOUT_MS` (Ollama only) and `HARNESS_PO_GENERATE_TIMEOUT_MS` (general; Ollama-specific wins for Ollama).
   `callGenerate` in both `apps/web/src/lib/agents/po.ts` and `apps/web/src/lib/agents/team.ts` now call `runWithGenerateTimeout(signal, fn, resolvePoGenerateTimeoutMs(provider))`.
2. **Enriched timeout error.** `GenerateTimeoutError` constructor now takes optional `{ provider, modelId }` metadata. `callGenerate` rethrows with these fields populated. The three routes that map `GenerateTimeoutError` to HTTP 504 (`/api/qa/[sessionId]/next`, `/api/qa/[sessionId]/answer`, `/api/teams/recommend`) now surface `{ error: 'timeout', timeoutMs, provider, modelId }` so the user sees which model stalled.
3. **`<QaFlow>` no-loop-on-error.**
   - Auto-advance `useEffect` adds `if (state.error) return;` (and includes `state.error` in the dep list). Timeouts and provider errors stay sticky until the user retries.
   - `requestNext`, `regenerate`, and `submit` each clear `state.error` at the start of the request. A successful retry / next answer wipes the stale banner.
4. **Retry UI.** When `currentQuestion == null && error != null && !stalePending && !isComplete && !editing`, the active-question slot now renders the error message plus a `Retry next question` button that calls `requestNext()`. Server-side idempotency (`/next` returns the existing active question instead of generating a duplicate) keeps duplicate prevention intact across retries.
5. **Ollama UX hint.** The page (`apps/web/app/runs/new/[sessionId]/page.tsx`) resolves the Run's PO model provider via `prisma.run.findUnique` + `prisma.modelCatalog.findUnique` + `resolveProviderName`, and threads `poProvider` to `<QaFlow>`. The "Loading next question…" branch now appends `Local models may take up to 120 seconds.` when `poProvider === 'ollama'`.
6. **Friendly error formatting.** New `formatErrorMessage(data, status)` helper in `<QaFlow>` turns `{error: 'timeout', timeoutMs, provider, modelId}` into `Timeout after 120s waiting for ollama/gemma4:e4b. Retry, or pick a faster model in Settings.` — and similarly for `provider_unavailable`, `provider_auth_failed`, `po_schema_error`. The user always sees something actionable, never a bare `timeout` token.

**Files touched**

- `apps/web/src/lib/qa/timeout.ts` — `resolvePoGenerateTimeoutMs`, `OLLAMA_PO_GENERATE_TIMEOUT_MS`, enriched `GenerateTimeoutError`.
- `apps/web/src/lib/agents/po.ts` — `callGenerate` resolves the provider's timeout and rethrows `GenerateTimeoutError` with provider+modelId.
- `apps/web/src/lib/agents/team.ts` — same callGenerate change.
- `apps/web/app/api/qa/[sessionId]/next/route.ts` — 504 body adds `provider` and `modelId`.
- `apps/web/app/api/qa/[sessionId]/answer/route.ts` — same.
- `apps/web/app/api/teams/recommend/route.ts` — same.
- `apps/web/app/runs/new/[sessionId]/page.tsx` — resolves and threads `poProvider`.
- `apps/web/src/components/qa/QaFlow.tsx` — `Props.poProvider`, error gate, retry UI, Ollama hint, friendly error formatter.

**Verification**

- `pnpm --filter web typecheck` — zero errors.
- `pnpm --filter web test` — 71 / 71 pass (no test changes; the fix is structural — adding component-level tests would require jsdom + a renderer per the pre-commit decision).
- `pnpm --filter web exec next build` — clean Turbopack build, same 14 routes.
- `pnpm --filter web exec prisma migrate status` — clean (3 migrations, schema in sync).

No schema change. No new dependencies. No API contract removal — only additive fields on the 504 response body.

### Phase 3 QA Busy-State UI Correction (2026-05-06)

**Symptom.** During Q&A, picking option 5 (`AI auto-judge`) immediately showed `Working…` and disabled buttons 1–5 visually, but the option-6 `Custom answer` container (textarea + Submit-custom button) did not pick up the disabled treatment. Users could plausibly assume they were still able to type or click into option 6 while the auto-judge was in flight.

**Fix (`apps/web/src/components/qa/QuestionCard.tsx`).**

- The option-6 wrapper now applies `aria-disabled={busy}` plus `cursor-not-allowed opacity-40` while busy, mirroring the dimming of the choice buttons.
- Textarea retains `disabled={busy}` and adds `disabled:cursor-not-allowed disabled:opacity-60` so it visibly turns off (focus + cursor + dimmed text).
- "Submit custom answer" button gains `aria-disabled` + `disabled:cursor-not-allowed disabled:opacity-40` so the disabled treatment matches the other choice buttons.
- "Skip (use AI auto-judge)" gains `aria-disabled` + `disabled:cursor-not-allowed disabled:opacity-40 disabled:no-underline`. The underline drops while disabled so it doesn't read as a live link.
- `pick()` now early-returns when `busy === true`. Belt-and-braces against any double-fire that slipped past the disabled prop (e.g. an in-flight click event from before busy flipped).

No new prop, no new dependency.

### Phase 3 QA Interaction Lock UI Correction (2026-05-06)

**Symptom.** While waiting for the next question to be generated, Timeline's `Edit answer` (and `Regenerate`) buttons briefly enabled then re-disabled — a visible flicker — every time the user submitted an answer. Same root cause manifested as the status pill briefly flipping back to `Active` between `Working…` and the next request.

**Root cause.** `submit()`'s `finally` cleared `state.busy` after `SET_VIEW`, then the auto-advance `useEffect` immediately fired `requestNext()` which set `state.busy=true` again. Timeline received `busy={state.busy}`, so it briefly thought the page was idle in that gap and re-enabled its buttons.

**Fix (`apps/web/src/components/qa/QaFlow.tsx`).**

- Derive a richer interactive-disable signal:
  ```ts
  const isWaitingForNextQuestion =
    !state.view.isComplete &&
    !state.error &&
    currentQuestionId == null &&
    !stalePending &&
    state.editingQuestionId == null;
  const interactionLocked = state.busy || isWaitingForNextQuestion;
  ```
  The `!state.error` clause keeps the Retry banner interactive after a timeout — the user can always click Retry, and Timeline buttons can be touched if the user wants to edit an answered question to fork a new direction.
- Pass `busy={interactionLocked}` to both `<QuestionCard>` and `<Timeline>`. They never see the false→true→false micro-blip; the "wait for next question" segment stays locked.
- Status text:
  - `state.busy` ⇒ `Working…`
  - else `isWaitingForNextQuestion` ⇒ `Generating next question…`
  - else ⇒ `Active` / `Session completed`
- Retry button stays `disabled={state.busy}` so the user can always click it from the error banner.
- Timeout retry UX preserved: auto-advance `useEffect` still gates on `state.error` (no auto-retry); error breaks `isWaitingForNextQuestion`, which is the desired behaviour because the wait isn't really happening — the user has to act.

**Files touched (combined corrections)**

- `apps/web/src/components/qa/QuestionCard.tsx` — option-6 visual lockdown, Skip disable visuals, `pick()` early-return.
- `apps/web/src/components/qa/QaFlow.tsx` — `isWaitingForNextQuestion` + `interactionLocked` derivation, status-text widening, props swap to children.

**Verification**

- `pnpm --filter web typecheck` — zero errors.
- `pnpm --filter web test` — 71 / 71 pass (no test changes; component-level testing remains out of scope per the prior pre-commit decision).
- `pnpm --filter web exec next build` — clean Turbopack build, same 14 routes.

No schema change. No new dependencies. No API contract change.

### Phase 3 QA Pending-Operation Status Correction (2026-05-06)

**Symptom.** The status pill flickered between `Working…` and `Generating next question…` (and occasionally `Active`) during the answer-submit → next-question handoff. The flicker only showed up when the next-question generation actually had to run — i.e. immediately after the user answered Q1..Q5 and before the next card appeared. The boolean `busy` flag couldn't distinguish "answer in flight" from "next-question in flight" so the label flipped twice during a single uninterrupted user wait.

**Root cause.** The previous correction had derived `isWaitingForNextQuestion` to keep `interactionLocked` stable, but the *label* still keyed off `state.busy`. The sequence on a successful answer:

1. `submit()` sets `busy=true` → label `Working…`.
2. fetch resolves → `SET_VIEW` → `state.busy=true` still, `currentQuestion=null` already → label `Working…`.
3. `submit()`'s `finally` sets `busy=false` → label briefly resolves to `isWaitingForNextQuestion ? 'Generating next question…' : 'Active'`. Render commits.
4. auto-advance `useEffect` fires → `requestNext()` sets `busy=true` → label `Working…` again.

The user saw the label flip three times even though they had only initiated one wait.

**Fix (`apps/web/src/components/qa/QaFlow.tsx`).**

- Replace `busy: boolean` in state with `pendingOperation: 'answer' | 'next' | 'regenerate' | null`.
- New action `SET_PENDING_OPERATION { operation }` replaces `SET_BUSY`.
- `SET_ERROR` continues to also clear `pendingOperation` (an error always ends the in-flight operation, in one atomic update).
- `submit()` starts with `pendingOperation='answer'`, `requestNext()` with `'next'`, `regenerate()` with `'regenerate'`. Each `finally` resets to `null`.
- New `statusLabel(state, isWaitingForNextQuestion)` helper:
  - `pendingOperation === 'answer'` ⇒ `Working…`
  - `pendingOperation === 'next'` ⇒ `Generating next question…`
  - `pendingOperation === 'regenerate'` ⇒ `Regenerating question…`
  - falls through to `isWaitingForNextQuestion ? 'Generating next question…' : 'Active'`
- `interactionLocked = state.pendingOperation != null || isWaitingForNextQuestion`. Children still see a boolean `busy` prop sourced from this; no Timeline / QuestionCard changes were needed.
- `isWaitingForNextQuestion` now also requires `state.pendingOperation == null` (in addition to the existing `!state.error`). This makes the predicate strictly "we are between operations and can drift to the next one", and the helper resolves cleanly.
- Auto-advance `useEffect` gates on `state.pendingOperation != null` (not `state.busy`).
- Retry button uses `disabled={state.pendingOperation != null}`; its label becomes `Retrying…` only when `pendingOperation === 'next'`.

**New label sequence on a successful answer**

1. submit starts → `pendingOperation='answer'` → label `Working…`.
2. fetch resolves, `SET_VIEW` updates view (currentQuestion now null), `END_EDIT`, then `finally` sets `pendingOperation=null`. React batches these into one render. State: `pendingOperation=null`, `currentQuestion=null`, `isWaitingForNextQuestion=true`. Label resolves to `Generating next question…`.
3. auto-advance `useEffect` runs, calls `requestNext()`, which sets `pendingOperation='next'`. Label resolves to `Generating next question…`.
4. `requestNext` resolves OK → `location.reload()` → fresh page render with the new question.

The label never returns to `Active` and never flips back to `Working…`. Same applies to `regenerate()` (label sustains `Regenerating question…`) and to error → Retry transitions (Retry never causes a `Working…` interlude).

**Files touched**

- `apps/web/src/components/qa/QaFlow.tsx` — state shape, action set, all three operation handlers, status label, interaction-lock derivation, Retry button condition.

No other component touched. `<QuestionCard>` and `<Timeline>` continue to receive `busy: boolean`.

**Verification**

- `pnpm --filter web typecheck` — zero errors.
- `pnpm --filter web test` — 71 / 71 pass (no test changes; component-level testing remains out of scope per the prior pre-commit decision).
- `pnpm --filter web exec next build` — clean Turbopack build, same 14 routes.

No schema change. No new dependencies. No API contract change.

### Phase 3 Compose Team Correction (2026-05-07)

Two open Compose-page issues from the 2026-05-06 smoke pass were closed before commit. Single-component change; no schema, no migration, no new dependency, no API contract change.

**Issues fixed**

1. **TeamComposer per-Agent model selector was a single flat `<select>`.** Lines 329-340 of the prior file rendered every enabled model from every provider in one dropdown, so the user couldn't filter by provider and a switch between providers required scanning the whole list. Replaced with the same two-stage pattern `<NewRunForm>` (PO model selector) already uses: a Provider `<select>` (OpenAI / Anthropic / Local) plus a Model `<select>` filtered by selected provider.
2. **Confirm navigated to `/runs/[runId]`, which 404s in Phase 3.** Both `confirmRecalled()` and `confirmNew()` called `router.push(\`/runs/${runId}\`)` on 200, but Phase 4 hasn't shipped the Run detail page yet, so the success path landed on Next's 404. Replaced with an in-place `<SuccessPanel>` rendered inside the same component. The 409 `run_already_has_team` response (which already returns `{ teamId, runId }` in the body) routes to the same panel with `mode: 'already'`.

**Behavior, per agent row**

- Provider select reads/writes `agent.provider`. On change, `updateAgentProvider(i, next)` resolves the new modelId via `pickProviderModelId(next, modelCatalog)` (prefer `isDefault`, else first enabled, else `''`) and patches `{ provider, modelId }` together so the two fields never drift.
- Model select reads/writes `agent.modelId` only; `provider` stays.
- Provider with zero enabled models ⇒ Model select renders `<option value="">No enabled models</option>` and is `disabled`.
- `canConfirm` is now derived: `editable.agents.every(a => a.modelId.length > 0)`. The Confirm button is disabled and an amber notice appears when any agent has no model. Avoids round-tripping to the server only to receive `agent_model_unknown`.
- The `hint: {modelHint}` traceability line stays.

**Behavior, on confirm**

- 200 OK on `choice: 'new'` ⇒ `setSuccess({ mode: 'new', runId, teamId, teamName: editable.name, exportErrors })`.
- 200 OK on `choice: 'recalled'` ⇒ `setSuccess({ mode: 'recalled', runId, teamId })`.
- 409 `run_already_has_team` (either path) ⇒ `setSuccess({ mode: 'already', runId, teamId })` from response body. The component never enters an error state in this case.
- All other non-OK responses fall through to the existing inline error display.
- `useRouter` import and call removed entirely.

**Success panel content**

- Emerald headline (`Team confirmed` / `Team already confirmed`), short description tailored per mode, run + team IDs in monospace, optional amber `exportErrors` block, and a Phase 4 reminder ("Run detail page lands in Phase 4. Until then, the run sits in the `ready` state in the database."). A "Back to home" `<Link>` returns the user to `/`.

**Files touched**

- `apps/web/src/components/team/TeamComposer.tsx` — added `PROVIDER_TABS`, `isProviderKey`, `pickProviderModelId` helpers; added `modelsByProvider` `useMemo`; added `updateAgentProvider`; replaced single Model `<select>` with Provider + Model two-stage; added `canConfirm` derived guard with amber notice; added `success` state, replaced both `router.push` calls with `setSuccess`, mapped `run_already_has_team` 409 to `mode: 'already'`; added `<SuccessPanel>` sub-component; dropped `useRouter` import; added `Link` import.

**Verification commands run**

```powershell
pnpm --filter web typecheck
pnpm --filter web test
pnpm --filter web exec next build
pnpm --filter web exec prisma migrate status
```

**Verification results (2026-05-07)**

- `pnpm --filter web typecheck` — zero errors.
- `pnpm --filter web test` — 71 / 71 pass (no test changes; component-level testing remains out of scope per the prior pre-commit decision).
- `pnpm --filter web exec next build` — clean Turbopack build, same 14 routes (no schema or route additions).
- `pnpm --filter web exec prisma migrate status` — clean (3 migrations, schema in sync).

**Decisions during the correction**

- Two-stage selector lives inline inside `<TeamComposer>` rather than being extracted to a shared `<ProviderModelSelector>` because the only other consumer (`<NewRunForm>`) has subtly different UX (single PO model, no per-row state, different prop shape). Premature extraction would have meant a wider abstraction surface than the duplicated 25 lines.
- `mode: 'already'` keeps the success panel ergonomic for the back-button case: a user who refreshes `/runs/new/{sessionId}/compose` after confirming will land on the panel immediately because `/api/teams` will 409 with the existing `teamId` + `runId`. No need for a separate "this run is locked" UI.
- `canConfirm` only checks `modelId.length > 0`. Server still re-validates `getEnabledModelOrThrow` and lead-count invariants. The UI guard is purely UX, not the source of truth.
- The first Open Issue from 2026-05-06 ("po_schema_error once during local Ollama smoke; Retry succeeded") is intentionally **not** addressed in this correction — it is a separate concern (PO output schema robustness on weaker models), and the Retry flow already exists.

**Risks / remaining items**

- Manual smoke not yet executed in this session. Build + types + tests are green; the live Provider switch and 409-already flow have not been clicked through. Recommended path: complete a QaSession, switch one agent's provider Anthropic → Local and confirm `modelId` auto-flips to first enabled Ollama model; click Confirm and observe the in-place success panel; navigate back to the same `/compose` URL and observe the "already confirmed" success panel via the recommend 409 path. (Note: recommend 409 still surfaces as a generic error today because that response shape only includes `teamId`, not `runId`. Out of scope for this correction.)
- If the LLM ever proposes a `provider` that disagrees with its own resolved `modelId`'s provider, the dropdowns will reflect `agent.provider` and the Model list will not contain `agent.modelId` — the user sees a blank-ish selection and can pick. The server contract (`resolveModelHints`) currently keeps them coherent, so this is a defensive note rather than a known bug.

## Phase 4 — DAG Executor and Run Progress

Status: Completed (2026-05-07)

### Approved Scope

- Lead DAG planning.
- Task rows.
- Sequential executor.
- RunEvents (append-only).
- SSE endpoint with polling fallback.
- Run detail UI.
- Process-restart sweep.
- `plan.md` artifact export.

### Phase 4 Pre-Implementation Checklist

- [x] Phase 4 plan reviewed locally and refined remotely via Ultraplan, approved 2026-05-07.
- [x] Implementation completed on branch `phase-4-dag-executor`.
- [x] Verification passed (typecheck, tests, build, migrate status).
- [x] Log updated.
- [ ] Commit pushed. (User to push — branch already pushed once empty; push of phase-4 commit handled by user.)

### Verification Targets

- Lead generates ExecutionPlan + Task rows from a `ready` run: ✅ `executor.ts` calls `proposeExecutionPlan` then persists rows in a `prisma.$transaction`.
- Tasks run sequentially in topo order: ✅ `topoSort` (covered by 11 unit tests) drives the for-loop; concurrency=1 enforced (any other value throws `concurrency_not_implemented`).
- RunEvents are append-only: ✅ `appendEvent` is the single writer; passes payload through `redactEventPayload` before stringify.
- SSE replays history then live-streams: ✅ `/api/runs/[runId]/events` reads rows since `?since=` (or `Last-Event-ID` header), then subscribes to the in-process bus. 15s heartbeat keeps proxies happy.
- Polling fallback exists: ✅ `/api/runs/[runId]/state` returns the same envelope shape with a `nextSince` cursor; client `<RunStream>` falls back on `EventSource.onerror`.
- Process-restart sweep: ✅ `ensureRecovered()` is called from every Phase 4 route + the run page; idempotent guard runs sweep at most once per process. Rows transition to `failed` with `failedReason='process_restart'`.
- No schema change: ✅ all of `ExecutionPlan`, `Task`, `RunEvent`, `Artifact`, `Run.{startedAt,endedAt,failedReason}` were already in the Phase 0 schema.

### Phase 4 Verification Commands

```powershell
pnpm --filter web typecheck
pnpm --filter web test
pnpm --filter web exec next build
pnpm --filter web exec prisma migrate status
```

### Phase 4 Created or Modified Files

`apps/web/src/lib/events/`:

- `apps/web/src/lib/events/types.ts` — Phase 4 RunEvent type union (`run.started` / `plan.created` / `task.started` / `agent.output.delta` / `agent.output.completed` / `task.completed` / `task.failed` / `run.completed`) + payload interfaces. Compile-time only; the DB column stores JSON-string.
- `apps/web/src/lib/events/redactor.ts` — `redactEventPayload<T>` two-pass: Phase 1 secret `redact()` + truncation guard at `MAX_EVENT_TEXT_BYTES = 4 KiB`. Long strings replaced with `{ truncated:true, text, originalBytes }`.
- `apps/web/src/lib/events/append.ts` — `appendEvent({ runId, taskId?, agentId?, type, payload, artifactId? })`. Single DB writer for `RunEvent` rows; emits the resulting envelope on the run bus.
- `apps/web/src/lib/events/redactor.test.ts` — 7 unit tests (registered values, regex patterns, short strings, oversize truncation, arrays, null tolerance, `MAX_EVENT_TEXT_BYTES` invariant).

`apps/web/src/lib/dag/`:

- `apps/web/src/lib/dag/runRegistry.ts` — in-process pub/sub. `getRunBus(runId)`, `publishRunEvent(runId, envelope)`, `subscribeRunEvents(runId, handler)` returning unsubscribe fn. EventEmitter cleaned up on last unsubscribe.
- `apps/web/src/lib/dag/topo.ts` — pure topological sort. `CycleDetectedError`, `MissingDependencyError`, `DuplicateTaskKeyError`. No I/O.
- `apps/web/src/lib/dag/topo.test.ts` — 11 unit tests (linear chain, branching, diamond, 2-node cycle, self-loop, 3-node cycle, duplicate keys, missing dep, empty input, single node, independent islands).
- `apps/web/src/lib/dag/executor.ts` — orchestrator. `executeRun(runId, { concurrency=1, signal })`. Loads run+team+agents+QaSession, transitions `ready → planning`, calls Lead, persists plan + tasks in a transaction, transitions to `running`, runs each task via `runAgentTask` in topo order, emits per-step events, updates `Task.{status,result,error,startedAt,completedAt}`, ends with `succeeded` or `failed` + `run.completed` event. Best-effort `plan.md` export.

`apps/web/src/lib/agents/`:

- `apps/web/src/lib/agents/lead.prompt.ts` — Zod `executionPlanSchema` (1..12 tasks, taskKey regex `/^[a-z][a-z0-9_-]{0,40}$/`, dependencies array, etc.) + `buildLeadPlanMessages(input)`. System prompt explicitly forbids tool use and lead self-assignment.
- `apps/web/src/lib/agents/lead.ts` — `proposeExecutionPlan(ctx)`. Reuses Phase 2/3 patterns (`runWithGenerateTimeout`, `resolvePoGenerateTimeoutMs`, `PoAuthError`/`PoSchemaError`/`ProviderUnavailableError`). Server-side `validatePlanShape` enforces unique taskKeys, no self-reference, all deps resolve, agent name is unambiguous and non-Lead, and topo-sorts (cycle-free). Throws `LeadPlanInvalidError` on shape failures.
- `apps/web/src/lib/agents/worker.ts` — `runAgentTask({ agent, task, upstreamResults, userPrompt, signal, onDelta })`. Single-shot `streamText`. Tools NOT invoked. Chunks batched up to `DELTA_FLUSH_BYTES=1 KiB` before forwarding to `onDelta`. Provider-aware timeout via composite AbortSignal. Auth/availability errors map to PoAuthError / ProviderUnavailableError.

`apps/web/src/lib/runtime/`:

- `apps/web/src/lib/runtime/recovery.ts` — `ensureRecovered()` idempotent boot sweep. Marks `Run.status in ('planning','running')` + their `Task.status='running'` rows as `failed` with reason `process_restart`, then appends a `run.completed` event with `success:false, failedReason:'process_restart'`.

`apps/web/app/api/runs/[runId]/`:

- `apps/web/app/api/runs/[runId]/start/route.ts` — `POST`. Validates `Run.status='ready'` and `teamId`, then fire-and-forgets `executeRun(runId)` and returns `{ ok:true, runId }`. Errors that escape the executor are logged.
- `apps/web/app/api/runs/[runId]/events/route.ts` — `GET` SSE. Replays since `?since=` or `Last-Event-ID`, subscribes to bus, 15s heartbeat. Headers `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`. Frame format: `id: <eventId>\nevent: <type>\ndata: <json>\n\n`.
- `apps/web/app/api/runs/[runId]/state/route.ts` — `GET` polling. Returns `{ run, tasks, events, nextSince }`. Encodes timestamps with `.toISOString()`.

`apps/web/app/runs/[runId]/`:

- `apps/web/app/runs/[runId]/page.tsx` — server component. Loads `Run`, `Team`, `Agent`, `Task`, last 1000 `RunEvent` rows. Calls `ensureRecovered()`. Mounts `<RunStream>` with the seeded initial state.

`apps/web/src/components/run/`:

- `apps/web/src/components/run/RunStream.tsx` — client island. `useReducer` shape: `{ status, failedReason, team, tasks, taskOutputs, events, lastEventId, transport }`. Connects via `EventSource` first, falls back to 1.5s polling on error or where EventSource is unavailable. Tracks `transport: 'connecting'|'sse'|'polling'|'closed'`. Posts `/start` on click. Stops streaming when `status` reaches a terminal state.
- `apps/web/src/components/run/DagGraph.tsx` — task list with status-tinted borders (sky=running, emerald=done, rose=failed, amber=blocked). Inline dep-list with monospace `taskKey` codes. No graph-viz library.
- `apps/web/src/components/run/AgentReportPane.tsx` — collapsible per-task panel showing the accumulated `taskOutputs[taskKey]` text (auto-expanded for `running` / `failed` tasks).

Modified:

- `apps/web/src/components/team/TeamComposer.tsx` — `<SuccessPanel>` now renders an "Open run →" `<Link href={\`/runs/${success.runId}\`}>` next to "Back to home"; the Phase-4-pending placeholder copy is removed.
- `apps/web/src/components/navigation/AppNav.tsx:38` — phase pill `Phase 3` → `Phase 4`.
- `apps/web/app/page.tsx` — home copy updated to describe Phase 4 capabilities and the Phase 5 boundary.
- `apps/web/package.json:11` — `test` script appended `src/lib/dag/topo.test.ts` and `src/lib/events/redactor.test.ts`.

Unchanged: `prisma/schema.prisma`, dependency list, prior route/feature behavior.

### Phase 4 Verification Results (2026-05-07)

- `pnpm --filter web typecheck` — zero errors.
- `pnpm --filter web test` — 89 / 89 pass (71 prior + 11 new `topo` + 7 new `events/redactor`).
- `pnpm --filter web exec next build` — clean Turbopack build. **18 routes**, 4 new: `/api/runs/[runId]/start`, `/api/runs/[runId]/events`, `/api/runs/[runId]/state`, `/runs/[runId]`.
- `pnpm --filter web exec prisma migrate status` — clean (3 migrations, schema unchanged).

### Phase 4 Decisions

- **No schema change.** All Phase 0 columns proved sufficient: `Run.{status,failedReason,startedAt,endedAt}`, `ExecutionPlan.{dagJson,rationale}`, `Task.{taskKey,name,description,expectedOutput,dependencies(JSON-encoded),status,result(JSON-encoded),error,startedAt,completedAt}`, `RunEvent.{type,payload(JSON-encoded),createdAt}`. No migration was created.
- **Run status state machine extended:** `ready → planning → running → succeeded | failed`. `planning` is intentionally distinct from `running` so the UI can label "Lead generating DAG" separately from "tasks executing"; collapsing the two would have hidden the wait state where the user is most likely to wonder if anything is happening.
- **Tools out of scope for Phase 4 agent runs.** Each `Task` is a single-shot `streamText`. The `Agent.toolsAllowed` column is preserved for the next phase; the registry/policy/fsTools layer is untouched. Phase 4 system prompts explicitly tell the agent that tools are not available.
- **No `result.created` event yet.** The MVP per-Phase event vocabulary ends a Phase 4 run with `run.completed`. Phase 5 will introduce `result.created` once `result.md`/`report.md` synthesis lands.
- **`plan.md` is the only Phase 4 artifact.** Written best-effort to `projects/{slug}/runs/{runId}/plan.md` via `safeJoin(workspaceRoot(), …)`. Failure does not abort the run; DB stays canonical. `result.md`, `report.md`, `agent-reports/*.md` are explicitly Phase 5.
- **In-process pub/sub.** Single Next worker assumed. Multi-worker requires DB-polling SSE or external pub/sub — out of scope for the local-first MVP.
- **Fire-and-forget executor.** `/start` returns immediately; the executor runs even if the user closes the browser. The user can re-open `/runs/[runId]` and the SSE replay catches them up. If the Node process dies mid-run, the next request triggers `ensureRecovered()` which marks the run failed.
- **Concurrency=1 only.** `executeRun` accepts a `concurrency` option but throws `concurrency_not_implemented` for any value !== 1. Future Phase 4.x can swap in a worker pool without callers changing.
- **Lead reuses PO timeout.** `resolvePoGenerateTimeoutMs(provider)` covers Lead too — same Cloud-vs-Ollama default split (30s vs 120s). A separate Lead-specific env override can be added later if needed.
- **Lead may not assign to itself.** `validatePlanShape` rejects `assignedAgentName === <lead.name>`. The Lead is also dropped from the prompt-side eligible list (still listed but flagged "do not assign"). Strong belt-and-braces because some models otherwise default to picking the most "important" name.

### Phase 4 Deviations from `IMPLEMENTATION.md`

- IMPLEMENTATION.md lists `apps/web/src/lib/dag/queue.ts`. We did not introduce one — sequential executor needs no queue, and a no-op queue file would only serve as a placeholder. Phase 4.x can add a real queue alongside `concurrency > 1`.
- IMPLEMENTATION.md does not list `apps/web/src/lib/agents/worker.ts`, `apps/web/src/lib/dag/runRegistry.ts`, `apps/web/src/lib/runtime/recovery.ts`, or the polling-fallback route. These are required for the SSE+fallback shape and the process-restart sweep called out in the same document. Same pattern as Phase 2 (added `sessionState.ts` / `timeout.ts` not listed in the plan but necessary for the page-thin rule).
- IMPLEMENTATION.md called for `result.created` events. We instead emit `run.completed` and reserve `result.created` for Phase 5 once result synthesis exists.

### Phase 4 Remaining Risks

- **Manual smoke not yet executed.** Build + types + tests + migrate status are green; the live `/start → SSE → DAG → succeeded` path with a real provider has not been clicked through this session. Recommended path: complete a QaSession, confirm a team, click Start, watch events arrive, then refresh mid-run to confirm replay, then kill the dev server during a run and re-open to confirm the `process_restart` sweep marks the run failed.
- **SSE under Turbopack dev** may buffer chunks in some environments. Polling fallback is the safety net — `EventSource.onerror` flips the transport to `polling` automatically. Prod build (separate from dev server) was clean.
- **Single-process bus.** Multi-worker production deployments will not see live events — they would need DB-polling SSE or external pub/sub. Acceptable for the local-first MVP; documented for the Phase 6+ plan.
- **No cancellation API.** A user who clicks Start can't currently cancel mid-run. The fire-and-forget executor does respect a parent `signal` if one is wired in, but no UI button forwards one. Phase 4.x can add `/cancel` if requested.
- **Agent name uniqueness within a Team is not DB-enforced.** Phase 3 validation does not gate it; Phase 4's `validatePlanShape` raises `ambiguous_agent_name` if the LLM picks an ambiguous name, but a deterministic earlier failure would be better. Holding for a Phase 3 sidecar fix to `/api/teams` validation if the user wants.
- **Tool calls during agent runs deferred** — explicitly out of scope. Mentioned in the system prompt so the agent does not try to invent tool calls; the registry remains in place for Phase 5+.

### Session End — 2026-05-07

Stopped here. Phase 4 is implemented, committed, and pushed; tomorrow opens with manual smoke, then merge, then Phase 5 plan review.

**Branch / commit / push state**

- Branch: `phase-4-dag-executor`.
- Commit: `09eada1 Add phase 4 DAG executor and run progress` (24 files changed, +2524 / −24).
- Pushed to `origin/phase-4-dag-executor` on 2026-05-07.
- PR / compare: <https://github.com/Gwonchankim/Harness_Agents/compare/main...phase-4-dag-executor?expand=1>.
- `main` still at `7461650 Fix phase 3 compose team handoff` — Phase 4 is NOT yet merged to `main`.

**Verification at session end (all PASS)**

| Command | Result |
|---|---|
| `pnpm --filter web typecheck` | zero errors |
| `pnpm --filter web test` | 89 / 89 pass (71 prior + 11 `topo` + 7 `events/redactor`) |
| `pnpm --filter web exec next build` | clean Turbopack build, 18 routes |
| `pnpm --filter web exec prisma migrate status` | 3 migrations, schema in sync |

**Phase 4 scope landed**

- Lead DAG planning (`lib/agents/lead.ts` + `lead.prompt.ts`, Zod-validated).
- Sequential task executor (`lib/dag/executor.ts`; concurrency=1 enforced; sig accepts future >1).
- RunEvent append-only writer (`lib/events/append.ts` + `redactor.ts` size guard at 4 KiB).
- In-process pub/sub (`lib/dag/runRegistry.ts`).
- SSE endpoint + polling fallback (`/api/runs/[runId]/{events,state}`).
- `/runs/[runId]` run progress UI (`app/runs/[runId]/page.tsx` + `RunStream.tsx` + `DagGraph.tsx` + `AgentReportPane.tsx`).
- `plan.md` artifact export to `projects/{slug}/runs/{runId}/plan.md` (best-effort).
- Process-restart sweep (`lib/runtime/recovery.ts`, `ensureRecovered()` called from every Phase 4 route + the page).
- `Task.result` persisted as `JSON.stringify({ text, bytes })` — readers should `parseJson<{ text?: string }>(t.result, {}).text`.
- Phase 4 ends a run with the `run.completed` event (success/fail flag + counts + optional failedReason).

**Phase 4 scope deferred (Phase 5)**

- Tool calling from inside agent runs (registry/policy/fsTools still wired but not invoked by `worker.ts`).
- Final result synthesis: `result.md` / `report.md` / `agent-reports/*.md` — not produced in Phase 4.
- `result.created` event — reserved for Phase 5 once result synthesis exists.
- FeedbackBatch / Feedback / TeamRevision v2+ proposal — Phase 5.

**Tomorrow's priority order**

1. Phase 4 manual smoke (must precede merge).
   - `pnpm --filter web dev`, complete a Q&A, confirm a team, click `Open run →` from the SuccessPanel.
   - On `/runs/[runId]`: click Start, verify status transitions `ready → planning → running → succeeded`.
   - Verify SSE delta accumulation in the AgentReportPane (text grows live per task).
   - Refresh mid-run: confirm RunEvent history replay restores state, then live stream resumes.
   - Confirm `projects/default/runs/{runId}/plan.md` lands on disk; confirm `result.md`, `report.md`, and `agent-reports/*.md` are NOT created (Phase 5 boundary).
   - Stretch smoke: kill the dev server during a run, restart, observe `Run.status='failed'` with `failedReason='process_restart'`.
   - Stretch smoke: temporarily break the provider key in `/settings`, start a new run, observe `task.failed` → `Run.status='failed'`.
2. Decide merge: PR via the compare link above, or `git checkout main && git merge phase-4-dag-executor`.
3. Move to Phase 5 plan review (`/ultraplan` style).

**Resume prompt for next session**

```text
Phase 4 is implemented, committed (`09eada1`), and pushed to
`origin/phase-4-dag-executor`. Manual smoke is the first thing — do not
merge or start Phase 5 until smoke passes.

Tasks (in order):

1. Read PLAN.md, IMPLEMENTATION.md, and the latest entries in PHASE_LOG.md
   (especially the "Session End — 2026-05-07" block under Phase 4).
2. Walk the manual smoke list under "Tomorrow's priority order" item 1
   in that section. Capture pass/fail per step.
3. If smoke passes, ask whether to merge `phase-4-dag-executor` to `main`
   (PR or fast-forward) and act per the answer.
4. If smoke fails, propose a minimal Phase 4 correction patch and stop
   for review before any code changes.
5. After smoke + merge, switch context to Phase 5 plan review only —
   do not start Phase 5 implementation without explicit approval.

Do not start Phase 5 code. Do not push without explicit instruction.
```

## Phase 5 — Result, Feedback, Revision

Status: Implemented (2026-05-24) — see `PHASE5_PLAN.md` for the full plan + the 5 approved corrections.

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

Implemented 2026-05-24 on branch `phase-4-dag-executor`.

**New (lib):** `results/report.ts`, `results/agentReport.ts`, `results/exportReports.ts`,
`workspace/writeWorkspaceFile.ts`, `feedback/persist.ts`, `feedback/aggregate.ts`,
`feedback/diff.ts`, `agents/leadRevise.prompt.ts`, `agents/leadRevise.ts`,
`revision/validate.ts`, `team/revision.ts`, `revision/propose.ts`, `revision/approve.ts`,
`revision/reject.ts`.
**New (API):** `api/runs/[runId]/feedback`, `api/runs/[runId]/revision`.
**New (UI):** `app/runs/[runId]/feedback/page.tsx`, `components/feedback/{RatingInput,
ResultFeedback,AgentFeedbackCard,AgentFeedbackGrid,RevisionDiff,RevisionReview,FeedbackForm}.tsx`.
**Edited (minimal):** `dag/executor.ts` (+1 best-effort `exportRunReports` call after success),
`events/types.ts` (revision event types), `components/run/RunStream.tsx` ("Give feedback" CTA),
`package.json` (3 new tests).

**Corrections honored:** (1) approve updates agents by agentId only — no delete/create; Lead
schema echoes agentId. (2) approve requires `baseRevisionId == Team.currentRevisionId`, else
409 `revision_stale` (re-checked inside the tx). (3) FeedbackBatch append-only; propose uses the
latest batch. (4) shared `writeWorkspaceFile` is new; `finalResult.ts`/`exportService.ts`/teams
route untouched. (5) `PHASE5_PLAN.md` UTF-8 verified.

**Schema:** no change (Feedback/AgentRating/TeamRevision already in the init migration).

**Verification (all green):** `typecheck` clean · `test` 101 pass / 0 fail · `next build` ok
(feedback + revision routes registered) · `prisma migrate status` "up to date".

**Remaining risks:** Lead revise quality depends on the local model (strict-repair retry mitigates);
proposal uses the stateless round-trip (server re-validates on approve); manual UI smoke still pending.

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

### Phase 1 work completed earlier today

Implemented Providers, Tools, Secrets per the revised plan. Build green, 26/26 tests pass, no schema changes.

### Phase 2 work completed earlier today

Implemented the PO Q&A flow per the Ultraplan-refined plan with eight user-required adjustments. Schema migrated (`Run.poModelId`, `QaQuestion.regeneratedAt`, `QaQuestion.isFinal`, `QaAnswer.updatedAt`). Build green, 53/53 tests pass after the correction pass.

### Phase 3 work completed today

Implemented Team Composition per the Ultraplan-refined plan with ten user-required adjustments. No schema change. Build green, 68/68 tests pass.

### Next session: where to start

1. Review `PHASE_LOG.md` "Phase 3 — Team Composition" section.
2. (If not done in this terminal) commit and push Phase 1 + 2 + 3.
3. Run `pnpm --filter web dev` and click through end-to-end: `/runs/new` → answer 5–6 questions → `/runs/new/{id}/compose` → edit a model + system prompt → confirm → confirm `projects/default/teams/{teamId}/AGENTS.md` and `team.json` on disk plus matching `Artifact` rows.
4. Open Phase 4 planning per `IMPLEMENTATION.md` § "Phase 4 — DAG Executor and Run Progress". Do not write Phase 4 code until the detailed plan is reviewed and approved.

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

## Phase 3 — Remaining Issues (open before Phase 4)

Three issues surfaced during local smoke testing on 2026-05-06 that we deferred. None block Phase 3 commit (the team is created, files exported, DB consistent), but they need to be cleaned up before Phase 4 starts.

### 1. Compose team — per-Agent model selector should be two-dropdown

`<TeamComposer>` (`apps/web/src/components/team/TeamComposer.tsx`) currently renders a single flat `<select>` per agent listing every enabled model. `<NewRunForm>` already uses the Provider (OpenAI / Anthropic / Local) + Model cascading pattern, and the same UX should apply here. The data is already on the client — `data.modelCatalog` already includes `provider`, `displayName`, `costTier`, `speedTier`, `isDefault`. Reuse the same `PROVIDER_TABS` mapping (`openai` / `anthropic` / `ollama` ⇒ `OpenAI` / `Anthropic` / `Local`) and the `pickProviderModelId` helper logic.

Per-agent state needs a `provider` alongside `modelId`. Simplest: derive `provider` from the current `modelId` via lookup against `modelCatalog` on every render (no extra state field needed); when the user changes the provider, set `modelId = pickProviderModelId(newProvider, modelCatalog)`. When the user changes the model, the provider follows automatically from the lookup. Keep the same submit shape (the route only validates `modelId`).

### 2. `<TeamComposer>` confirm → `/runs/[runId]` returns 404

Both confirm paths in `<TeamComposer>` call `router.push(`/runs/${runId}` as never)`. That route does not exist in Phase 3 — it is the future Phase 4 Run-detail page. The user sees a Next 404. The `Team` row, `Agent[]`, `TeamRevision v1`, and `Run.status='ready'` are all correctly committed and the export files do land on disk; the failure is purely the navigation target.

Fix shape: stop pushing to `/runs/[runId]` for now. Replace with an in-component success state showing:

- "Team created" message with the team name + agent count.
- The `AGENTS.md` preview the user already saw (`<RevisionDiffViewer>` reuse) so they can confirm the snapshot.
- Any `exportErrors[]` if the export failed for some files.
- A note that DAG execution (Phase 4) will pick up the run.
- Optionally a link back to `/runs/new` for starting another session.

The `run_already_has_team` 409 path (which fires if the user double-clicks confirm or refreshes after a successful create) should land in the same success state instead of showing a raw error string. The 409 body returns `{ teamId, runId }` — same shape as the success body — so the handler can treat them identically.

### 3. Local Ollama compose hit `po_schema_error` once

During manual smoke with `gemma4:e4b`, the compose-team LLM call returned a malformed structured response on the first attempt; clicking Retry once succeeded. The Phase 2 PO module already catches `AI_NoObjectGeneratedError` and maps to `PoSchemaError` → 502 with `error: 'po_schema_error'`, and `formatErrorMessage` in `<QaFlow>` produces the user-facing message. `<TeamComposer>` shows the raw error string — it should at minimum reuse the same friendly formatter and ideally retry once automatically (with a small backoff) before surfacing the error.

Defer until after the two items above. Cost of the failure is low (one user click) and the symptom is rare on cloud providers.

## Resume Prompt — paste into next session (2026-05-06 → Phase 3 Compose corrections)

```text
오늘은 어제 멈춘 지점에서 이어서 작업합니다. Phase 3 Compose team correction 단계입니다.

먼저 다음을 확인해주세요:
1. `PLAN.md`, `IMPLEMENTATION.md`, `PHASE_LOG.md`를 읽습니다.
2. `PHASE_LOG.md`의 다음 섹션을 모두 검토합니다:
   - "Current Status" (Phase 3 + 모든 correction 진행 상황)
   - "Phase 3 — Team Composition" (메인 구현)
   - "Phase 3 Tiny Correction" (export size guard)
   - "Phase 3 Pre-Commit Corrections" (nav, PO selector 2단, QaFlow auto-advance)
   - "Phase 3 Local Ollama QA Timeout Correction" (provider별 timeout, retry UI)
   - "Phase 3 QA Busy-State UI Correction" (옵션 6 lockdown, pick guard)
   - "Phase 3 QA Interaction Lock UI Correction" (Timeline flicker fix)
   - "Phase 3 QA Pending-Operation Status Correction" (boolean → enum)
   - "Phase 3 — Remaining Issues" (이번 세션에서 처리할 3가지 항목)

현재 상태 (2026-05-06 기준):
- Phase 0/1/2/3 모두 완료, 53개+ 테스트 PASS, build clean, schema in sync (3 migrations).
- 사용자가 모든 Phase commit/push를 직접 수행 중. git status를 먼저 확인하세요.
- Phase 3 본 구현 + 다수 correction이 워킹 트리에 누적되어 있을 수 있습니다 (사용자 commit 여부에 따라).
- Phase 4 (DAG/SSE)는 아직 시작하지 않습니다. Phase 3 보정만 하고 멈춥니다.

오늘의 작업 (Phase 3 Compose corrections, 3개 항목):

작업 1 — TeamComposer Agent model selector 2단 dropdown:
- `apps/web/src/components/team/TeamComposer.tsx`의 per-agent 모델 dropdown을
  `apps/web/src/components/runs/NewRunForm.tsx`와 동일한 Provider + Model 2단 형태로 변경.
- UI 라벨 매핑: `OpenAI` → `openai`, `Anthropic` → `anthropic`, `Local` → `ollama`.
- Provider 변경 시 해당 provider의 default model이 있으면 그걸, 없으면 첫 enabled 모델로 자동 선택.
- 빈 provider면 disabled `No enabled models`.
- 제출 페이로드 (`{ name, role, isLead, modelId, systemPrompt, toolsAllowed, tags }`) shape는 그대로 유지.
- API 계약 변경 없음.

작업 2 — Confirm 후 success state in-place:
- `<TeamComposer>`의 `confirmRecalled`와 `confirmNew` 양쪽에서
  `router.push('/runs/${runId}')` 제거.
- 대신 component-internal `success` 상태로 전환:
  - 새 useState나 reducer로 `successState: { teamId, runId, exportErrors? } | null`.
  - 성공 시 success state 렌더 (Team 이름 + agent 수 + AGENTS.md preview + exportErrors[] + Phase 4 안내).
  - `<RevisionDiffViewer>`는 이미 있으니 재사용.
  - 새 run을 시작하기 위한 `/runs/new` 링크 추가는 선택사항.
- `run_already_has_team` 409도 동일한 success state로 라우팅:
  - 409 응답 body는 `{ error, teamId, runId }` 형태이므로 success body와 호환.
  - 사용자가 새로고침/더블클릭한 경우에도 raw error 대신 success state가 보여야 함.
- Phase 4 시작 시 다시 `/runs/[runId]`로 push하도록 되돌리는 코드 위치 주석을 남기거나 TODO 표시.

작업 3 (선택 / deferred 가능):
- Local Ollama compose에서 `po_schema_error`가 1회 발생한 케이스.
- 이번 세션에서는 user-friendly 메시지만 적용해도 충분 (`formatErrorMessage` 패턴 재사용).
- 자동 retry-once는 다음 세션 또는 Phase 4 이후로 미뤄도 됨.
- 작업 1, 2 끝낸 시간 여유에 따라 결정.

검증:
- pnpm --filter web typecheck
- pnpm --filter web test
- pnpm --filter web exec next build
- pnpm --filter web exec prisma migrate status

수동 확인 (브라우저):
- /runs/new → Q1..Q5/Q6 완료 → /compose 자동 전환
- 각 Agent 카드에서 Provider dropdown / Model dropdown이 cascading하게 작동
- Provider 바꾸면 model이 자동 reselect
- Confirm 누르면 success state가 같은 페이지에 표시됨 (404 없음)
- 새로고침해도 success state 유지 (run_already_has_team 409 → success)
- projects/default/teams/{teamId}/AGENTS.md, team.json 모두 디스크에 존재
- Artifact rows 확인

완료 후:
- PHASE_LOG.md "Phase 3 Compose Corrections (날짜)" 섹션 추가
- "Open issues before Phase 4" 항목에서 처리한 것은 제거하고 남은 것만 유지
- 멈추고 사용자 commit/push 대기. Phase 4 시작 금지.

참고:
- 모든 fs / 시크릿 / 도구 / runtime 규칙은 Phase 1/2/3에서 정해진 그대로.
- pendingOperation enum 패턴은 QaFlow에만 적용되어 있음. TeamComposer는 단순 boolean submitting으로 유지해도 OK.
- Compose 페이지(`apps/web/app/runs/new/[sessionId]/compose/page.tsx`)는 server-component로 DB mutation 금지 원칙 유지.
```
