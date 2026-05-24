# Phase 9 — Done-Task Re-run & Backoff Hardening (상세 구현 계획)

> 상태: **계획 초안 — 2026-05-25. 코드 변경 없음.** (조사 기반, 승인 대기)
> 기준: `main @ 1f8e5bb` (Phase 8 partial-resume + smoke polish merged).
> 원칙(불변): **DB = source of truth**, md/json = export/cache. 파일 1개 = 책임 1개.
> **스키마 마이그레이션 0건 목표. 새 dependency 0건 목표.** Phase 8 partial resume / provider backoff 흐름을 깨지 않는다.

---

## 승인 후 확정 결정사항 (2026-05-25)

1. **task-level 재실행 = 통합 `rerunFromTask`.** 기존 `/tasks/[taskId]/retry` + `prepareResume`를 일반화. resetKeys = `{target} ∪ transitiveDownstream(target) ∪ {모든 failed/cancelled}`. failed/cancelled target은 Phase 8와 동일 결과(무회귀), done target은 downstream 재계산.
2. **이전 결과 = overwrite + `task.reset` audit (schema 0).** `Task.result`는 새 결과로 덮어쓰고, overwrite 전 `task.reset` 이벤트(이전 status/bytes) emit. 이전 전문은 append-only `agent.output.delta`로 재구성. TaskAttempt 테이블은 Phase 10+.
3. **backoff = Retry-After 추출 + jitter, 없으면 지수 fallback.** `classifyGenerateError`가 `retryAfterMs` best-effort 추출 → `RateLimitError` 보유 → `nextBackoff`가 우선 사용(cap). jitter ±20%는 executor sleep 시점(순수 nextBackoff는 결정적 유지). env override 유지.
4. **done-rerun 허용 run = terminal(failed + succeeded).** `rerunFromTask`는 failed·succeeded에서 허용(planning/running 제외). Phase 8 `auto`/`fromTask`는 failed 유지.
5. **concurrency>1 / auto-resume on boot = Phase 10+ 연기** (이견 없어 기본값 확정).

---

## 1. 현재 코드 기준 사실 정리 (조사 결과)

### 1-A. Phase 8 실제 구현 상태

- **resume 실행 경로**(`lib/dag/executor.ts` `executeResume`→`resumeInner`): plan을 새로 만들지 않고 기존 `ExecutionPlan` + `Task` rows를 로드한다. **`status==='done'`인 task는 `Task.result(JSON {text})`를 `taskResults` Map에 seed하고 루프에서 skip**, 나머지(non-done)만 topo order로 실행. `inFlight` Set + `signal.aborted` 가드로 중복/취소 처리.
- **핵심 함의**: `resumeInner`는 "현재 done인 것만 재사용, 나머지 실행"이므로, **어떤 task를 `pending`으로 reset하든 그대로 재실행된다.** ⇒ done-task 강제 재실행의 executor 변경은 **거의 없음**(reset 대상 계산만 바꾸면 됨).
- **runOneTask**(공용): 초기 실행/resume 공유. backoff 재시도 루프 포함 — 오류 → `classifyGenerateError(err).kind` → `nextBackoff(kind, attempts)` → retry면 `task.retry.attempt` emit + `abortableDelay` 후 재시도. 매 attempt마다 `task.started` 재emit(→ UI 버퍼 reset).
- **resume 게이트**(`lib/runs/resume.ts` `prepareResume`): `run.status !== 'failed'` 이면 `run_not_resumable`(409). **succeeded run은 resume 불가.** tasks select는 `{taskKey, status}`만 — **dependencies 미포함**.
- **resumePlan**(`lib/runs/resumePlan.ts`, 순수): `planExists` + `doneCount≥1`(없으면 `no_reusable_done_tasks`) 요구. `auto` = 모든 failed/cancelled reset. `fromTask` = target이 failed/cancelled여야 하며(아니면 `task_not_retryable`) reset 집합은 여전히 "모든 failed/cancelled". **done target 거부.**
- **downstream**(`lib/dag/downstream.ts`, 순수, 테스트됨): `transitiveDownstream(tasks, targetKey)` 역방향 BFS. **현재 어디서도 호출 안 함**(Phase 9용 groundwork).
- **task-level retry route**(`app/api/runs/[runId]/tasks/[taskId]/retry/route.ts`): taskId→taskKey 조회 후 `prepareResume({kind:'fromTask'})`. done target은 `task_not_retryable`로 거부(주석에 "deferred to Phase 9").
- **backoff**(`lib/runs/backoffPolicy.ts`, 순수): `nextBackoff(kind, attemptsSoFar)` — rate_limit 2회(2s,4s), timeout 1회(5s), 그 외 0. `HARNESS_TASK_RETRY_*` env. **Retry-After 미반영, jitter 없음**(결정적). `RateLimitError`/`GenerateTimeoutError`는 delay metadata를 안 가짐.
- **UI**: `DagGraph`는 **표시 전용**(status별 색: pending/running/done/failed/blocked/cancelled). per-task 액션 없음. `RunStream`은 `resumable`(failed + tasks 존재 + failed/cancelled 있음)일 때 `ResumeRunButton`(1차) + `RetryRunButton`(2차 "Retry from scratch"). `run.resumed`/`task.retry.attempt` 이벤트 처리 + `task.started`에서 출력 버퍼 reset(중복 수정).

### 1-B. Task / Run / ExecutionPlan / RunEvent schema 상태 (변경 없음, migrate clean)

- `Task`: `status`(free-form: pending|running|blocked|done|failed|cancelled), `result`(JSON `{text,bytes}`, **최신 1개만**), `error`, `dependencies`(JSON `string[]`), `planId`, `agentId`, `taskKey`, `startedAt`, `completedAt`. `@@unique([planId, taskKey])`. **attempt/history 컬럼 없음.**
- `ExecutionPlan`: `runId @unique` (1 run = 1 plan).
- `RunEvent`: `type`(free-form), `payload`(JSON), `taskId`/`agentId`/`artifactId` nullable. append-only. → **attempt audit를 schema 없이 담기에 적합.**
- `Run`: `status`(free-form), `failedReason`, `startedAt`, `endedAt`.

### 1-C. 현재 resume/retry/backoff 동작 요약

| 동작 | 진입 | 대상 run | reset 집합 | executor |
|---|---|---|---|---|
| 처음부터 실행 | `/start` → executeRun | ready | (신규 plan) | 전체 |
| 재시도(reset) | `/retry` → retry.ts | failed, no plan | — (status→ready, 재계획) | 전체 |
| 재시도(clone) | `/retry` → retry.ts | failed, plan 있음 | (새 run 복제) | 전체 |
| **resume(run-level)** | `/resume` → prepareResume(auto) | **failed** | 모든 failed/cancelled | non-done |
| **task-retry** | `/tasks/[id]/retry` → fromTask | **failed**, target failed/cancelled | 모든 failed/cancelled | non-done |
| backoff(task) | runOneTask 내부 | — | — | rate_limit 2 / timeout 1 |

---

## 2. Phase 9 목표

1. **완료(done) task를 사용자가 골라 다시 실행**하고, 그 **transitive downstream을 안전하게 재계산**한다(입력이 바뀌므로). upstream done은 계속 재사용.
2. transient provider 오류 대기 전략 개선: **Retry-After 인지 + jitter**(현재 결정적 지수 backoff 확장).
3. attempt 기록/표시의 **최소 감사성**: 이전 결과 overwrite 시 `task.reset` 이벤트로 audit(schema 0).
4. **스키마 0 / dependency 0 / Phase 8 무회귀 / executor 변경 최소.**

---

## 3. 포함 범위 / 제외 범위

### 3-A. Phase 9 포함

- **done-task 강제 재실행 + transitive downstream invalidation**(headline). `resumePlan`에 `rerunFromTask` 모드 추가(`downstream.ts` 연결), `resume.ts` 게이트를 terminal(failed+succeeded)로 확장 + dependencies 로드, task-retry route가 done target 허용.
- **Retry-After-aware backoff + jitter**: `providerError.classifyGenerateError`가 `retryAfterMs` 추출(가능 시), `RateLimitError`가 보유, `backoffPolicy.nextBackoff`가 활용 + jitter.
- **attempt audit**: `task.reset` RunEvent(이전 status/bytes) — overwrite 전 emit. (이전 전체 출력은 기존 `agent.output.delta`로 재구성 가능.)
- **UI**: `DagGraph`에 terminal run 한정 per-task "Re-run from here"(done/failed/cancelled) + 2단계 확인 + downstream 개수 미리보기(순수 `downstream.ts` client 재사용). RunStream 배선.

### 3-B. Phase 10+ 로 연기 (명시)

- **concurrency > 1**(독립 task 병렬). partial rerun/downstream invalidation과 동시 도입 시 race·정합성 위험 큼 → 연기(§9).
- **auto-resume on boot**(process_restart 후 자동 재개). 자동 provider 호출/비용·무한루프 위험 → 연기. 현행 수동 Resume 유지.
- **Task.attempt 영속 컬럼 / TaskAttempt 테이블**(전체 attempt 결과 스냅샷 보존). RunEvent audit로 충분하다고 판단되면 불필요(§4 결정 #2).
- `Retry-After` HTTP-date 포맷 정밀 처리(우선 delta-seconds만).

---

## 4. 핵심 결정 질문 (추천안 우선)

### 결정 #1 — task-level 액션 통합 vs 분리 (**추천: 통합 `rerunFromTask`**)

- **추천**: 기존 `/tasks/[taskId]/retry` + `prepareResume`를 **`rerunFromTask` 의미로 일반화**. resetKeys = `{target} ∪ transitiveDownstream(target) ∪ {모든 failed/cancelled}`.
  - failed/cancelled target: downstream은 pending이라 no-op → **Phase 8와 동일 결과**(무회귀).
  - done target: target + downstream done을 reset → 재계산.
  - "모든 failed/cancelled" 합집합으로 cancelled sibling 완결성 보장.
  - 장점: 라우트/모드 1개, 멘탈모델 단순("여기부터 다시"), Phase 8 경로 포섭.
- **대안(분리)**: `/tasks/[taskId]/rerun` 신규 라우트 + `fromTask` 유지. 장점: Phase 8 계약 완전 고정. 단점: 라우트·모드 중복, 의미 분기 노출.

### 결정 #2 — 이전 결과 보존 방식 (**추천: overwrite + RunEvent audit, schema 0**)

- **추천**: `Task.result`를 새 결과로 overwrite(현행 reset이 이미 `result:null`). overwrite 전 **`task.reset` 이벤트**(payload `{taskKey, previousStatus, previousBytes}`) emit. 이전 전체 출력 텍스트는 기존 append-only `agent.output.delta`로 재구성 가능 → **별도 스냅샷/스키마 불필요.**
- **대안 A(스냅샷 in event)**: `task.reset` payload에 이전 result 전문 포함. 장점: 깔끔한 단일 audit. 단점: payload 비대(대형 출력) + redactor 부담.
- **대안 B(TaskAttempt 테이블)**: attempt별 result 영속. 장점: 완전한 history/analytics. 단점: **스키마 마이그레이션 1건**(원칙 위배), 범위 확대. → Phase 10+.

### 결정 #3 — Retry-After + jitter (**추천: 추출 가능하면 사용, 아니면 지수+jitter**)

- **추천**: `classifyGenerateError`가 raw 오류에서 `retry-after` 헤더(델타-초)를 best-effort 추출(`responseHeaders`/`headers` 필드 존재 시) → `RateLimitError.retryAfterMs`. `nextBackoff(kind, attempt, { retryAfterMs })` = `retryAfterMs ?? 지수`를 `maxDelayMs`로 cap. **jitter는 executor sleep 시점에 ±20% 적용**(순수 `nextBackoff`는 결정적 유지 → 테스트 안정). env override 유지.
- **주의(조사)**: AI SDK v4 `APICallError`는 `responseHeaders?`를 노출하는 것으로 보이나 **provider별 실제 존재는 런타임 확인 필요** → 없으면 지수 fallback(무해).
- **대안**: 현행 지수-only 유지(가장 단순, 그러나 429 정확도↓).

### 결정 #4 — done-rerun 허용 run 상태 (**추천: terminal = failed + succeeded**)

- **추천**: `rerunFromTask`는 `status ∈ ('failed','succeeded')`에서 허용(planning/running 제외). succeeded run의 한 done step만 고쳐 재계산하는 게 핵심 UX. Phase 8 `auto`/(있다면)`fromTask`는 `failed`만 유지.
- **대안**: succeeded만 허용(failed run은 Resume으로). 단순하지만 "failed run에서 특정 done step만 다시"가 막힘.

### 결정 #5 — concurrency>1 / auto-resume (**추천: 둘 다 Phase 10+ 연기**)

- **추천**: Phase 9 범위 밖. partial rerun + downstream invalidation 안정화에 집중. (근거 §9.)

---

## 5. 상세 설계

### 5-A. task rerun / downstream invalidation 알고리즘 (순수)

`resumePlan.computeResumePlan`에 모드 추가:

```
mode = { kind: 'rerunFromTask', targetKey }
입력: planExists, tasks: { taskKey, status, dependencies }[], mode

eligible 조건:
  - planExists
  - target 존재 (else target_not_found)
  - target.status ∈ {done, failed, cancelled}  (pending/running 거부: task_not_rerunnable)
resetKeys = unique(
    [target.taskKey]
    ∪ transitiveDownstream(tasks, target.taskKey)        // 순수 downstream.ts
    ∪ tasks.filter(failed|cancelled).map(taskKey)         // 완결성 보장
  ) ∩ 존재하는 taskKey
doneReused = done인데 resetKeys에 없는 수
```

- `auto`/`fromTask`(Phase 8)는 **그대로 유지**(무회귀). `rerunFromTask`만 신규.
- `transitiveDownstream` 호출로 `downstream.ts`가 비로소 배선됨.

### 5-B. DB update 전략

`resume.ts prepareResume`:
- tasks select에 **`dependencies` 추가** → parse → `computeResumePlan`에 전달.
- 게이트: `auto`/`fromTask` → `status==='failed'`; **`rerunFromTask` → `status ∈ ('failed','succeeded')`**.
- reset: 기존과 동일 `updateMany({ taskKey in resetKeys }, { status:'pending', error:null, result:null, startedAt:null, completedAt:null })` + `run.update({ status:'running', failedReason:null, endedAt:null })` (단일 트랜잭션).
- **overwrite 전 audit**: reset 대상 done task별 `task.reset` 이벤트(또는 1건 집계 이벤트) emit — 결정 #2.
- executor(`executeResume`)는 **무변경**: reset된 것들이 pending이라 자동 재실행, 남은 done seed 재사용. (단 §9의 succeeded→running 재진입 정합성 확인.)

### 5-C. RunEvent contract (신규/재사용)

- **신규** `task.reset` — payload `{ taskKey, previousStatus, previousBytes? }`. reset된(특히 done) task별 audit.
- **재사용** `run.resumed`(payload에 `mode:'rerunFromTask'`, `fromTaskKey`, `resumedTasks`, `doneReused`), `task.started`(버퍼 reset), `agent.output.*`, `task.completed`, `result.created`, `run.completed`.
- `task.retry.attempt`에 `retryAfterMs?` 추가(Retry-After 사용 시).
- `RUN_EVENT_TYPES`(RunStream)에 `task.reset` 추가(SSE 수신). reducer: `task.reset` → 해당 taskKey를 pending 표시 + 출력 버퍼 클리어(replay 일관).

### 5-D. UI/UX 흐름

- `DagGraph`: terminal run(`failed`/`succeeded`)에서 각 task(done/failed/cancelled)에 **"Re-run from here"** 버튼. 클릭 → 2단계 확인("이 단계와 의존 N개 단계를 다시 실행하고 기존 결과를 대체합니다") → `POST /tasks/[taskId]/retry`.
  - downstream N 미리보기: `transitiveDownstream`(순수, client import) 로 계산.
  - DagGraph props 확장: `runId`, `runStatus`, `onRerun?`(또는 내부 fetch + onResumed 콜백). 표시 전용 유지 위해 액션은 옵셔널.
- `RunStream`: DagGraph에 `runId`/`runStatus`/`onResumed`(=set-run-meta running) 전달. rerun 성공 → `run.resumed` 수신 → status running → 스트림 재진입(기존 메커니즘).
- 기존 `ResumeRunButton`(run-level, failed) 그대로. 두 액션 공존(run-level Resume vs task-level Re-run).

### 5-E. API route 계획 (thin)

- **수정** `app/api/runs/[runId]/tasks/[taskId]/retry/route.ts`: target status로 모드 결정 — failed/cancelled → (기존 의미) / done → `rerunFromTask`. **추천(결정#1)**: 단순히 항상 `rerunFromTask`로 위임(포섭). 라우트 본문은 거의 불변(모드명만).
- **무변경** `/resume`(run-level auto), `/retry`(reset/clone), `/cancel`, `/start`, `/state`, `/events`.
- `runtime='nodejs'`, `dynamic='force-dynamic'`, `ensureRecovered()`, AbortController 등록/해제 패턴 유지.

### 5-F. 순수 lib 분리 계획

- `lib/dag/downstream.ts` — **이미 존재**(재사용, 신규 코드 없음).
- `lib/runs/resumePlan.ts` — `rerunFromTask` 모드 + `dependencies` 입력 추가(순수 유지, `downstream` import).
- `lib/runs/backoffPolicy.ts` — `nextBackoff(kind, attempt, opts?)` 에 `retryAfterMs` 반영(순수 유지, jitter는 executor).
- `lib/agents/providerError.ts` — `retryAfterMs` 추출(순수, 헤더 파싱). (jitter helper가 필요하면 `lib/runs/jitter.ts` 분리 — 선택.)

---

## 6. 파일 단위 계획

### 6-A. 신규 파일

- (코어) **없음 필수** — `downstream.ts` 재사용. (선택) `lib/runs/jitter.ts`(순수 jitter) + 테스트, 분리 선호 시.
- 테스트: `resumePlan.test.ts` 확장(또는 별도), `backoffPolicy.test.ts` 확장, `providerError.test.ts` 확장(retryAfter 추출).

### 6-B. 수정 파일

| 파일 | 변경 |
|---|---|
| `src/lib/runs/resumePlan.ts` | `rerunFromTask` 모드 + `ResumeTaskInput.dependencies` + `transitiveDownstream` 연결 |
| `src/lib/runs/resume.ts` | tasks select에 `dependencies`; 모드별 status 게이트(rerun=failed+succeeded); `task.reset` audit emit; payload `mode` 확장 |
| `app/api/runs/[runId]/tasks/[taskId]/retry/route.ts` | done target 허용(모드 `rerunFromTask`로 위임) |
| `src/lib/agents/providerError.ts` | `classifyGenerateError`가 `retryAfterMs?` 추출(헤더 best-effort) |
| `src/lib/agents/po.ts` | `RateLimitError`(+`GenerateTimeoutError` 해당 시)에 `retryAfterMs?` 보유; `raiseProviderError` 전달 |
| `src/lib/runs/backoffPolicy.ts` | `nextBackoff(kind, attempt, { retryAfterMs })` |
| `src/lib/dag/executor.ts` | `runOneTask`에서 `classifyGenerateError` 결과의 `retryAfterMs`를 `nextBackoff`에 전달 + sleep에 jitter(±20%) 적용. (resumeInner는 사실상 무변경) |
| `src/components/run/DagGraph.tsx` | terminal run 한정 per-task "Re-run from here" + downstream 미리보기 + 2단계 확인 |
| `src/components/run/RunStream.tsx` | DagGraph에 runId/runStatus/onResumed 전달; `task.reset` reducer/RUN_EVENT_TYPES |
| `apps/web/package.json` | 신규/확장 테스트 등록(필요 시) |

### 6-C. 변경하지 않을 파일 (원칙)

- `lib/dag/downstream.ts`(재사용만), `lib/runs/retry.ts`(reset/clone), `lib/runs/cancel.ts`/`cancelState.ts`, `lib/runtime/recovery.ts`, `prisma/schema.prisma`(**마이그레이션 0**), `/resume`·`/start`·`/cancel` route, run-level `ResumeRunButton`.

---

## 7. 테스트 계획

### 7-A. 순수 함수 테스트

- `resumePlan` `rerunFromTask`: done target → resetKeys = target+downstream(+failed/cancelled); 선형/다이아몬드 DAG에서 downstream 정확성; pending/running target 거부; target_not_found; succeeded run 시나리오(전부 done 중 하나 target).
- `backoffPolicy`: `retryAfterMs` 우선 + cap, 없을 때 지수 fallback, env override(기존 유지).
- `providerError`: 헤더 있는 mock 오류 → `retryAfterMs` 추출, 없으면 undefined.
- `downstream`: 기존 테스트 유지(이미 통과).

### 7-B. API/route 테스트 가능 범위

- route는 thin → 순수 모듈 테스트로 대부분 커버. route 자체는 수동/라이브 smoke(가드 경로: done target 허용, pending target 거부, succeeded run 허용).

### 7-C. 수동 smoke 시나리오

1. **succeeded run에서 중간 done task "Re-run from here"** → target + downstream done이 pending→재실행, upstream done 재사용, downstream done 결과 갱신, result.md 재생성, run succeeded.
2. **downstream 미리보기 개수**가 실제 reset 수와 일치.
3. **failed run에서 done task rerun** → done target+downstream + 기존 failed 모두 재실행되어 완결.
4. **출력 중복 없음**: rerun된 task 출력이 이전 attempt와 안 이어붙음(task.started/task.reset 버퍼 reset).
5. **Retry-After backoff**: 429(헤더 포함 가능 시) → `task.retry.attempt`에 `retryAfterMs` 반영, 대기 중 Cancel 인터럽트.
6. **회귀**: Phase 8 run-level Resume(failed), failed/cancelled task-retry, 처음부터 실행/clone 무회귀.

---

## 8. 검증 명령

```powershell
corepack pnpm --filter web typecheck
corepack pnpm --filter web test
apps/web/node_modules/.bin/next.cmd build      # dev 서버 떠 있으면 prisma generate EPERM → next build 단독
apps/web/node_modules/.bin/prisma.cmd migrate status   # drift 0 (스키마 무변경) 확인
```

---

## 9. 리스크와 완화

- **done result overwrite**: 이전 결과 wipe. 완화 — `task.reset` audit + append-only delta로 이전 출력 재구성. 비가역성 confirm UI 2단계.
- **downstream invalidation 실수**(과소: stale / 과대: 불필요 재계산·비용): `transitiveDownstream` 단위테스트로 고정; resetKeys에 `{모든 failed/cancelled}` 합집합으로 완결성 보장.
- **output duplication regression**: `task.started`(기존) + `task.reset`(신규)에서 버퍼 reset, `initialReducerState` replay 일관 — Phase 8 수정 유지 + `task.reset` 반영.
- **event replay consistency**: rerun 후 로그가 append-only로 누적([… run.completed, run.resumed, task.reset, … run.completed]). reducer가 순서 적용 → 최신 attempt 반영. `task.reset`/`run.resumed` 분기로 status/buffer 정합.
- **succeeded→running 재진입**: succeeded run을 running으로 되돌릴 때 Final result 패널/`result.created` 정합. 완화 — rerun 완료 시 `exportFinalResult` 재실행(이미 resumeInner가 수행) + UI 라이브 reconciliation(Phase 8 폴리시 재사용).
- **provider cost / latency**: downstream 다수 재계산 시 비용↑. 완화 — confirm에 재실행 단계 수 명시; 기본은 명시적 단일 진입(자동 아님).
- **schema 변경 필요성**: 현 설계로 **0건**. attempt 전체 스냅샷 보존을 강하게 원하면 TaskAttempt 테이블이 필요(결정#2 대안 B) — 그 경우만 additive 마이그레이션 1건, 본 문서에 사유 기록 후 진행.
- **concurrency**: Phase 9는 sequential 유지. `inFlight` + status 게이트로 동시 resume/ rerun 차단(이미 동작). 병렬 도입은 Phase 10+.

---

## 10. PHASE_LOG.md 업데이트 계획 (지금은 미반영)

구현·검증 완료 후 기록 예정(승인 전 작성 안 함):
- Current Status 한 줄: `Phase 9 (Done-Task Re-run & Backoff Hardening) implemented ... rerun-from-task with transitive downstream invalidation + Retry-After/jitter backoff + task.reset audit, no schema migration, no new dependency.`
- 전용 섹션: 결정사항(통합 rerunFromTask, overwrite+audit, Retry-After+jitter, terminal 허용, concurrency/auto-resume 연기), 신규/수정 파일, 검증 결과(typecheck/test/route/migrate), 수동 smoke 결과, 연기 항목(concurrency, auto-resume, TaskAttempt 영속).
- **계획 단계인 지금은 PHASE_LOG.md를 수정하지 않는다.**

---

## 11. 산출물 요약

- 재사용: `lib/dag/downstream.ts`(배선).
- 수정 lib: `lib/runs/{resumePlan,resume,backoffPolicy}.ts`, `lib/agents/{providerError,po}.ts`, `lib/dag/executor.ts`.
- 수정 route: `app/api/runs/[runId]/tasks/[taskId]/retry/route.ts`.
- 수정 UI: `components/run/{DagGraph,RunStream}.tsx`.
- 신규/확장 테스트: `resumePlan`(rerun), `backoffPolicy`(retryAfter), `providerError`(retryAfter), (선택 `jitter`).
- **스키마 변경: 0(기본). 새 dependency: 0.**
