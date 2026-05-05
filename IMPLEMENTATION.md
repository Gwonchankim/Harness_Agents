# Harness Agents MVP Implementation Plan

This document records the full Phase 0 to Phase 5 implementation plan.

Before each Phase begins, create a more detailed Phase-specific implementation plan, review it, then implement only after approval.

## Operating Rules

1. Do not implement multiple Phases at once.
2. Before each Phase, write a short detailed plan covering scope, files, DB changes, and verification.
3. Stop for review before implementation.
4. After implementation, run the Phase verification commands.
5. Update `PHASE_LOG.md`.
6. Commit and push only after a Phase passes verification.

## Architecture Rules

- Keep Next.js under `apps/web`.
- Use `pnpm` workspaces.
- Keep page and route files thin.
- Keep DB access, domain logic, prompts, UI, tools, and export logic separate.
- DB is the source of truth.
- Markdown/JSON files are generated exports/cache.
- All filesystem access must go through safe path helpers.
- All Agent tool calls must go through ToolRegistry and PolicyEngine.
- All system export writes must go through WorkspaceExportService.

## Phase 0 — Scaffold and Database Foundation

### Goal

Create a working monorepo and bootable Next.js 16 app with Prisma SQLite, seeded Default Project, seeded ModelCatalog, and a read-only Settings page.

### Scope

Root files:

- `pnpm-workspace.yaml`
- `package.json`
- `tsconfig.base.json`
- `.editorconfig`
- `.prettierrc`
- `.gitignore`
- `.env.example`
- `models.json`
- Update `README.md`

App files:

- `apps/web/package.json`
- `apps/web/next.config.ts`
- `apps/web/tsconfig.json`
- `apps/web/app/layout.tsx`
- `apps/web/app/page.tsx`
- `apps/web/app/settings/page.tsx`
- `apps/web/app/globals.css`
- `apps/web/prisma/schema.prisma`
- `apps/web/prisma/seed.ts`
- `apps/web/src/db/client.ts`
- `apps/web/src/lib/workspace/paths.ts`

### DB Models

Create the full MVP schema early:

- Project
- Team
- TeamRevision
- Agent
- Run
- QaSession
- QaQuestion
- QaAnswer
- ExecutionPlan
- Task
- RunEvent
- ToolCall
- Artifact
- FeedbackBatch
- Feedback
- AgentRating
- ModelCatalog
- SecretStore

SQLite cautions:

- Do not use scalar list fields such as `String[]`.
- Use `Json` or stringified JSON fallback for arrays and structured data.
- `DATABASE_URL` should be safe relative to `apps/web/prisma/schema.prisma`, usually `file:./dev.db`.
- Prisma migrations are committed to git.

### Verification

Run:

```powershell
pnpm install
pnpm --filter web prisma migrate dev
pnpm --filter web prisma db seed
pnpm --filter web build
```

Manual:

- Open `/settings`.
- Confirm ModelCatalog rows render server-side.
- Confirm Default Project exists in DB.

### Stop Condition

Stop after Phase 0 verification passes and summarize changes. The user commits and pushes.

## Phase 1 — Providers, Tools, Secrets

### Goal

Create the Agent runtime foundation: provider adapters, model catalog availability, secrets store, redaction, tool registry, policy engine, sandboxed filesystem tools, and settings editor.

### Scope

Expected files:

- `apps/web/src/lib/secrets/store.ts`
- `apps/web/src/lib/secrets/redactor.ts`
- `apps/web/src/lib/providers/openai.ts`
- `apps/web/src/lib/providers/anthropic.ts`
- `apps/web/src/lib/providers/ollama.ts`
- `apps/web/src/lib/providers/index.ts`
- `apps/web/src/lib/models/catalog.ts`
- `apps/web/src/lib/tools/registry.ts`
- `apps/web/src/lib/tools/policy.ts`
- `apps/web/src/lib/tools/fsTools.ts`
- `apps/web/src/lib/tools/webSearch.ts`
- `apps/web/src/lib/agents/runtime.ts`
- `apps/web/app/api/secrets/route.ts`
- `apps/web/app/api/models/route.ts`
- Upgrade `apps/web/app/settings/page.tsx`

### Runtime API

Do not create one overloaded `complete` function.

Create separate functions:

- `runtime.streamText`
- `runtime.generateObject`
- `runtime.checkModelAvailability`

### Secrets

Priority:

1. Settings UI
2. `.env.local`
3. `.env`
4. unset

Storage:

- Try keytar first.
- Fallback to AES-GCM encrypted SQLite/local key.
- Document fallback as local obfuscation.

### Tools

Allowed:

- `fs.readFile`
- `fs.writeFile`
- `fs.listDir`
- `web.search` stub disabled by default

Forbidden:

- shell
- code execution
- git
- system commands
- workspace-external paths

### Verification

- Set a provider key in Settings and confirm masked display.
- Bad key marks only that provider unavailable.
- Workspace path traversal is rejected.
- ToolCall records allowed and denied tool calls with reason.
- Grep/search DB and logs for plaintext keys: no hits.
- Unit tests for redactor and safeJoin.

## Phase 2 — PO Q&A

### Goal

Build `/runs/new` flow where user enters prompt, selects PO model, answers up to 6 dynamic cards, edits prior answers, and completes QaSession.

### Scope

Expected files:

- `apps/web/src/lib/agents/po.ts`
- `apps/web/src/lib/agents/po.prompt.ts`
- `apps/web/src/lib/po/skipPolicy.ts`
- `apps/web/app/api/runs/route.ts`
- `apps/web/app/api/qa/[sessionId]/next/route.ts`
- `apps/web/app/api/qa/[sessionId]/answer/route.ts`
- `apps/web/app/runs/new/page.tsx`
- `apps/web/app/runs/new/[sessionId]/page.tsx`
- `apps/web/src/components/qa/QuestionCard.tsx`
- `apps/web/src/components/qa/Timeline.tsx`

### Behavior

- Create Run under Default Project.
- Create QaSession.
- Generate one question at a time.
- Each question has exactly 6 options.
- Option 5 means AI auto-judge.
- Option 6 means custom input.
- Skip maps to option 5.
- Editing an earlier answer marks later questions stale.

### Verification

- New Run creates Run and QaSession.
- 6 questions can be completed.
- Option 5 stores `isAutoJudged=true`.
- Editing Q2 after answering Q5 marks Q3 to Q5 stale.
- Regeneration works.

## Phase 3 — Team Composition

### Goal

After Q&A, generate recall recommendations and a new Team proposal. User confirms or edits the Team. System creates Team, Agents, TeamRevision v1, `AGENTS.md`, and `team.json`.

### Scope

Expected files:

- `apps/web/src/lib/search/teamSearch.ts`
- Extend `apps/web/src/lib/agents/po.ts`
- `apps/web/src/lib/team/serialize.ts`
- `apps/web/src/lib/workspace/exportService.ts`
- `apps/web/app/api/teams/recommend/route.ts`
- `apps/web/app/api/teams/route.ts`
- `apps/web/app/runs/new/[sessionId]/compose/page.tsx`
- `apps/web/src/components/team/TeamComposer.tsx`
- `apps/web/src/components/team/RevisionDiffViewer.tsx`

### Behavior

- Proposed team has around 5 Agents.
- Exactly 1 Lead Agent.
- User can edit model, role, and prompt.
- Initial TeamRevision version is 1.
- `Run.teamId` is set after confirmation.
- `Run.status` becomes ready.

### Verification

- First Run shows no recalled teams but shows proposed team.
- Agent model edit persists.
- Confirm creates Team, Agents, TeamRevision v1.
- `projects/{projectId}/teams/{teamId}/AGENTS.md` exists.
- `projects/{projectId}/teams/{teamId}/team.json` exists.

## Phase 4 — DAG Executor and Run Progress

### Goal

Lead Agent generates a DAG plan. Executor runs tasks sequentially for MVP, emits RunEvents, streams progress through SSE, and supports refresh replay from DB.

### Scope

Expected files:

- `apps/web/src/lib/agents/lead.ts`
- `apps/web/src/lib/agents/lead.prompt.ts`
- `apps/web/src/lib/dag/executor.ts`
- `apps/web/src/lib/dag/queue.ts`
- `apps/web/src/lib/events/sse.ts`
- `apps/web/src/lib/events/redactor.ts`
- `apps/web/app/api/runs/[runId]/start/route.ts`
- `apps/web/app/api/runs/[runId]/events/route.ts`
- `apps/web/app/runs/[runId]/page.tsx`
- `apps/web/src/components/run/RunStream.tsx`
- `apps/web/src/components/run/AgentReportPane.tsx`
- `apps/web/src/components/run/DagGraph.tsx`

### Behavior

- Lead creates ExecutionPlan and Task rows.
- Executor topo-sorts dependencies.
- MVP concurrency is 1.
- Executor API accepts future concurrency param.
- RunEvents are append-only.
- SSE replays recent events on reconnect.
- Polling fallback exists.
- Running Run after process restart is marked failed with `process_restart`.

### Verification

- Start Run with mock provider.
- Events arrive in topo order:
  - `plan.created`
  - `task.started`
  - `agent.output.delta`
  - `task.completed`
- Refresh mid-run replays events and continues.
- Restart during run marks it failed.

## Phase 5 — Result, Feedback, Revision

### Goal

Write final outputs, collect feedback, propose Team revision diff, approve/reject, and create new TeamRevision.

### Scope

Expected files:

- Extend `apps/web/src/lib/agents/lead.ts`
- `apps/web/src/lib/feedback/diff.ts`
- `apps/web/app/api/runs/[runId]/feedback/route.ts`
- `apps/web/app/api/runs/[runId]/revision/route.ts`
- `apps/web/app/runs/[runId]/feedback/page.tsx`
- `apps/web/src/components/feedback/ResultFeedback.tsx`
- `apps/web/src/components/feedback/AgentFeedbackGrid.tsx`
- Extend `apps/web/src/components/team/RevisionDiffViewer.tsx`

### Behavior

- Write:
  - `result.md`
  - `report.md`
  - `agent-reports/{agentId}.md`
- Submit feedback as FeedbackBatch.
- Create Feedback rows.
- Lead proposes new `AGENTS.md` and `team.json` contents.
- System computes diff.
- User approves or rejects.
- Approval creates TeamRevision v2+.
- Prior revision remains preserved.

### Verification

- Run completion creates output files and Artifact rows.
- Feedback submission creates FeedbackBatch and Feedback rows.
- Diff panel renders.
- Approval creates TeamRevision v2.
- Disk files update.
- Previous TeamRevision remains.
- AgentRating write works.

## Phase 6 and Later — Out of Current Scope

Not implemented in MVP Phases 0 to 5:

- Recall flow polish.
- Team Library analytics.
- AgentRating dashboards.
- Inter-team collaboration.
- Embedding search.
- Code execution tools.
- Worker/BullMQ extraction.
- SaaS auth/deploy.

## Standard Phase Review Prompt

Use this before starting any Phase:

```md
Read `PLAN.md`, `IMPLEMENTATION.md`, and `PHASE_LOG.md`.

We are about to start Phase {N}: {Phase Name}.

Before writing code:
1. Summarize the Phase goal.
2. List the exact files you expect to create or edit.
3. List any DB schema changes.
4. List verification commands.
5. Identify risks or assumptions.
6. Stop and wait for approval.
```

## Standard Phase Implementation Prompt

Use this after approving a Phase plan:

```md
Proceed with Phase {N} implementation according to the approved plan.

Rules:
- Implement only this Phase.
- Keep files single-responsibility.
- Do not implement later-Phase features.
- Run the Phase verification commands.
- Fix failures and rerun once.
- Update `PHASE_LOG.md` with summary, changed files, verification result, and remaining risks.
- Stop after reporting completion. I will handle git commit and push.
```

