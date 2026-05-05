# Harness Agents MVP Product Plan

## 1. Project Overview

Harness Agents is a local-first web application for creating, running, evaluating, and reusing purpose-built AI agent teams.

The core idea is simple:

- A user starts with a rough request.
- A PO Agent clarifies the request through 5 to 6 dynamic multiple-choice questions.
- A reusable Agent Team is proposed or recalled from existing teams.
- The selected team executes the work through a Lead Agent and task-specific Agents.
- The result, reports, agent activity, feedback, and team improvements are persisted.

The product is not a generic chat UI. It is an agent team operating system focused on repeatable workflows, durable team memory, and controlled improvement over time.

## 2. MVP Goal

The MVP goal is to complete a local single-user flow from request intake to feedback-based team revision.

The MVP is successful when the user can:

1. Enter a task request.
2. Complete a PO Agent Q&A flow.
3. Review a proposed 5-agent team with 1 Lead Agent.
4. Confirm the team and generate `AGENTS.md` and `team.json`.
5. Start a Run.
6. See a DAG execution plan and task progress.
7. Receive `result.md`, `report.md`, and agent-level reports.
8. Submit result and per-agent feedback.
9. Review a proposed diff for `AGENTS.md` and `team.json`.
10. Approve the revision and create a new TeamRevision.

## 3. Target User

Primary user:

- A single local power user who wants to use AI agents for recurring knowledge work, planning, writing, research, document generation, or operational tasks.

Future users:

- Teams or organizations that want reusable domain-specific agent teams.
- SaaS users who need team memory, audit logs, and model/provider flexibility.

## 4. Product Principles

1. Local-first before SaaS.
2. DB is the source of truth.
3. Markdown and JSON files are human-readable exports/cache.
4. Agent teams should improve only with user approval.
5. A Run belongs to exactly one Team in the MVP.
6. Inter-team collaboration is roadmap, not MVP.
7. Tool access starts narrow and permissioned.
8. Every file should have one primary responsibility.
9. The system should be model/provider-agnostic.
10. Every major action should be inspectable through logs or artifacts.

## 5. Confirmed Technical Stack

- Monorepo with `pnpm`
- Next.js 16 App Router under `apps/web`
- React 19
- TypeScript strict mode
- Tailwind CSS
- SQLite + Prisma
- Vercel AI SDK
- OpenAI, Anthropic, and Ollama provider adapters
- Ollama via OpenAI-compatible endpoint when possible
- SSE + DB polling fallback for Run progress
- `react-markdown` + `remark-gfm` for markdown rendering
- `diff` + `react-diff-viewer-continued` for revision diffs
- Local-first, single-user MVP

## 6. Repository Layout

```txt
Harness_Agents/
  PLAN.md
  IMPLEMENTATION.md
  PHASE_LOG.md
  README.md
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
  models.json
  .env.example
  apps/
    web/
      app/
      src/
      prisma/
  projects/
    {projectId}/
      project.json
      teams/
        {teamId}/
          AGENTS.md
          team.json
          runs/
            {runId}/
              run.json
              plan.md
              result.md
              report.md
              agent-reports/
              artifacts/
```

## 7. Domain Model

### Project

A high-level domain, topic, client, or work area.

MVP behavior:

- Automatically create and use a `Default Project`.
- Project creation UI can be added later.

### Team

A reusable set of Agents with a domain, roles, models, operating rules, and a Lead Agent.

Team-level files:

- `AGENTS.md`: human-readable role definition.
- `team.json`: structured team export/cache.

### Agent

A member of a Team.

Each Agent has:

- Name
- Role
- Model ID
- System prompt
- Allowed tools
- Score/history

One Agent must be the Lead Agent.

### Run

One execution cycle for a user request.

Run-level files:

- `run.json`
- `plan.md`
- `result.md`
- `report.md`
- `agent-reports/{agentId}.md`
- `artifacts/*`

## 8. New Task Flow

1. User enters a prompt and optionally selects a PO model.
2. System creates a Run under the Default Project.
3. PO Agent generates the first question card.
4. User answers 5 to 6 dynamic questions.
5. Each question has 6 choices:
   - 1 to 4: generated complete choices
   - 5: AI auto-judge
   - 6: custom user input
6. Skip is treated as choice 5, AI auto-judge.
7. User can edit previous answers.
8. When a previous answer changes, later questions become stale and can be regenerated.
9. After Q&A, PO Agent creates:
   - Existing Team recommendations
   - A new Team proposal
10. User selects a recalled Team or confirms/edits the new Team proposal.
11. Team is saved with initial `AGENTS.md`, `team.json`, and TeamRevision v1.
12. Lead Agent creates a DAG execution plan.
13. Tasks execute through the Agent runtime.
14. Progress appears through SSE and DB event replay.
15. Lead synthesizes final outputs.
16. User submits result and per-agent feedback.
17. Lead proposes `AGENTS.md` and `team.json` updates as a diff.
18. User approves or rejects the revision.

## 9. Existing Team Recall Flow

1. User enters a new prompt.
2. PO Agent analyzes the prompt.
3. TeamSearchService recommends top matching Teams using metadata, tags, domain, AGENTS summary, past run summaries, and scores.
4. User selects a recommended Team or chooses to create a new Team.
5. Selected Team's Lead Agent analyzes whether extra Agents are needed.
6. If reinforcement is needed, user approval is required.
7. Run continues from DAG planning.

MVP search:

- Keyword/tag/metadata-based search.
- Embedding search is roadmap.

## 10. PO Q&A UI

Use a progress bar plus card UI.

Requirements:

- One active question card at a time.
- Progress indicator such as `2 / 6`.
- Previous questions visible as a collapsible timeline.
- Previous answers editable.
- Later questions marked stale after upstream answer edits.
- Regeneration CTA for stale questions.
- QuestionCard component reused for mid-run clarification and result feedback.

## 11. Agent Team Requirements

Each proposed Team must:

- Contain around 5 Agents.
- Contain exactly 1 Lead Agent.
- Include model selection per Agent.
- Include clear role descriptions.
- Include allowed tools per Agent.
- Generate `AGENTS.md` and `team.json`.

The user can:

- Inspect Agent roles.
- Edit Agent roles/system prompts.
- Change Agent models.
- Accept, reject, or revise the Team proposal.

## 12. Tool Scope

MVP tools are narrow and permissioned.

Allowed:

- Workspace-internal file read.
- Workspace-internal file write.
- Workspace-internal directory listing.
- Markdown/report writing through controlled export services.
- Optional web search stub, disabled by default.

Forbidden in MVP:

- Shell execution.
- Python/Node code execution.
- Git operations.
- System commands.
- Workspace-external file access.

Every direct Agent tool call must be logged in ToolCall with:

- Agent ID
- Tool name
- Args
- Result
- Reason
- Timestamp

System exports are not Agent tool calls. They should be handled by WorkspaceExportService and audited through RunEvent.

## 13. Execution Model

Lead Agent creates a DAG execution plan.

Each task includes:

- taskId/taskKey
- title
- assignedAgentId
- description
- dependencies
- expectedOutput
- status
- result
- startedAt
- completedAt
- error

MVP execution:

- Store DAG structure.
- Execute sequentially at first.
- Keep executor API ready for future concurrency.

## 14. Realtime Events

Use SSE plus DB polling fallback.

Core events:

- `run.started`
- `plan.created`
- `task.started`
- `agent.output.delta`
- `agent.output.completed`
- `tool.invoked`
- `task.completed`
- `task.failed`
- `lead.review.started`
- `result.created`
- `feedback.requested`
- `revision.proposed`
- `revision.approved`
- `revision.rejected`

RunEvent is append-only.

Large payload policy:

- Do not store huge contents directly in RunEvent or ToolCall.
- Store large body content as artifacts.
- Store path, summary, and metadata in DB.

## 15. Feedback Loop

Feedback submission includes:

- Result feedback score and optional custom text.
- Per-Agent feedback score and optional custom text.

Use a FeedbackBatch because one feedback submission creates multiple Feedback rows.

After feedback:

1. Lead Agent analyzes feedback and reports.
2. Lead proposes new `AGENTS.md` and `team.json` contents.
3. System computes diffs against current TeamRevision.
4. User approves or rejects.
5. Approval creates a new TeamRevision.

TeamRevision should preserve:

- Version
- Agents MD snapshot
- Team JSON snapshot
- sourceRunId
- feedbackBatchId
- proposedBy
- approvedBy
- reason
- createdAt

Low ratings should not automatically rewrite an Agent after one bad Run. Strong changes should require repeated feedback or explicit user comments.

## 16. Model Catalog

Models are loaded from DB seeded by root `models.json`.

Fields:

- displayName
- provider
- modelId
- endpointType
- costTier
- speedTier
- enabled
- recommendedUse

The code must be ID-agnostic.

Model availability:

- A bad provider key should mark only that provider's models unavailable.
- Other providers should keep working.
- Availability failures should not crash the app.

## 17. Secrets and Settings

Priority:

1. Settings UI stored value
2. `.env.local`
3. `.env`
4. unset

Storage:

- Try OS keychain first.
- If unavailable, use AES-GCM SQLite fallback.
- Fallback is local obfuscation, not strong security.

Rules:

- Never show full API keys in UI.
- Never log plaintext keys in RunEvent, ToolCall, or error logs.
- Redact known secrets before persistence.

## 18. Out of Scope for MVP

- Inter-team collaboration.
- Vector embedding Team search.
- Code execution tools.
- Shell/git tools.
- Python worker.
- Multi-user auth.
- SaaS deployment.
- WebSocket-based bidirectional control.
- Complex Agent analytics.

## 19. Acceptance Criteria

MVP is acceptable when:

- Phase 0 through Phase 5 pass their verification gates in `IMPLEMENTATION.md`.
- A full local happy path can run from prompt to approved TeamRevision.
- Workspace path safety prevents external file access.
- Secrets are redacted from DB/log/event surfaces.
- `AGENTS.md`, `team.json`, reports, and artifacts are generated under the expected project path.
- The app builds successfully.

