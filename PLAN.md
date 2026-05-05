# Harness Agents — Multi-Agent Team Web App

## Context

사용자는 자기 워크플로우에 맞춰 **목적별 Agent 팀**을 구성하고 재사용할 수 있는 **로컬-우선 웹 애플리케이션**을 만들고자 한다. 기존 단일-에이전트 채팅 인터페이스의 한계는 (1) 작업이 모호한 채로 시작되어 결과 품질이 낮고, (2) 한번 잘 굴러간 구성이 휘발되어 다음에 다시 똑같은 셋업을 반복해야 한다는 점이다.

이 앱은 그 두 문제를 다음으로 해결한다:
1. **PO Agent**가 사용자 요청을 받아 5~6개의 동적 선택형 질문으로 요구사항을 구체화
2. **5명 내외의 Agent로 구성된 팀**(책임자 1명 포함)이 DAG 기반으로 협업해 산출물 생성
3. **AGENTS.md / team.json**으로 팀을 영속화하여 재호출 가능
4. 사용자 피드백이 팀 메타에 누적되어 시간이 갈수록 정교해짐

목표 단계: **로컬 단일 사용자 MVP** → 검증 후 **SaaS 확장**.

작업 위치: `C:\Users\amole\Desktop\Harness_Agents` (현재 비어있음, 전체 신규 구축).

---

## Tech Stack (확정)

- **Framework**: Next.js 16 (App Router) + TypeScript + Tailwind CSS
- **DB**: SQLite + Prisma ORM (DB가 source of truth)
- **LLM 인터페이스**: Vercel AI SDK (`ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `ollama-ai-provider`)
- **Worker**: Node 백그라운드 워커. MVP는 단일 프로세스 in-memory 큐로 시작하고 큐 인터페이스만 분리(추후 BullMQ로 교체 용이)
- **Realtime**: SSE (Next Route Handler) + DB polling fallback. WebSocket 미사용
- **Markdown 렌더링**: `react-markdown` + `remark-gfm`
- **Diff 뷰**: `diff` + `react-diff-viewer-continued`
- **Secrets**: OS keychain (`keytar`) → 실패 시 AES-GCM 암호화 SQLite fallback
- **Python worker**는 코드 실행 도구가 도입될 때만 별도 프로세스로 (MVP 미사용)

---

## Domain Model

```
Project (도메인/주제)
  └─ Team (재사용 가능한 Agent 세트)
        ├─ AGENTS.md (사람이 읽는 역할 정의)
        ├─ team.json (구조화 메타: tags, domain, agents[], leadAgentId)
        └─ Run (1회 작업 사이클)
              ├─ run.json (실행 메타)
              ├─ plan.md (Lead가 만든 DAG plan)
              ├─ result.md (최종 산출물)
              ├─ report.md (결과물에 대한 보고서)
              ├─ agent-reports/{agentId}.md (에이전트별 수행 보고)
              └─ artifacts/ (Run 산출 파일)
```

**핵심 원칙**: DB가 source of truth, MD/JSON 파일은 사용자가 읽고 백업하는 export/cache.
한 Run은 하나의 Team에만 귀속됨 (MVP). Run artifact/report는 추후 다른 Team이 참조 가능한 구조로 저장만 함 — 실제 inter-team 호출 기능은 미구현(roadmap).

---

## DB Schema (Prisma 모델 개요)

날짜 필드는 ISO 8601 UTC. 예: `2026-05-05T09:30:00Z`.

> **SQLite 제약**: Prisma + SQLite는 `String[]` 같은 scalar list를 지원하지 않는다. 아래 표기 중 array 형태(`tags`, `toolsAllowed`, `dependencies` 등)는 **모두 `Json` 타입으로 저장**(Prisma `Json`, 내부값은 `string[]`). `payload`/`args`/`result`/`options`는 처음부터 `Json`. 자세한 적용은 본 문서 하단 **Implementation Revisions (Pre-Build) #5** 참조.

```
Project           id, name, description, tags(Json:string[]), createdAt
Team              id, projectId, name, domain, tags(Json:string[]), leadAgentId, currentRevisionId, score, runCount
TeamRevision      id, teamId, version, agentsMdSnapshot, teamJsonSnapshot,
                  sourceRunId, feedbackBatchId?, proposedBy, approvedBy, reason, createdAt
Agent             id, teamId, name, role, modelId, systemPrompt, toolsAllowed(Json:string[]), score, createdAt
Run               id, teamId, projectId, userPrompt, status, startedAt, completedAt
QaSession         id, runId, status (collecting | done)
QaQuestion        id, qaSessionId, ordinal, prompt, options(Json, 6개), status (active | answered | stale)
QaAnswer          id, questionId, choiceIndex, customText, isAutoJudged
ExecutionPlan     id, runId, dagJson(Json)
Task              id, planId, taskKey, title, assignedAgentId, description,
                  dependencies(Json:string[]), expectedOutput, status, result, error, startedAt, completedAt
RunEvent          id, runId, type, payloadSummary(Json, ≤capped), payloadArtifactId?, createdAt   -- append-only
ToolCall          id, taskId, agentId, tool, argsSummary(Json, ≤capped), resultSummary(Json, ≤capped),
                  argsArtifactId?, resultArtifactId?, reason, createdAt
Artifact          id, runId, taskId?, path, kind, sizeBytes
FeedbackBatch     id, runId, createdAt    -- result feedback + agent별 feedback을 하나의 batch로 묶음
Feedback          id, runId, batchId, kind (result | agent), targetAgentId?, score(1-5), customText, createdAt
AgentRating       id, agentId, runId, score, createdAt    -- 최종 평가
ModelCatalog      id, displayName, provider, modelId, endpointType, costTier, speedTier, enabled, recommendedUse
SecretStore       id, key, encryptedValue, masked, createdAt    -- keychain 사용 시 비어있음
```

`run_events`는 append-only이며 SSE 이벤트 소스 + 새로고침 시 재생용. payload가 커질 경우(token delta 누적, tool result 등) DB에는 capped 요약만 두고 본문은 `Artifact`로 분리한다 (Revisions #12).

---

## 주요 워크플로우

### A. New Task Flow (신규 팀 구성 경로)
1. 사용자가 프롬프트 입력 + (선택) **PO 모델 선택**
2. PO Agent가 프롬프트 분석 → 첫 번째 질문 카드 스트리밍 생성
3. **PO Q&A 카드 UI**:
   - 화면 중앙에 현재 질문 카드, 상단 진행 바 (`2 / 6`)
   - 6 선택지: 1~4 PO 생성 / 5 AI 자동 판단 / 6 직접 입력
   - 좌측 timeline에서 이전 질문/답변 접힌 형태로 표시, **이전 답변 수정 가능**
   - 이전 답변 변경 시 이후 질문은 `stale` 표시 + 재생성 버튼
   - 스킵 = 5번(AI 자동 판단)
4. 모든 답변 완료 → PO가 두 가지 동시 생성:
   - (a) 기존 Team recall 추천 (top N, 키워드/태그/메타 기반, `TeamSearchService` 인터페이스로 분리하여 추후 임베딩 교체)
   - (b) 신규 Team 구성안 (5명 내외, 1명 책임자, 각 에이전트의 modelId 추천)
5. 사용자는 추천/신규 중 선택 + Agent별 모델 변경 + 의견 수정 (PO와 채팅으로 조정)
6. 확정 시 Team 생성 → AGENTS.md / team.json 작성
7. **Run 시작** → Lead Agent가 DAG `ExecutionPlan` 생성 → Tasks 실행
8. 각 Task: SSE로 토큰 스트리밍, run_events에 기록
9. 작업 중 Agent가 사용자 입력 필요 → Lead가 취합해 단일 질문으로 사용자에게 요청 (UI는 PO Q&A와 동일 카드 컴포넌트 재사용)
10. Lead가 모든 결과 통합/검수 → result.md / report.md / agent-reports/* 생성
11. **피드백**:
    - 결과물: 6선택지(매우 나쁨~매우 좋음 + 직접 입력)
    - Agent별: 2x3 그리드, 좌(수행 내용) + 우(피드백) 분할
12. Lead가 피드백 분석 → AGENTS.md / team.json **업데이트 제안 diff** 생성 → 사용자 승인 시 새 `TeamRevision` 추가 (이전 버전 보존, sourceRunId/feedbackId/changedBy/reason/createdAt 기록)
13. 만족 시 사용자가 Agent별 최종 `AgentRating` 부여

### B. Existing Team Recall Flow
1. 사용자 프롬프트 입력
2. PO가 적합 팀 추천 (top N) — teamId/teamName/소속 project/주요 도메인/Agent 구성 요약/최근 평가/관련 과거 작업/추천 이유/confidence score/필요 보강 제안 포함
3. 사용자가 추천 팀 중 선택하거나 새 팀 생성 선택
4. 선택된 팀의 Lead Agent가 요청 분석 → 보강 필요 시 사용자 확인
5. 이후 A의 7~13 단계 진행

---

## 주요 서브시스템

### 1) Model Catalog (`models.json` + DB seed)
- 코드는 ID-agnostic. Provider adapter는 runtime model availability check 수행
- 실패 시 해당 모델만 `unavailable` 표시, 앱 죽지 않음
- 필드: `displayName, provider, modelId, endpointType, costTier, speedTier, enabled, recommendedUse`
- 시드: 실재 모델만 (Claude opus-4-7/sonnet-4-6/haiku-4-5, OpenAI 실재 ID, Ollama 실재 모델)
- Settings UI에서 추가/수정/비활성화

### 2) Tool Registry & Permission Layer (`src/lib/tools/`)
MVP 허용 도구 (workspace 내부로 한정):
- `fs.readFile(path)` — `projects/{projectId}/...` 내부만
- `fs.writeFile(path, content)` — 동일 sandbox
- `fs.listDir(path)`
- `markdown.writeReport(target, content)`
- `web.search(query)` — 옵션, 기본 비활성화

**금지**: shell, code execution, git, workspace 외부, system command.

구조: `Tool` 인터페이스 + `ToolRegistry.register()` + `PolicyEngine.canCall(agentId, toolName)`. 모든 호출은 `ToolCall`에 (agentId, tool, args, reason) 기록.

### 3) DAG Executor
- `Task` 노드: `taskId, title, assignedAgentId, description, dependencies[], expectedOutput, status, result, startedAt, completedAt, error`
- 의존성 없는 작업은 병렬 가능, 의존성 있으면 선행 완료 대기
- MVP 1차: 데이터 모델은 DAG, 실행은 순차로 시작 가능. 단 UI/스토리지는 병렬 지원 (concurrency 토글로 추후 활성화)
- Lead가 모든 결과 검토(충돌/누락/중복)

### 4) PO Q&A Service
- 동적 질문 생성: 이전 답변을 컨텍스트로 다음 질문 스트리밍
- 답변 수정 시 후속 질문에 `stale=true` 마킹, 재생성 트리거 노출
- 스킵 → 5번(자동 판단) 자동 선택

### 5) Feedback → Team Update Loop
- Run 종료 후 Lead Agent가 feedback + agent-reports 분석
- AGENTS.md / team.json 업데이트 **제안 diff** 생성
- 사용자 승인된 변경만 `TeamRevision`에 새 버전으로 저장
- 메타: `sourceRunId, feedbackId, changedBy, reason, createdAt`

### 6) Realtime Layer
- `GET /api/runs/:id/events` (SSE) — `run_events` 스트림
- 이벤트: `run.started, plan.created, task.started, agent.output.delta, agent.output.completed, task.completed, task.failed, lead.review.started, result.created, feedback.requested`
- 클라이언트 재접속 시: DB에서 마지막 N 이벤트 로드 → SSE 재구독
- SSE 단절 시 5초 polling fallback

### 7) Secrets & Settings
- 우선순위: Settings UI > `.env.local` > `.env` > unset
- 저장: `keytar` 시도 → 실패 시 AES-GCM 암호화 SQLite (`SecretStore`)
- UI에 마스킹 표시 (`sk-...abcd`), 삭제 가능
- 로그 redaction (`secretRedactor` 미들웨어) — run_events / error log / 서버 로그 전 영역
- 키 항목: OpenAI, Anthropic, Ollama base URL, 기본 모델, provider enabled

---

## 파일/디렉토리 구조

```
Harness_Agents/
├─ apps/web/                         (Next.js 16 app)
│  ├─ app/
│  │  ├─ (marketing)/page.tsx
│  │  ├─ projects/page.tsx
│  │  ├─ projects/[projectId]/page.tsx
│  │  ├─ projects/[projectId]/teams/[teamId]/page.tsx
│  │  ├─ runs/new/page.tsx           (PO Q&A 카드 UI)
│  │  ├─ runs/[runId]/page.tsx       (실행/스트리밍/결과)
│  │  ├─ runs/[runId]/feedback/page.tsx
│  │  ├─ teams/library/page.tsx
│  │  ├─ settings/page.tsx
│  │  └─ api/
│  │     ├─ runs/route.ts
│  │     ├─ runs/[runId]/events/route.ts        (SSE)
│  │     ├─ runs/[runId]/feedback/route.ts
│  │     ├─ qa/[sessionId]/answer/route.ts
│  │     ├─ teams/recommend/route.ts
│  │     ├─ models/route.ts
│  │     └─ secrets/route.ts
│  ├─ src/
│  │  ├─ lib/
│  │  │  ├─ providers/                (openai/anthropic/ollama adapters)
│  │  │  ├─ models/catalog.ts
│  │  │  ├─ tools/                    (registry + sandbox fs + policy)
│  │  │  ├─ agents/po.ts
│  │  │  ├─ agents/lead.ts
│  │  │  ├─ agents/runtime.ts
│  │  │  ├─ dag/executor.ts
│  │  │  ├─ feedback/diff.ts
│  │  │  ├─ search/teamSearch.ts      (interface + keyword impl)
│  │  │  ├─ secrets/store.ts          (keytar→sqlite fallback)
│  │  │  ├─ events/sse.ts
│  │  │  └─ workspace/paths.ts        (projects/{id}/teams/{id}/runs/{id})
│  │  ├─ components/
│  │  │  ├─ qa/QuestionCard.tsx
│  │  │  ├─ qa/Timeline.tsx
│  │  │  ├─ run/RunStream.tsx
│  │  │  ├─ run/AgentReportPane.tsx
│  │  │  ├─ feedback/ResultFeedback.tsx
│  │  │  ├─ feedback/AgentFeedbackGrid.tsx
│  │  │  ├─ team/TeamComposer.tsx
│  │  │  └─ team/RevisionDiffViewer.tsx
│  │  └─ types/
│  ├─ prisma/schema.prisma
│  └─ package.json
├─ projects/                         (런타임 생성, gitignored)
├─ models.json                       (시드)
├─ .env.example
└─ README.md
```

---

## UI 스크린

1. **Home / Projects** — 프로젝트 목록 + 새 Run 시작 CTA
2. **New Run** — 프롬프트 입력 + PO 모델 선택 → PO Q&A 카드 화면
3. **Team Composition Review** — PO 추천 팀 + 신규 팀 옵션, agent별 모델 선택, AGENTS.md 미리보기
4. **Run Detail** — 좌측: DAG 시각화 (노드 상태) / 중앙: 활성 Agent 출력 SSE 스트림 / 우측: 산출물 트리
5. **Feedback** — 결과 6선택지 + 2x3 Agent 그리드 (좌측 수행내용 / 우측 피드백)
6. **Team Library** — 모든 팀, 도메인 태그 필터, AgentRating 평균
7. **Team Detail** — AGENTS.md 렌더링 + Revision History + Run 이력
8. **Settings** — API keys (마스킹) + Model Catalog 관리

---

## 구현 단계

**Phase 0 — 골격** (1~2일)
- Next.js 16 프로젝트 초기화, Tailwind, Prisma 설정
- DB 스키마 정의 + 마이그레이션
- `.env.example`, models.json 시드, Settings UI 최소버전

**Phase 1 — Provider & Tool Foundation** (2~3일)
- OpenAI/Anthropic/Ollama adapter (Vercel AI SDK 위)
- Model catalog 동적 로딩 + 가용성 체크 + unavailable UI
- Tool Registry + sandbox fs + ToolCall 로깅
- Secrets store (keytar → SQLite fallback)

**Phase 2 — PO Q&A** (2~3일)
- PO Agent + 동적 질문 생성 (스트리밍)
- QuestionCard / Timeline / 진행 바 / 답변 수정 + stale 처리
- QaSession/QaQuestion/QaAnswer 영속화

**Phase 3 — Team Composition** (2일)
- 팀 구성안 생성 (PO)
- 기존 팀 recall (`TeamSearchService` keyword 구현)
- TeamComposer UI + 모델 선택 + AGENTS.md 생성

**Phase 4 — DAG Executor & Run** (3~4일)
- Lead가 DAG plan 생성
- Task runner (의존성 정렬, 순차 실행 → 추후 병렬)
- run_events append, SSE 엔드포인트
- RunStream UI + DB polling fallback

**Phase 5 — Result & Feedback** (2~3일)
- result.md / report.md / agent-reports 생성
- ResultFeedback / AgentFeedbackGrid UI
- Lead 분석 → AGENTS.md / team.json **diff 제안** → 승인 → TeamRevision

**Phase 6 — Recall 경로** (1~2일)
- 기존 팀 호출 시 Lead 분석 → 보강 제안 → 7~13단계 재사용

**Phase 7 — Polish** (2일)
- Team Library 화면, AgentRating, Run history
- Log redaction 검증, 에러 경계, 성능 다듬기

---

## Out of Scope (Roadmap)

- **Inter-team collaboration** — Team A → Team B 호출/위임. MVP에서 한 Run은 하나의 Team에만 귀속. Run artifact/report는 추후 다른 Team이 참조 가능한 구조로만 저장
- Vector embedding 기반 team search (`TeamSearchService` 인터페이스만 분리)
- 코드/shell/git 실행 도구 (Tool Registry에서 추후 등록)
- Python worker (Agent 도구가 강하게 요구할 때 도입)
- Multi-user auth / SaaS 배포
- 양방향 WebSocket / 실시간 사용자 인터럽트

---

## Verification

**E2E 시나리오**:
1. `pnpm install && pnpm prisma migrate dev && pnpm dev` 후 `/settings`에서 API 키 입력 → 모델 카탈로그가 `available`로 표시되는지 확인
2. `/runs/new`에 프롬프트 입력 → PO Q&A 카드 6개까지 스트리밍, 2번 질문에서 5번(자동 판단) 선택 → 답변 후 1번 질문으로 돌아가 수정 → 이후 카드들이 `stale` 표시되는지 확인
3. 신규 팀 구성안 표시 → 한 Agent의 모델을 변경 → 확정 → AGENTS.md / team.json이 `projects/{pid}/teams/{tid}/`에 생성되는지 확인
4. Run 시작 → SSE로 task.started / agent.output.delta 이벤트 수신 확인 → 새로고침 시 DB로부터 복원되는지 확인
5. result.md / report.md / agent-reports/* 생성 확인
6. 결과 피드백 + Agent별 피드백 입력 → Lead가 AGENTS.md 업데이트 diff 제안 → 승인 → 새 TeamRevision row 생성 + 이전 버전 보존 확인
7. 새 Run을 비슷한 프롬프트로 시작 → PO가 기존 팀 recall 추천에 노출하는지 확인
8. ToolCall 테이블에 모든 도구 호출이 (agentId, reason)와 함께 기록되는지 확인
9. workspace 외부 경로 쓰기 시도 → PolicyEngine이 거부하고 에러 이벤트 발생 확인
10. API 키를 잘못 입력 → 해당 provider 모델만 unavailable, 다른 provider는 정상 동작 확인
11. 로그/run_events에 API 키 평문이 남지 않는지 grep으로 검증

---

## 핵심 생성 파일

- `apps/web/prisma/schema.prisma` — 위 DB 스키마
- `apps/web/src/lib/providers/{openai,anthropic,ollama}.ts` — adapter
- `apps/web/src/lib/models/catalog.ts` — runtime catalog
- `apps/web/src/lib/tools/registry.ts` + `policy.ts` + `fsTools.ts`
- `apps/web/src/lib/agents/po.ts` + `lead.ts` + `runtime.ts`
- `apps/web/src/lib/dag/executor.ts`
- `apps/web/src/lib/secrets/store.ts`
- `apps/web/src/lib/search/teamSearch.ts`
- `apps/web/app/runs/new/page.tsx` + `runs/[runId]/page.tsx`
- `apps/web/app/api/runs/[runId]/events/route.ts` (SSE)
- `apps/web/src/components/qa/*` + `feedback/*` + `team/*`
- `models.json` 시드
- `.env.example`
- `README.md`

---

## Implementation Revisions (Pre-Build)

> 사용자 승인일 2026-05-05. 본 섹션의 항목들은 위 본문과 충돌 시 **여기 우선**한다.

### 1. Prisma migrations are committed
- `apps/web/prisma/migrations/` 디렉토리는 **반드시 git에 커밋한다.** `.gitignore`에 `prisma/migrations/*` 패턴을 넣지 않는다.
- DB 파일만 ignore: `dev.db`, `*.db-journal`, `*.db-wal`, `*.db-shm`.
- `.gitignore`는 다음 경로만 ignore: `node_modules/`, `.next/`, `.env`, `.env.local`, `*.db`, `*.db-journal`, `*.db-wal`, `*.db-shm`, `projects/`, `.DS_Store`.

### 2. DATABASE_URL is schema-relative
- `apps/web/prisma/schema.prisma` 기준으로 **`DATABASE_URL=file:./dev.db`** 사용. 실제 위치: `apps/web/prisma/dev.db`.
- `file:./apps/web/prisma/dev.db` 는 **금지** — 실행 cwd에 따라 nested path 가 됨.
- `.env.example`에 위 값으로 작성하고 README의 setup 단계에 명시한다.

### 3. Next.js 16 — `typedRoutes` is stable
- `next.config.ts`에 `experimental.typedRoutes` 가 아니라 **루트 레벨 `typedRoutes: true`** 사용.

### 4. Default Project for `/runs/new`
- MVP에서는 첫 부팅/마이그레이션 시 자동으로 `Default Project` 1개 생성 (예: seed).
- `/runs/new`는 별도 Project 선택 UI 없이 새 Run을 자동으로 Default Project에 귀속.
- Project 선택/생성 UI는 Phase 7(Polish) 또는 그 이후 add. Schema는 그대로 유지(이미 `Run.projectId` 존재).

### 5. SQLite scalar lists → `Json`
- Prisma + SQLite는 `String[]` 같은 native list를 **지원하지 않는다.** Phase 0 migration이 깨지지 않도록 다음 필드는 모두 `Json` 타입으로 정의하고 내부값은 `string[]`로 직렬화:
  - `Project.tags`, `Team.tags`, `Agent.toolsAllowed`, `Task.dependencies`
- 처음부터 `Json`인 필드: `QaQuestion.options`, `RunEvent.payloadSummary`, `ToolCall.argsSummary` / `resultSummary`, `ExecutionPlan.dagJson`.
- TypeScript 레이어에 `parseStringArray(json)` / `stringifyStringArray(arr)` helper 두고 모델 경계에서 변환.
- **Phase 0 게이트**: `pnpm prisma migrate dev` 가 깨끗이 통과하는 것을 Phase 0 종료 조건으로 한다. 통과하지 못하면 Phase 1로 넘어가지 않는다.

### 6. Ollama provider — fixed choice
- 패키지명 `ollama-ai-provider` 는 모호하므로 다음 중 **하나로 고정**:
  - **1순위 (기본):** `@ai-sdk/openai-compatible` + Ollama OpenAI 호환 엔드포인트 `http://localhost:11434/v1`
  - **2순위 (필요시):** AI SDK community provider `ollama-ai-provider-v2` 또는 `ai-sdk-ollama`
- availability check 는 native Ollama `GET /api/tags` 사용 (OpenAI 호환 경로보다 가볍고 정확).
- `apps/web/src/lib/providers/ollama.ts` 상단 주석에 어느 옵션을 선택했는지/이유 기록.

### 7. Split `runtime.complete`
- 단일 `runtime.complete` 함수로 묶지 않고 다음 3개로 분리:
  - `runtime.streamText({ model, messages, tools? })` — 토큰 스트리밍
  - `runtime.generateObject({ model, schema, messages })` — Zod 스키마 기반 structured output. PO Q&A 다음 질문 생성 / Team Composition / DAG plan / feedback diff 제안에 사용.
  - `runtime.checkModelAvailability(modelId)` — provider 별 ping (Ollama `/api/tags`, OpenAI `/v1/models`, Anthropic `/v1/models`)
- 위 3개는 `apps/web/src/lib/agents/runtime.ts`에서 export.

### 8. Separate workspace export from Agent tools
- `markdown.writeReport` 같은 Agent tool로 시스템 산출물을 쓰지 **않는다.**
- 별도 계층 `apps/web/src/lib/workspace/exportService.ts` (`WorkspaceExportService`) 신설. 다음 파일 생성/갱신은 모두 이 계층에서:
  - `AGENTS.md`, `team.json`, `run.json`, `plan.md`, `result.md`, `report.md`, `agent-reports/{agentId}.md`
- Agent가 직접 호출한 도구만 `ToolCall` 테이블에 기록. 시스템 export는 `RunEvent` 의 `system.export.*` 타입으로 별도 audit 이벤트에 기록 (`type=system.export.written`, `payloadSummary={path, kind, sizeBytes}`).
- Tool registry 의 `markdown.writeReport` 는 **삭제** 또는 agent-facing 메모 작성 전용으로 좁힘 (sandbox 내부 노트만).

### 9. Feedback batching
- Run 종료 시 result feedback 1개 + agent별 feedback N개가 한 번에 들어옴 → **`FeedbackBatch`** 모델 신설.
- `Feedback.batchId` (FK → `FeedbackBatch.id`) 추가. 같은 batchId 의 feedback 들이 한 묶음.
- `TeamRevision.feedbackBatchId` (`FeedbackBatch.id`) 로 연결. 단일 `feedbackId` 는 폐기.

### 10. TeamRevision provenance
- `TeamRevision`은 다음 필드를 가짐:
  - `proposedBy` (`'lead-agent' | 'po-agent' | 'user'`)
  - `approvedBy` (`'user'` — 항상 사람의 승인이 있어야 새 revision 생성)
  - `sourceRunId`
  - `feedbackBatchId?`
  - `reason` (자유 텍스트, Lead의 변경 이유 또는 사용자 메모)
- `RunEvent`에는 `team.revision.proposed` (Lead diff 생성 시) 와 `team.revision.approved` (사용자 승인 시) 가 모두 기록되어 감사 가능.

### 11. Secret fallback security disclosure
- keytar 우선, 실패 시 AES-GCM + `~/.harness-agents/secret.key` (또는 OS app data) fallback. **이는 강한 보안이 아니라 "local obfuscation fallback" 수준.**
- README와 Settings UI 의 Secret 섹션에 **명시적으로 표시**: "Local fallback only — not strong encryption. Production use should rely on OS keychain (keytar)."
- POSIX: 키 파일 `0600` 시도. **Windows**: chmod 0600 은 의미 없음 → keytar(Credential Manager) 우선 사용 강제. keytar 실패 시 Windows ACL `icacls` 로 현재 사용자만 읽기 가능하게 시도하고, 실패해도 앱은 동작하되 UI에 경고 노출.
- 로그/run_events redaction 은 secret 값에 한정.

### 12. RunEvent / ToolCall payload size limits
- DB row 의 payload 는 **고정 cap (예: 4 KB)** 를 넘지 않도록 enforce:
  - 토큰 streaming delta: row 마다 누적하지 않고 **rolling window**(예: 256 chars) 만 저장. 전체 출력은 task 종료 시 `Artifact` 로 dump.
  - tool result: `result` 가 1 KB 초과 시 `resultSummary`(첫/끝 N자 + size) 만 저장하고 본문은 `Artifact` 로 분리.
- 신규 `Artifact.kind`: `event-payload`, `toolcall-args`, `toolcall-result`.
- `RunEvent.payloadArtifactId` / `ToolCall.{args,result}ArtifactId` (nullable) 로 연결.

### 13. SQLite WAL
- 앱 부팅 시(또는 Prisma `$connect` 직후) `PRAGMA journal_mode=WAL;`, `PRAGMA synchronous=NORMAL;`, `PRAGMA busy_timeout=5000;` 적용.
- 위치: `apps/web/src/lib/db/client.ts` Prisma client wrapper의 init.
- `*.db-wal`, `*.db-shm` 는 `.gitignore` 대상 (Revisions #1).

### 14. In-memory queue scope
- Phase 4 의 in-memory queue 는 **local single-process MVP 전용.**
- Next dev/HMR 또는 프로세스 재시작 시 in-flight Run 은 시작 시 `status='failed'`(`error='process_restart'`) 로 마킹 후 사용자에게 재시도 옵션 노출.
- `apps/web/src/lib/queue/inMemory.ts` 상단 주석에 다음 명시:
  ```
  // SCOPE: Local MVP only. Single Node process, in-memory queue.
  // SaaS/deployment MUST replace this with BullMQ + Redis (or similar
  // durable queue) before serving multiple users or surviving restarts.
  ```
- Queue 인터페이스(`QueueDriver`)만 분리해두면 교체 시 호출부 변경 없음.

---

### Phase 0 acceptance gate (revised)

Phase 0 종료 조건에 다음 추가:
- `pnpm prisma migrate dev --name init` 이 깨끗이 통과 (Revisions #5)
- `apps/web/prisma/migrations/<timestamp>_init/` 가 git에 커밋됨 (Revisions #1)
- 부팅 직후 SQLite `PRAGMA journal_mode` 가 `wal` 로 보고됨 (Revisions #13)
- `Default Project` row 가 seed 단계에서 자동 생성됨 (Revisions #4)
