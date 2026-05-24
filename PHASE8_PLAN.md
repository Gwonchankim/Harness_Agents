# Phase 8 — Partial Resume & Provider Backoff (상세 구현 계획)

> 상태: **계획 초안 — 2026-05-25. 코드 변경 없음.** (조사 기반, 승인 대기)
> 기준: `main` (Phase 5) + `phase-6-reuse-history-ux`(Phase 6) + `phase-7-run-control`(Phase 7, 구현/검증 완료).
> 원칙(불변): **DB = source of truth**, md/json = export/cache. 파일 1개 = 책임 1개.
> **스키마 마이그레이션 0건 목표. 새 dependency 0건 목표.** Phase 6/7 흐름(`/runs`·`/teams`·retry·cancel)을 깨지 않는다.

---

## 승인 후 확정 결정사항 (2026-05-25)

1. **task-level retry 범위 = failed/cancelled 대상만.** done task 강제 재실행 + 전이 downstream 무효화는 **Phase 9로 연기**. (run-level resume = 모든 failed/cancelled 리셋; task-level retry = 그 task 리셋, 둘 다 done 보존·재사용.)
2. **backoff = rate_limit(2회) + timeout(1회)만.** auth/schema/model_not_found/provider_unavailable/unknown은 즉시 실패. abort 가능, `HARNESS_TASK_RETRY_*` env 조정.
3. **UI = Resume 1차 CTA, "Retry from scratch"(clone) 2차** (resumable인 failed run에서). 기본값 확정.
4. **executor 구조 = per-task 본문 `runOneTask`로 추출**해 초기 실행·executeResume·backoff 공유. 행위 100% 보존 + 테스트/스모크로 회귀 차단.
5. **출력 중복 버그 수정 포함.** `task.started` 수신 시 `taskOutputs[taskKey]=''` 리셋 + `initialReducerState` 시드/replay 일관화(resume 정확성 필수, 기존 done 중복도 해소).

---

## 0. 조사 결과 (사실 기반 — 이 계획의 근거)

### 0-A. executor는 처음부터-실행 전용, resume 경로가 없다

- `lib/dag/executor.ts` `executeInner`는 **`run.status === 'ready'`일 때만** 동작(L113)하고, **항상 새 `ExecutionPlan` + `Task` rows를 생성**(L175-207)한다.
- `ExecutionPlan.runId`는 `@unique`. 같은 run에 두 번째 plan을 만들 수 없다 → **resume를 기존 `executeRun(status=ready)` 경로로 태우면 plan 중복 생성으로 깨진다.** ⇒ resume는 **plan 생성을 건너뛰는 별도 실행 경로**가 필요.
- 실행은 **sequential topo order**(L260 `for (const t of order)`), **첫 task 실패 시 즉시 `return`**(L410). 동시성 1.
- `taskResults`는 **in-memory `Map<taskKey, text>`**(L256). upstream context는 `taskResults.get(dep)`로만 만든다(L315) → **resume 시 이전 attempt의 `done` task 결과를 DB에서 미리 시드하지 않으면 upstream이 비어버린다.**

### 0-B. 실패/취소 시점의 task 상태 분포 (결정적)

- **실패 run**: executor가 첫 실패에서 멈추므로 — topo상 앞 task = `done`, 실패 task 1개 = `failed`, 뒤 task = `pending`(시작도 안 함). `Run.status='failed'`, `failedReason='task_failed:<key>'`.
- **취소 run**(Phase 7): `cancel.ts`가 running/pending → `cancelled`, `done` 보존. `Run.status='failed'`, `failedReason='user_cancelled'`.
- ⇒ **resume = `failed`/`cancelled` task를 `pending`으로 되돌리고, `done`은 보존·재사용, 전체 `pending`을 topo order로 재실행.**

### 0-C. Task / ExecutionPlan 저장 구조

- `Task`: `status`(pending|running|blocked|done|failed|cancelled), `result`(JSON `{text,bytes}`), `error`(redacted str), `dependencies`(JSON `string[]`), `planId`, `agentId`, `taskKey`, `startedAt`, `completedAt`. `@@unique([planId, taskKey])`.
- `ExecutionPlan`: `runId @unique`, `dagJson`, `rationale`. (1 run = 1 plan.)
- 모든 status/이벤트 타입은 free-form `String` → **신규 상태/이벤트 추가에 마이그레이션 불필요.**

### 0-D. retry / cancel / registry 재사용 가능 자산 (Phase 6·7)

- `lib/runs/retry.ts`: `failed` + no plan → in-place `reset`(재계획); `failed` + plan → `clone`(새 run). **resume은 이 둘 사이의 세 번째 전략(plan 재사용 in-place).** retry.ts는 **무변경 유지**(Phase 6 흐름 보존).
- `lib/runs/cancel.ts` + `cancelState.ts` + `runRegistry`(AbortController) + executor `signal.aborted` 가드 + `inFlight` Set → **resume에도 그대로 적용**(취소 가능한 resume).
- `lib/runtime/recovery.ts`: planning/running stale → `failed(process_restart)`. resume 중 프로세스 사망 시 동일 복구 → 이후 다시 resume 가능(done 보존). **충돌 없음.**
- `worker.ts` + `raiseProviderError`(Phase 7): task 단계 오류를 `RateLimitError`/`GenerateTimeoutError`/`ProviderUnavailableError`/`ModelNotFoundError`/`PoAuthError`/`PoSchemaError`로 **정확히 typed** → executor가 **오류 종류별 backoff 판단 가능**(Phase 7이 깔아둔 기반).

### 0-E. UI 렌더 현황 + 잠재 버그

- `RunStream.tsx`: SSE/폴링, reducer가 이벤트로 task/run 상태 갱신. `RUN_EVENT_TYPES`에 등록된 타입만 SSE 수신. Phase 7에서 `run.cancelled` 분기 추가됨.
- `DagGraph.tsx`: status별 색(pending/running/done/failed/blocked/**cancelled**). `AgentReportPane.tsx`: task별 출력 접힘/펼침, `outputs[taskKey]` 사용.
- **잠재 버그(조사로 발견)**: `initialReducerState`가 `outputs[taskKey] = Task.result` 시드 후 동일 task의 `agent.output.delta`를 **다시 누적**(`+= text`) → done task 출력이 **중복**될 수 있음. append-only 이벤트 + **resume(다중 attempt)** 에서 attempt-1 + attempt-2 delta가 이어붙어 **악화**. ⇒ resume 정확 표시를 위해 **`task.started` 수신 시 해당 taskKey 출력 버퍼를 리셋**하고, 시드/replay 일관화 필요(§7-E).

---

## 1. Phase 8 목표

Phase 7의 cancel/retry/provider-error 분류 위에서:

1. **Partial resume**: `failed`/`cancelled` run을 처음부터가 아니라 **실패 지점부터 이어서 실행**(done task 결과 재사용).
2. **Task-level retry**: 특정 task부터 재실행(+필요 시 downstream 무효화).
3. **Provider backoff**: rate_limit/timeout 같은 일시적 오류에 대해 **task 단위 자동 재시도(지수 backoff)** + 수동 retry 일관화.
4. **스키마 0 / dependency 0 / Phase 6·7 무회귀 / executor 변경 위험 최소화.**

---

## 2. 범위 — 포함 vs 연기

### 2-A. Phase 8 포함

- run-level **resume**(`POST /api/runs/[runId]/resume`): failed/cancelled task → pending, done 재사용, pending 재실행.
- **task-level retry**(`POST /api/runs/[runId]/tasks/[taskId]/retry`): 대상 task(+downstream) 재실행 — 범위는 §3-C 결정에 따름.
- executor **resume 실행 경로**(`executeResume`): plan 생략, done 결과 시드, pending만 실행.
- **provider backoff**(`lib/runs/backoffPolicy.ts` + executor task 재시도 루프): rate_limit/timeout 한정, 횟수·지연 bounded·env 조정·abort 가능.
- **순수 모듈**: `resumePlan.ts`(재시작 대상 계산), `downstream.ts`(DAG 역방향 의존), `backoffPolicy.ts`.
- UI: `ResumeRunButton`, RunStream `run.resumed` 처리 + 출력 버퍼 리셋, run-detail의 `canResume` 계산, (선택) DagGraph task별 "여기부터 재시도".
- failureClass/RunEvent audit 확장.

### 2-B. Phase 9 이후로 연기 (명시)

- **done task 강제 재실행 + 전이 downstream 무효화**(정보가 멀쩡한 done을 일부러 다시 돌리는 케이스) — §3-C 결정에서 제외 시.
- `Retry-After` 헤더 정밀 파싱(현재는 지수 backoff + jitter).
- **동시성 >1**(독립 task 병렬). 현 sequential 유지.
- 부팅 시 **자동 resume**(현재는 수동 트리거).
- per-task attempt-count **DB 영속화**(현재는 RunEvent payload audit로만).

---

## 3. 핵심 설계 결정 (추천안 + 근거)

### 3-A. resume 가능/불가능 조건

**가능(resumable)**: `Run.status === 'failed'` **AND** `ExecutionPlan` 존재 **AND** `done` task ≥ 1 **AND** non-done(failed/cancelled/pending) task ≥ 1 **AND** topoSort 유효.

**불가능 → 기존 retry로 폴백**:
- plan 없음(planning 단계 실패 `lead_plan_*`) → `retry` reset(재계획).
- done task 0개(plan은 있으나 실행 전 실패, 예 `dag_invalid` 또는 첫 task 즉시 실패) → resume 이득 없음 → reset(재계획) 또는 clone. (resume도 동작하지만 사실상 전체 재실행.)
- topoSort 실패(이론상 없음, 방어적) → clone.

> 가드는 데이터 기반(plan/done 수). failedReason만으로는 부족 → run-detail 서버 컴포넌트가 `canResume`를 계산해 UI에 전달.

### 3-B. 무엇을 재실행할까 — **추천: failed/cancelled → pending, done 보존, 전체 pending 재실행** (decision #1)

- sequential executor라 실패 run은 failed task 1개 + 뒤는 pending(미실행). 따라서 **failed/cancelled task만 pending으로 리셋**하면, 이미 pending인 downstream과 함께 자연히 재실행된다. **downstream을 따로 reset할 필요 없음**(애초에 실행 안 됨).
- done task는 **건드리지 않고 결과 재사용**.
- 리셋 시 해당 task의 `error=null`, `startedAt=null`, `completedAt=null`, `result=null`로 초기화.

### 3-C. task-level retry 범위 — **추천: 대상이 failed/cancelled면 resume와 동일, done 강제 재실행은 downstream 무효화 포함하되 decision으로 게이트** (decision #2)

- **대상 = failed/cancelled task**: 그 task만 pending으로 → resume와 사실상 동일(가장 안전, 흔한 케이스). Phase 8 포함.
- **대상 = done task(강제 재실행)**: 그 task + **전이적 downstream(done인 것 포함)** 을 pending으로 리셋해야 일관성 유지(downstream 입력이 바뀌므로). `downstream.ts`(역방향 BFS, 순수)로 계산. **위험·비용 큼** → Phase 8 포함 여부를 decision으로. **추천: Phase 8은 failed/cancelled 대상만, done 강제 재실행은 Phase 9.**
- 공용 코어: `resumePlan(tasks, {mode})` → 리셋 대상 taskKey 집합 계산(pure). run-level resume = 모든 failed/cancelled. task-level = {대상} ∪ (done 대상이면 전이 downstream).

### 3-D. done 결과를 dependency context로 재사용 — **executeResume가 DB에서 시드**

- `executeResume`는 plan/task rows 로드 후, **`done` task의 `Task.result`(JSON `{text}`)를 파싱해 `taskResults` Map에 미리 시드**. 이후 루프에서 **`done` task는 skip**, pending만 실행. pending task의 upstream 조회는 시드된 done 결과를 사용.
- 일관성: resume에서 재실행되는 건 failed/cancelled(+그 downstream pending)뿐. 이들의 **upstream done 결과는 변하지 않으므로** 컨텍스트 안정적. (done 강제 재실행 케이스만 downstream 무효화 필요 — §3-C.)

### 3-E. cancelled task 처리 — **failed와 동일 취급**

- 취소 run의 `cancelled` task = "사용자가 멈춘 미완료" → resume 시 `pending`으로 리셋해 재실행. `done`은 보존. (단일 가드 `status==='failed'`가 실패·취소 모두 포함.)

### 3-F. executor 구조 — **추천: task 실행 본문을 공용 헬퍼로 추출, executeResume가 공유** (decision #4)

- 현 `executeInner`의 **per-task 실행 블록(L299-411: running 표시 → upstream 구성 → runAgentTask → done/failed 기록 → 이벤트)** 을 `runOneTask(ctx)` 헬퍼로 추출.
- `executeInner`(초기 실행)와 신규 `executeResume`(plan 생략 + done 시드 + done skip)가 **동일 `runOneTask`** 사용 → 중복 제거, backoff 루프도 한 곳.
- 대안: executeResume가 루프를 복제(추출 안 함). 위험 격리는 되나 중복·드리프트. → **추출 추천**, 단 "행위 100% 보존" 원칙 + 테스트/스모크로 회귀 차단.

### 3-G. provider backoff — **추천: rate_limit/timeout 한정 bounded 지수 backoff, abort 가능, env 조정** (decision #3)

- 신규 순수 `lib/runs/backoffPolicy.ts`: `nextBackoff(kind, attempt) → { retry: boolean; delayMs: number }`.
  - `rate_limit` → 최대 2회 재시도(예: 2s, 8s + jitter).
  - `timeout` → 최대 1회 재시도(예: 5s).
  - `provider_unavailable`/`auth`/`schema`/`model_not_found`/`unknown` → 재시도 안 함(대개 영속적; 즉시 실패 → 사용자 edit-models/retry).
  - 횟수·기본 지연은 `HARNESS_TASK_RETRY_*` env로 조정(timeout env 패턴 재사용).
- executor `runOneTask`가 `runAgentTask` 호출을 **재시도 루프**로 감싼다: 오류 → `classifyGenerateError`로 kind 판정 → `nextBackoff` → retry면 **abort 가능한 delay** 후 재시도, 아니면 기존 task_failed 처리.
- **취소 우선**: backoff 대기 중 `signal.aborted`면 즉시 중단(대기 인터럽트). 대기 후에도 abort 체크.
- audit: 재시도마다 `task.retry.attempt`(payload: `{taskKey, attempt, kind, delayMs}`) 이벤트.
- 적용 범위: 초기 실행 + resume **둘 다**(공용 `runOneTask`).

### 3-H. 스키마/의존성 — **결론: 둘 다 0건**

- resume/retry/backoff 전부 기존 free-form 컬럼(`Task.status`, `Run.status`, `Task.result/error`, `RunEvent.type`)으로 표현. 신규 이벤트(`run.resumed`, `task.reset`, `task.retry.attempt`)는 free-form.
- attempt-count는 RunEvent payload로 audit(영속 컬럼 불필요). backoff delay는 `setTimeout`/`Promise`(새 dep 없음). 착수 전 `prisma migrate status` drift 0 확인.

---

## 4. Run / Task 상태 흐름 (resume)

```
failed(task_failed:* | user_cancelled) + plan + done≥1
  │  POST /api/runs/[runId]/resume
  ▼
resume.ts: failed/cancelled tasks → pending(초기화), Run.status='running', failedReason=null, endedAt=null
           + run.resumed 이벤트 + AbortController 등록
  ▼
executeResume(runId, signal): plan 로드 → done 결과 시드 → topo order로 pending만 실행(done skip)
           각 pending task: runOneTask(backoff 포함)
  ▼
성공: result.md/report.md 재생성 + Run.status='succeeded' + run.completed(success)
실패: task_failed:<key> + Run.status='failed' + run.completed(fail)   ← 다시 resume 가능
취소: signal.aborted → cancel.ts가 terminal 기록(Phase 7 그대로)
```

---

## 5. API route 계획 (thin 유지)

| 메서드/경로 | 신규/수정 | 책임 | 위임 lib |
|---|---|---|---|
| `POST /api/runs/[runId]/resume` | **신규** | 가드 → 리셋 → running → executeResume fire(+AbortController 등록) | `lib/runs/resume.ts`, `lib/dag/executor.ts` |
| `POST /api/runs/[runId]/tasks/[taskId]/retry` | **신규** | 단일 task(+downstream) 리셋 → executeResume fire | `lib/runs/resume.ts`(공유), `lib/runs/resumePlan.ts` |
| `POST /api/runs/[runId]/retry` | **무변경** | Phase 6 reset/clone 유지(폴백) | `lib/runs/retry.ts` |
| `POST /api/runs/[runId]/cancel` | **무변경** | resume 중에도 취소 동작(running) | `lib/runs/cancel.ts` |
| `/state`, `/events` | **무변경** | 신규 이벤트 free-form passthrough | — |

> `runtime='nodejs'`, `dynamic='force-dynamic'`, `ensureRecovered()` 컨벤션 유지. resume/task-retry는 start route처럼 컨트롤러 등록 + fire-and-forget + finally clear.

---

## 6. RunEvent audit trail 설계

- `run.resumed` — payload `{ mode: 'auto'|'fromTask', resumedTasks: N, fromTaskKey?: string }`. RunStream이 status→running 전이.
- `task.reset` — payload `{ taskKey, previousStatus }` (리셋된 task별, audit/타임라인용; 선택).
- `task.retry.attempt` — payload `{ taskKey, attempt, kind, delayMs }` (backoff 재시도별).
- 재실행 task는 기존 `task.started`/`agent.output.delta`/`agent.output.completed`/`task.completed`/`task.failed` 재사용.
- append-only 유지: 한 run의 이벤트 로그가 [attempt1 …, run.completed(fail), run.resumed, attempt2 …, run.completed(success)]로 누적. RunStream reducer가 순서대로 적용 → 최종 상태가 최신 attempt 반영(§7-E의 버퍼 리셋 전제).
- `RUN_EVENT_TYPES`에 `run.resumed`(+선택 `task.reset`/`task.retry.attempt`) 추가해 SSE 수신.

---

## 7. 파일 단위 책임 (단일 책임)

### 7-A. 신규 lib (순수 우선)

| 파일 | 책임 | 테스트 |
|---|---|---|
| `src/lib/dag/downstream.ts` | (taskKey, deps[]) → 전이 downstream 집합 (순수, 역방향 BFS) | `downstream.test.ts` |
| `src/lib/runs/resumePlan.ts` | tasks + mode(auto/fromTask) → `{ resetKeys, doneKeys, eligible, reason }` (순수) | `resumePlan.test.ts` |
| `src/lib/runs/backoffPolicy.ts` | `nextBackoff(kind, attempt)` → `{retry, delayMs}` (순수, env 반영) | `backoffPolicy.test.ts` |
| `src/lib/runs/resume.ts` | Prisma 배선: 가드→리셋→running→run.resumed (resumePlan 사용) | (통합은 수동 smoke) |

### 7-B. 신규 API

- `app/api/runs/[runId]/resume/route.ts` — thin.
- `app/api/runs/[runId]/tasks/[taskId]/retry/route.ts` — thin (decision #2 범위).

### 7-C. 신규 UI

- `src/components/run/ResumeRunButton.tsx` — client. POST /resume, resumedTasks 표시, 스트림 재진입.
- (선택, decision #2) `DagGraph` task 항목에 "Retry from here" 액션.

### 7-D. 수정

| 파일 | 변경 |
|---|---|
| `src/lib/dag/executor.ts` | per-task 본문 → `runOneTask` 추출; 신규 `executeResume(runId, signal)`(plan 생략·done 시드·done skip); `runOneTask`에 backoff 재시도 루프 |
| `src/components/run/RunStream.tsx` | `run.resumed` reducer 분기 + `RUN_EVENT_TYPES` 추가; **`task.started` 시 `taskOutputs[taskKey]=''` 리셋**(중복 출력 수정); resume CTA(`canResume`) 렌더; 시드/replay 일관화 |
| `src/lib/runs/failureClass.ts` | (선택) `resumable` 힌트는 데이터 기반이라 failureClass엔 불필요; copy만 소폭(“이어서 재개 가능”) |
| `app/runs/[runId]/page.tsx` | `canResume` 계산(plan/done/non-done 집계)해 RunStream에 전달; tasks select에 status 충분(이미 있음) |
| `src/components/run/RunProgressOverlay.tsx` | resume 중 stage 라벨(“Resuming”) 소폭(선택) |
| `apps/web/package.json` | 신규 `*.test.ts` 등록(downstream/resumePlan/backoffPolicy) |

> **변경하지 않음(원칙)**: `lib/runs/retry.ts`(Phase 6 reset/clone 보존), `lib/runs/cancel.ts`/`cancelState.ts`, `lib/runtime/recovery.ts`, `lib/agents/*`(Phase 7 분류기 그대로 활용), 스키마.

---

## 8. provider timeout/rate_limit backoff 정책 (요약)

| kind | 자동 재시도 | 기본 정책 | 사유 |
|---|---|---|---|
| `rate_limit` | 예 | 2회, 2s→8s(+jitter) | 일시적·곧 해소 |
| `timeout` | 예 | 1회, 5s | 일시적일 수 있음, 과도 재시도 비용 큼 |
| `provider_unavailable` | 아니오 | 즉시 실패 | 대개 키/네트워크 영속 문제 → edit-models |
| `auth`/`schema`/`model_not_found`/`unknown` | 아니오 | 즉시 실패 | 영속적 → 사용자 개입 필요 |

- env: `HARNESS_TASK_RETRY_RATE_LIMIT_MAX`, `HARNESS_TASK_RETRY_TIMEOUT_MAX`, `HARNESS_TASK_RETRY_BASE_MS`(기본값 내장).
- 모든 대기는 abort 가능. 재시도는 `task.retry.attempt` 이벤트로 가시화.

---

## 9. 테스트 계획

### 9-A. 순수 모듈 단위테스트 (신규)

- `downstream.test.ts`: 선형/분기/다이아몬드 DAG에서 전이 downstream 집합 정확성, 순환 방어.
- `resumePlan.test.ts`: auto 모드(failed/cancelled만 reset, done 보존), fromTask 모드(대상+downstream), eligible/reason(plan 없음·done 0·all done) 경계.
- `backoffPolicy.test.ts`: kind별 retry 여부·횟수·지연 단조성·상한, env override.

### 9-B. executor resume — 단위 가능 범위 vs 수동 smoke

- **단위 가능**: resumePlan/downstream/backoffPolicy(순수), failureClass.
- **수동 smoke 전용**(Prisma+AI SDK): done 시드 후 pending만 실행, backoff 실제 동작, run.resumed 이벤트, 출력 버퍼 리셋.

### 9-C. 검증 명령

```powershell
corepack pnpm --filter web typecheck
corepack pnpm --filter web test
apps/web/node_modules/.bin/next.cmd build   # (dev 서버 떠 있으면 prisma generate EPERM → next build 단독)
corepack pnpm --filter web exec prisma migrate status   # drift 0
```

---

## 10. 수동 smoke 시나리오

1. **중간 task 실패 → resume**: 일부러 한 agent를 깨진 모델로 → 앞 task done, 한 task failed → **Resume** → done skip(재실행 안 함) + failed부터 재개 → 성공 시 result.md 정상.
2. **취소 → resume**: 실행 중 Cancel(Phase 7) → done 보존·나머지 cancelled → **Resume** → cancelled가 pending으로 재실행.
3. **rate_limit backoff**: 429 유발 → `task.retry.attempt` 이벤트 + 지수 backoff 후 성공/실패. 대기 중 Cancel → 즉시 중단.
4. **task-level retry**(decision #2 범위): 특정 failed task "여기부터 재시도" → 해당 task(+downstream) 재실행.
5. **resume 중 프로세스 재시작**: running 상태에서 서버 재시작 → recovery가 failed(process_restart) → 다시 resume 가능(done 보존).
6. **출력 중복 회귀**: resume 후 재실행 task 출력이 attempt-1과 이어붙지 않고 최신만 표시(`task.started` 리셋 확인).
7. **회귀**: Phase 6/7 흐름(처음부터 run, clone retry, cancel, edit-models) 무회귀.

---

## 11. 리스크와 완화

- **출력 중복/이벤트 누적**(§0-E): `task.started`에서 버퍼 리셋 + 시드/replay 일관화. resume 전제 조건이므로 우선 처리·smoke 확인.
- **executor 리팩터 위험**(runOneTask 추출): 행위 100% 보존, 초기 실행 경로 회귀 없게 typecheck+test+수동 smoke. 위험 크면 decision #4에서 "복제" 선택지.
- **backoff 비용/지연**: 상한·보수적 기본값·env·abort 가능으로 통제. 영속 오류는 재시도 안 함.
- **done 재사용 일관성**: resume은 failed/cancelled만 재실행(upstream done 불변) → 안전. done 강제 재실행은 downstream 무효화 필요(§3-C, Phase 9 권장).
- **모델 편집 후 resume**: resume은 현재 agent 모델을 로드 → edit-models 후 resume이 자연히 새 모델 사용(의도된 동작).
- **stale agent/plan**: agentId 재해석, 없으면 해당 task 재실패(기존 처리). plan은 불변(재사용).

---

## 12. Phase 9로 미룰 항목

- done task 강제 재실행 + 전이 downstream 무효화(§3-C 제외 시).
- `Retry-After` 정밀 backoff, 동시성 >1, 부팅 자동 resume, per-task attempt 영속화/분석.

---

## 13. 결정 필요 (3~5개, 추천안 우선)

1. **task-level retry 범위**: failed/cancelled 대상만(추천) vs done 강제 재실행+downstream 무효화까지 Phase 8 포함.
2. **backoff 적용 kind**: rate_limit(2회)+timeout(1회), 그 외 미적용(추천) vs provider_unavailable도 포함 vs rate_limit만.
3. **resume vs clone UI 우선순위**: resumable이면 **Resume를 1차**, "Retry from scratch"(clone)를 2차로(추천).
4. **executor 구조**: per-task 본문 공용 헬퍼 추출(추천) vs executeResume 루프 복제(위험 격리).
5. **출력 버퍼 리셋 수정**: `task.started`에서 리셋 + 시드/replay 일관화를 Phase 8에 포함(추천, resume 정확성에 필수) vs 별도.

---

## 14. 산출물 요약

- 신규 lib: `lib/dag/downstream.ts`, `lib/runs/{resumePlan,backoffPolicy,resume}.ts`
- 신규 API: `app/api/runs/[runId]/resume/route.ts`, `app/api/runs/[runId]/tasks/[taskId]/retry/route.ts`
- 신규 UI: `components/run/ResumeRunButton.tsx` (+선택 DagGraph 액션)
- 수정: `lib/dag/executor.ts`(runOneTask 추출 + executeResume + backoff), `RunStream.tsx`(run.resumed + 버퍼 리셋 + canResume), `app/runs/[runId]/page.tsx`(canResume), `package.json`
- 신규 테스트: `downstream.test.ts`, `resumePlan.test.ts`, `backoffPolicy.test.ts`
- **스키마 변경: 0. 새 dependency: 0.**
