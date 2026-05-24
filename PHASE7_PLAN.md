# Phase 7 — Run Control & Provider Stability (상세 구현 계획)

> 상태: **계획 초안 — 2026-05-24. 코드 변경 없음.** (조사 기반, 승인 대기)
> 기준: `main @ e12122e` (Phase 5 merge 완료) + 브랜치 `phase-6-reuse-history-ux`(Phase 6 구현/스모크/푸시 완료).
> 원칙(불변): **DB = source of truth**, md/json = export/cache. 파일 1개 = 책임 1개.
> **스키마 마이그레이션 0건 목표. 새 dependency 0건 목표.** Phase 6 흐름(`/runs`·`/teams`·feedback revisit·retry)을 깨지 않는다.

---

## 승인 후 확정 결정사항 (2026-05-24)

1. **취소 표현 = `failed` + `failedReason='user_cancelled'`.** schema migration 없이, 기존 `retry.ts`/`resumeTarget`/`recovery`/terminal 체크를 그대로 재사용. UI는 `failureClass` category=`cancelled`로 회색/중립 문구를 보여 "실패"와 "내가 취소함"을 구분. **`RunEvent.type='run.cancelled'`로 audit trail 보존, `Run.endedAt`을 취소 시각으로 사용.**
2. **취소 시 Task 전이.** running task → `status='cancelled'`, `error='user_cancelled'`, `completedAt=now()`. pending task → `status='cancelled'`, `error='user_cancelled'`, `completedAt=now()`. 이미 `done`/`failed`인 task는 **그대로 보존.** **`DagGraph`에 `cancelled` 회색/중립 스타일 추가.**
3. **resume-from-failed-task는 Phase 8로 연기.** Phase 7 retry는 Phase 6 하이브리드(plan 없음→in-place reset, plan 있음→clone-new-run, 처음부터)를 유지하고 취소 run도 동일 흐름에 포함. 부분 재개는 PHASE_LOG에 Phase 8 후보로 기록.
4. **공용 에러 모듈 = `lib/agents/providerError.ts`(분류) + `lib/agents/poErrorResponse.ts`(라우트 HTTP 매핑).** 에러 클래스 정의는 `po.ts`에 유지(import churn 최소). `lib/providers/errors.ts`로의 이동은 추후 별도 리팩터.
5. **structured-output 정책 = strict-repair 1회 현행 유지. rate_limit 자동 backoff 미도입(분류·안내만).** (이견 없어 기본값 확정.)

---

## 0. 조사 결과 (사실 기반 — 이 계획의 근거)

### 0-A. 취소(cancel) 인프라는 이미 절반 존재한다

- `lib/dag/executor.ts` `executeRun(runId, opts)`는 **이미 `opts.signal?: AbortSignal`을 받아** plan 단계(`proposeExecutionPlan({ signal })`)와 task 단계(`runAgentTask({ signal })`)로 **전달하고 있다.**
- 그러나 `app/api/runs/[runId]/start/route.ts`는 `void executeRun(runId)`를 **signal 없이** fire-and-forget로 호출한다 → **AbortController를 보관하는 주체가 없다.**
- `executor.ts`는 모듈 로컬 `const inFlight = new Set<string>()`로 중복 실행만 막는다.
- `lib/dag/runRegistry.ts`는 **현재 순수 in-process pub/sub 이벤트 버스**(`getRunBus`/`publishRunEvent`/`subscribeRunEvents`)일 뿐, 취소 상태를 갖고 있지 않다. → **취소 컨트롤러 레지스트리를 둘 가장 자연스러운 위치.**
- `lib/agents/runtime.ts`의 `streamText`/`generateObject`는 AI SDK에 `abortSignal`을 그대로 전달한다 → **mid-stream abort는 SDK 차원에서 지원됨.**

### 0-B. 모든 상태/사유/이벤트 타입은 free-form String → 스키마 변경 불필요

- `Run.status` = `String @default("pending")` (enum 아님). 관측값: `pending|po_qa|ready|planning|running|succeeded|failed`.
- `Run.failedReason` = `String?` (free-form). `Run.startedAt`/`endedAt` = `DateTime?` 존재.
- `Task.status` = `String @default("pending")` — `pending|running|blocked|done|failed`.
- `RunEvent.type` = `String` (free-form). → `run.cancelled`/`task.cancelled` 추가는 마이그레이션 불필요.
- 결론: **`cancelled`를 status/task status로 쓰든, `failed`+`failedReason='user_cancelled'`로 쓰든, RunEvent 타입을 추가하든 — 전부 마이그레이션 0건.** `cancelledAt` 같은 신규 컬럼도 `endedAt`+이벤트 timestamp로 대체 가능.

### 0-C. process_restart 복구와의 상호작용

- `lib/runtime/recovery.ts`는 `status in ('planning','running') AND updatedAt < cutoff(기본 15분)`인 run만 `failed(process_restart)`로 쓸어 담는다.
- 취소 결과가 `failed`(또는 `cancelled`)이면 **이미 terminal이라 recovery가 건드리지 않는다.** 충돌 없음.
- 단일 프로세스 전제: `/start`가 등록한 컨트롤러는 같은 프로세스의 `/cancel`이 찾는다. 프로세스 재시작 시 in-flight executor 자체가 사라지므로 recovery가 처리 → executor 내부 DB 폴링 불필요.

### 0-D. 에러 매핑이 **두 층에서 중복**되어 있다 (Phase 7 point 4의 핵심)

**① 생성측 분류** — `extractAuthStatus()` + `looksLikeSchemaError()` + catch 체인(`GenerateAbortedError`→`GenerateTimeoutError`→auth(401/403)→schema→`ProviderUnavailableError`)이 **4개 파일에 글자 단위로 동일**하게 복제됨:
- `lib/agents/po.ts` (`callGenerate`)
- `lib/agents/lead.ts` (`callLead`)
- `lib/agents/team.ts` (`callGenerate`)
- `lib/agents/leadRevise.ts` (`callRevise`)

그리고 `lib/agents/worker.ts`(`runAgentTask`)는 **불완전한 버전** — auth + `ProviderUnavailableError`만 있고 **abort/timeout/schema 구분이 없다.** → task 실행 중 timeout이나 **cancel(abort)이 `ProviderUnavailableError`로 뭉개져 executor에서 `task_failed:*`로 기록된다.** 이게 취소를 "task 실패"로 오인하게 만드는 정확성 결함.

**② 라우트측 HTTP 매핑** — `mapPoError(err)`(typed error → `NextResponse` + status/code)가 **4개 라우트에 동일**하게 복제됨:
- `app/api/teams/recommend/route.ts`
- `app/api/qa/[sessionId]/next/route.ts`
- `app/api/qa/[sessionId]/answer/route.ts`
- `app/api/runs/[runId]/revision/route.ts`

매핑표(현재): `aborted→499`, `timeout→504`, `provider_unavailable→503`, `provider_auth_failed→401`, `po_schema_error→502`, `unknown_provider→500`, `model_disabled→409`.

**③ failedReason 해석** — `lib/runs/failureClass.ts`(persisted 코드 → 복구 UX)는 Phase 6에서 **이미 단일 모듈로 추출됨.** 이건 위 ①②와 별개 층(run-detail 레벨).

**누락된 분류(현재 코드에 없음):** `rate_limit`(429), `model_not_found`(404). `extractAuthStatus`는 401/403만 본다.

### 0-E. 실패 run failedReason 코드 카탈로그 (executor `mapPlanErrorReason` 기준)

| failedReason | 발생 지점 | 현재 failureClass.recoveryAction |
|---|---|---|
| `lead_plan_provider_unavailable:*` | plan | edit-models |
| `lead_plan_provider_auth:*` | plan | edit-models |
| `lead_plan_unknown_provider:*` | plan | edit-models |
| `lead_plan_schema_error` | plan | edit-models |
| `lead_plan_timeout:*` | plan | edit-models |
| `lead_plan_aborted` | plan(abort) | retry |
| `lead_plan_invalid:*` | plan(validate) | retry |
| `lead_plan_failed:*` | plan(기타) | retry |
| `task_failed:*` | task 실행 | retry(clone) |
| `dag_invalid:*` | topoSort | (unknown→retry) |
| `process_restart` | recovery | retry |
| **`user_cancelled`** | **(Phase 7 신규)** | **(신규: cancelled→retry)** |

### 0-F. UI 현황

- `components/run/RunStream.tsx`: SSE+폴링 fallback, reducer가 `run.completed`에서만 terminal로 전이. `RUN_EVENT_TYPES`에 등록된 타입만 SSE로 수신. `RunProgressOverlay`는 **RunStream.tsx 안에 인라인 함수**로 존재(planning/running/starting 동안 blur 오버레이). 현재 stage/spinner/active task/transport/`done/total`/step list/"local models can take a while" 안내를 표시.
- `showRetryPanel = status==='failed' && classifyFailure(reason).recoveryAction==='retry'` → `RetryRunButton`.
- `isRecoverableModelFailure(reason)` → `TeamModelRecoveryPanel`(team-models 편집).
- run detail page(`app/runs/[runId]/page.tsx`)가 RunStream에 initial props를 server에서 주입(status/failedReason/team/tasks/events/modelCatalog/finalResult). `failedReason` 별도 prop 존재.
- `lib/runs/retry.ts`는 `status==='failed'`만 처리(아니면 `run_not_failed` 409). plan 없으면 in-place reset, 있으면 clone-new-run.

---

## 1. Phase 7 목표

실제 사용 중 run이 **오래 걸리거나·실패하거나·provider가 schema error/timeout/auth/rate-limit를 낼 때** 사용자가 안전하게 다룰 수 있게 한다:

1. planning/running 중 **Cancel/Stop**으로 중단.
2. 취소/실패 run을 **일관된 retry**(기존 하이브리드)로 다시 시작.
3. provider별 오류를 **단일 분류 체계 + 공용 모듈**로 정리하고, 사용자 안내를 일관화.
4. 긴 실행 상태 표시를 보강(경과 시간·마지막 이벤트·transport·provider 안내·Cancel).
5. **스키마 0건 / dependency 0건 / executor 최소 변경**으로 달성.

---

## 2. 범위 — 포함 vs 연기

### 2-A. Phase 7 포함

- planning/running run **Cancel** (`POST /api/runs/[runId]/cancel`).
- executor **abort 전파 + aborted-aware 종료**(loop-top 체크, catch에서 cancel 오인 방지).
- 취소 run을 **기존 retry 경로에 흡수**(decision #1에 따라 추가 코드 0~최소).
- provider 오류 **공용 분류 모듈** 추출(중복 ①② 제거) + `rate_limit`/`model_not_found` 추가.
- `worker.ts`를 공용 분류기로 교체 → task 단계도 timeout/schema/abort/auth/rate_limit 구분.
- `failureClass.ts`에 `cancelled`/`rate_limit`/`model_not_found` 분류 + 안내 정책 추가.
- `RunProgressOverlay` 분리 + 경과 시간/마지막 이벤트/Cancel/provider 안내 보강.

### 2-B. Phase 8 이후로 연기 (명시)

- **resume-from-failed-task**(실패/취소 task 지점부터 부분 재개). executor의 상태 머신·idempotency 변경 필요 → 위험. **연기 권장**(decision #3).
- **rate_limit 자동 backoff 재시도**(executor 안에서 지수 백오프). 실행 시간/비용/복잡도 증가 → Phase 7은 **분류·안내만**, 자동 재시도는 연기.
- 동시성 >1, Worker/BullMQ 추출, 다중 프로세스/배포.
- revision rollback(Phase 6에서 이미 연기).

---

## 3. 핵심 설계 결정 (추천안 + 근거)

### 3-A. 취소 상태 표현 — **추천: `failed` + `failedReason='user_cancelled'`** (decision #1)

| | A. 전용 `cancelled` status | **B. `failed` + `user_cancelled` (추천)** |
|---|---|---|
| 마이그레이션 | 0 (free-form) | 0 |
| `retry.ts` | **수정 필요**(`failed`만 처리 → cancelled 추가) | **무변경**(이미 failed 처리) |
| `failureClass.ts` | 분기 추가 | 분기 추가(`user_cancelled`) |
| terminal 체크(`isTerminal`, resumeTarget, `/runs` 필터, recovery) | **여러 곳에 `cancelled` 추가** | **무변경**(전부 이미 `failed` 처리) |
| RunStream reducer terminal | `cancelled` 분기 추가 | 무변경 |
| 의미론 | 깔끔(빨강 아님) | "failed"로 표시되지만 failureClass category=`cancelled`로 **부드러운 copy/회색 배지** 렌더 가능 |
| 위험/표면적 | 큼(~6+ 지점) | **작음** |

→ **B 추천.** 프로젝트 제약(스키마 0·위험 최소·Phase 6 무회귀)에 가장 부합. `failureClass`가 이미 단일 해석 지점이므로, status 컬럼은 `failed`라도 UI는 `category='cancelled'`로 **"사용자가 취소함"**을 별도 색/문구로 구분 렌더할 수 있다. 의미 손실은 `run.cancelled` 이벤트 + failedReason 코드로 보존.

### 3-B. Task 상태 처리 — **확정: running·pending 모두 `cancelled`** (decision #2)

- 취소 시점 **running task**: worker abort → executor가 **`status='cancelled'`, `error='user_cancelled'`, `completedAt=now()`**로 표기.
- **pending task**: 한 번의 `updateMany`로 **`status='cancelled'`, `error='user_cancelled'`, `completedAt=now()`** 표기(터미네이트된 run에서 "아직 pending"으로 남는 어색함 제거).
- 이미 `done`/`failed`인 task는 **그대로 보존.**
- 비용: `DagGraph`에 `cancelled` 시각(회색/중립) 1종 추가. 그 외 영향 없음.

### 3-C. RunEvent — **추천: `run.cancelled` 1종 추가(+선택 `task.cancelled`)**

- executor/cancel.ts가 `run.cancelled`(payload: `failedReason:'user_cancelled'`, `succeededTasks`, `cancelledTasks`) emit.
- RunStream: `RUN_EVENT_TYPES`에 `run.cancelled` 추가(SSE 수신) + reducer에 1개 분기(→ terminal). ~4줄.
- `task.cancelled`는 선택(중단 task UI 즉시 반영용). 없으면 폴링/state로 동기화됨.

### 3-D. 취소 메커니즘 — **추천: per-run AbortController 레지스트리(runRegistry) + executor aborted-aware 종료**

- `/start`가 `AbortController` 생성 → `runRegistry.registerRunController(runId, controller)` → `executeRun(runId, { signal: controller.signal })` → `.finally(clearRunController)`.
- `/cancel` → `lib/runs/cancel.ts`:
  1. run 조회. **`status in ('planning','running')`만 취소 가능**(아니면 409 `run_not_cancellable`).
  2. `runRegistry.abortRun(runId)`로 컨트롤러 abort(있으면).
  3. **DB terminal 상태를 cancel.ts가 단독으로 기록**(`failed`+`user_cancelled`+`endedAt`), 중단/잔여 task `cancelled`, `run.cancelled` emit. → UI는 abort가 SDK를 못 끊어도 **즉시** 취소로 보인다.
- executor 측 정합성(단일 writer 보장):
  - **loop-top 체크**: 각 task 시작 전 `if (signal?.aborted) { return; }` — abort가 in-flight 호출을 못 끊은 경우라도 **다음 task로 진행하지 않음**(graceful fallback).
  - **catch 가드**: plan/task catch에서 `if (signal?.aborted) return;` — **executor는 aborted면 terminal DB를 쓰지 않는다**(cancel.ts가 이미 기록). 이로써 `task_failed:*`/`lead_plan_aborted`로 **덮어쓰는 race를 차단**.
  - 결과적으로 cancelled terminal의 writer는 cancel.ts 하나. 동일 내용 재기록이 생겨도 idempotent.
- AbortController vs cancellation token vs DB polling 비교:
  - **AbortController 채택** — executor가 이미 signal을 받고 SDK가 abortSignal을 지원하므로 **추가 배선 최소, mid-stream 즉시 중단** 가능.
  - cancellation token(커스텀 플래그): 동일 효과지만 SDK abort를 못 써 mid-stream을 못 끊음 → 열위.
  - DB polling(executor가 주기적으로 status 조회): 단일 프로세스에선 불필요한 부하·지연. **채택 안 함.**
- HMR/재시작: 컨트롤러는 in-memory라 재시작 시 사라짐 → 그땐 executor도 죽어 recovery가 처리. cancel.ts는 컨트롤러가 없어도(`abortRun`가 no-op) **DB는 항상 기록**하므로 UI 정합 유지.

### 3-E. 공용 에러 모듈 — **추천: 분류기/응답 매퍼 2개로 추출, 에러 클래스는 이동 없이 재사용** (decision #4)

- **`lib/agents/providerError.ts`** (신규, 생성측): `extractProviderErrorStatus()`, `looksLikeSchemaError()`, `looksLikeRateLimit()`(429), `looksLikeModelNotFound()`(404), 그리고 **`classifyGenerateError(err, { provider, modelId }): never`** — abort/timeout 통과, 그 외를 적절한 typed error로 throw. po/lead/team/leadRevise/**worker**가 모두 이걸 호출.
- **`lib/agents/poErrorResponse.ts`** (신규, 라우트측): `poErrorResponse(err): NextResponse` — 4개 라우트의 `mapPoError`를 대체. `rate_limit→429`, `model_not_found→404` 추가.
- **에러 클래스 정의는 현재 위치(`po.ts`) 유지** + 신규 `RateLimitError`/`ModelNotFoundError`도 `po.ts`에 추가하고 **두 신규 모듈에서 import.** (클래스를 옮기면 전 파일 import 재작성 → churn 큼. 추출은 "헬퍼+매퍼"만.)
- 위치 대안 `lib/providers/errors.ts`도 가능하나, 이 분류는 **agent 생성 호출 전용 의미**라 `lib/agents/` 하위가 응집도 높음 → **`lib/agents/` 추천.**

### 3-F. structured output 실패 strict-repair 정책 — **추천: 현행 1회 repair 유지, 자동 재시도 확대 안 함** (decision #5)

- 현재 po/team/lead/leadRevise는 `PoSchemaError` 시 **strict 프롬프트로 1회 재시도** 후 실패. Gemini/Ollama 대상.
- Phase 7은 이 정책을 **그대로 유지**(검증된 동작, executor 위험 회피). 추가로:
  - 분류만 정교화(`schema_error`/`rate_limit`/`model_not_found`를 사용자에게 명확히).
  - **rate_limit 자동 backoff는 도입하지 않음**(분류+안내만, Phase 8 후보).

---

## 4. 사용자 안내 정책 (failureClass category 기준)

| category | 트리거(failedReason/HTTP) | UI 1차 안내 | CTA |
|---|---|---|---|
| `cancelled` | `user_cancelled` | "이 run을 취소했습니다." (회색, 빨강 아님) | **Retry**(reset 또는 clone) |
| `provider_auth` | `*_provider_auth:*` / 401 | "provider 키 거부됨" | **Settings 링크** + 모델 편집 |
| `provider_unavailable` | `*_provider_unavailable:*` / 503 | "provider 연결 불가" | **모델 편집** + Retry |
| `schema_error` | `lead_plan_schema_error` / 502 | "모델이 잘못된 구조 출력(자동 1회 보정 실패)" | **더 강한 모델로 편집** |
| `timeout` | `*_timeout:*` / 504 | "시간 초과" | **더 빠른/강한 모델** + Retry |
| `rate_limit` | (신규) `*_rate_limit:*` / 429 | "요청 한도 초과, 잠시 후 재시도" | **Retry**(수동) + 모델 변경 |
| `model_not_found` | (신규) `*_model_not_found:*` / 404 | "모델 ID를 provider가 모름" | **모델 편집** |
| `provider_unknown` | `*_unknown_provider:*` / 500 | "앱이 모르는 provider" | **모델 편집** |
| `plan_invalid`/`plan_failed`/`process_restart`/`task_failed`/`unknown` | (Phase 6 동일) | (현행 유지) | Retry/clone |

- **Settings 유도**: auth 계열만.
- **모델 변경 유도**: schema/timeout/model_not_found/provider_unavailable/unknown.
- **Retry만**: cancelled/aborted/plan_failed/process_restart/rate_limit.
- **더 강한 모델 추천**: schema_error(구조화 출력 약한 로컬/소형 모델).

---

## 5. API route 계획 (thin 유지)

| 메서드/경로 | 신규/수정 | 책임 | 위임 lib |
|---|---|---|---|
| `POST /api/runs/[runId]/cancel` | **신규** | 파싱/가드만 → 취소 | `lib/runs/cancel.ts` |
| `POST /api/runs/[runId]/start` | **수정** | AbortController 생성·등록, signal 전달, finally 해제 | `lib/dag/runRegistry.ts`, `executor` |
| `POST /api/runs/[runId]/retry` | **무변경**(decision #1=B 시) | 취소 run = `failed`라 그대로 동작 | `lib/runs/retry.ts` |
| `/api/runs/[runId]/state` | **무변경** | status/failedReason/events/tasks/startedAt 이미 반환 | — |
| `/api/runs/[runId]/events` | **무변경** | free-form 이벤트 타입 passthrough | — |
| `qa/next`, `qa/answer`, `teams/recommend`, `runs/revision` | **수정(경미)** | `mapPoError` → 공용 `poErrorResponse` 교체 | `lib/agents/poErrorResponse.ts` |

> 모든 라우트 상단 `runtime='nodejs'`, `dynamic='force-dynamic'`, `ensureRecovered()` 컨벤션 유지.

---

## 6. 파일 단위 책임 (단일 책임)

### 6-A. 신규 lib

| 파일 | 책임 | 테스트 |
|---|---|---|
| `src/lib/agents/providerError.ts` | 생성측 분류기: `extractProviderErrorStatus`/`looksLike*`/`classifyGenerateError`(+429/404) | `providerError.test.ts` (순수) |
| `src/lib/agents/poErrorResponse.ts` | 라우트측 typed error → `NextResponse`(상태/코드) | `poErrorResponse.test.ts` (순수) |
| `src/lib/runs/cancelState.ts` | **순수** 전이 결정: `canCancel(status)`, `cancelTransition({status, hasPlan})→{runStatus, failedReason, taskUpdate}` | `cancelState.test.ts` |
| `src/lib/runs/cancel.ts` | Prisma+runRegistry 배선: 가드→abort→DB terminal 기록→task 표기→`run.cancelled` emit (cancelState 사용) | (통합은 수동 smoke) |

### 6-B. 신규 API

- `app/api/runs/[runId]/cancel/route.ts` — thin, `cancel.ts` 위임.

### 6-C. 신규 UI

- `src/components/run/CancelRunButton.tsx` — client. confirm 후 `POST /cancel`, busy/disable, 에러 표시. overlay 내부에서 사용(오버레이가 pointer-events를 가지므로 planning/running 중 클릭 가능).
- `src/components/run/RunProgressOverlay.tsx` — **RunStream.tsx에서 분리** + 경과 시간(startedAt 기준)·마지막 이벤트 경과·transport(SSE/polling)·provider별 "로컬 모델은 오래 걸릴 수 있음" 안내·**CancelRunButton** 추가.

### 6-D. 수정

| 파일 | 변경 |
|---|---|
| `src/lib/dag/runRegistry.ts` | 컨트롤러 레지스트리 추가: `registerRunController`/`getRunController`/`abortRun`/`clearRunController` (이벤트 버스와 공존) |
| `src/lib/dag/executor.ts` | loop-top `signal.aborted` 체크 + plan/task catch에 aborted 가드(취소 시 terminal DB 미기록) |
| `src/lib/agents/po.ts` | `callGenerate` catch → `classifyGenerateError` 호출로 치환. 신규 `RateLimitError`/`ModelNotFoundError` 클래스 정의(여기 보관) |
| `src/lib/agents/lead.ts` | 중복 catch/헬퍼 제거 → `classifyGenerateError` 사용 |
| `src/lib/agents/team.ts` | 동일 |
| `src/lib/agents/leadRevise.ts` | 동일 |
| `src/lib/agents/worker.ts` | **불완전 catch 제거 → `classifyGenerateError` 사용**(timeout/schema/abort/rate_limit/model_not_found 구분 확보) |
| `src/lib/dag/executor.ts` `mapPlanErrorReason` | `RateLimitError`→`lead_plan_rate_limit:*`, `ModelNotFoundError`→`lead_plan_model_not_found:*` 추가. task catch는 worker가 던진 타입으로 `task_failed:*` 세분(선택) |
| `src/lib/runs/failureClass.ts` | `user_cancelled`→`cancelled`, `*_rate_limit:*`→`rate_limit`, `*_model_not_found:*`→`model_not_found` 분기 + copy |
| `app/api/runs/[runId]/start/route.ts` | AbortController 등록/해제 + signal 전달 |
| `app/api/qa/[sessionId]/next/route.ts`, `.../answer/route.ts`, `app/api/teams/recommend/route.ts`, `app/api/runs/[runId]/revision/route.ts` | 로컬 `mapPoError` 삭제 → `poErrorResponse` import |
| `src/components/run/RunStream.tsx` | `RunProgressOverlay` import(분리분)·`run.cancelled` reducer 분기·`RUN_EVENT_TYPES`에 추가·overlay에 startedAt/lastEvent 전달·cancelled copy 분기(failureClass) |
| `src/components/run/DagGraph.tsx` | `cancelled` task 시각(회색) 1종 (decision #2 채택 시) |
| `app/runs/[runId]/page.tsx` | RunStream에 `startedAt` prop 추가(경과 시간용). 그 외 무변경 |
| `apps/web/package.json` | test 스크립트에 신규 `*.test.ts` 3종 append |

> **변경하지 않음(원칙):** `lib/runs/retry.ts`(decision #1=B), `lib/runtime/recovery.ts`, `lib/team/*`, `lib/revision/*`, Phase 6 `/runs`·`/teams` 화면, feedback/revision 컴포넌트, 스키마.

---

## 7. 스키마 변경 — **결론: 0건**

- 취소: `Run.status='failed'` + `Run.failedReason='user_cancelled'` + `Run.endedAt`(기존 컬럼). `cancelled` status를 쓰더라도 free-form이라 마이그레이션 0.
- task: `Task.status='cancelled'`(free-form) + 기존 `error`/`completedAt`.
- 이벤트: `RunEvent.type='run.cancelled'`/`task.cancelled`(free-form).
- 취소 시각: `endedAt` + `run.cancelled` 이벤트 `createdAt`으로 충분 → **`cancelledAt` 신규 컬럼 불필요.**
- (가정상) 만약 분석용으로 cancelled를 failed와 분리 집계해야 한다면, 그건 `failedReason='user_cancelled'` 쿼리로 도출 가능 → 여전히 마이그레이션 불필요.
- 착수 전 `prisma migrate status`로 drift 0 확인.

---

## 8. 테스트 계획

### 8-A. 순수 모듈 단위테스트 (신규)

- `src/lib/agents/providerError.test.ts`: `classifyGenerateError` — 401/403→auth, 429→rate_limit, 404→model_not_found, `AI_NoObjectGeneratedError`/zod→schema, `GenerateAbortedError`/`GenerateTimeoutError` 통과, 그 외→provider_unavailable. `looksLike*` 헬퍼 경계값.
- `src/lib/agents/poErrorResponse.test.ts`: typed error → `{status, code}` (499/504/503/401/502/500/409 + 429/404).
- `src/lib/runs/cancelState.test.ts`: `canCancel('planning'|'running')=true`, `canCancel('ready'|'succeeded'|'failed')=false`; `cancelTransition({hasPlan:false})`/`{hasPlan:true}`의 runStatus/failedReason/taskUpdate.
- `src/lib/runs/failureClass.test.ts` **확장**: `user_cancelled`→cancelled/retry, `*_rate_limit:*`→rate_limit, `*_model_not_found:*`→model_not_found.

### 8-B. executor cancellation — 단위 가능 범위 vs 수동 smoke

- **단위 가능**: `cancelState`(전이), `classifyGenerateError`(abort/timeout 통과), `failureClass`(cancelled).
- **수동 smoke 전용**(Prisma+AI SDK 실호출 필요): 실제 abort가 streamText를 끊는지, loop-top 가드가 다음 task를 막는지, cancel.ts 단일 writer race 차단.

### 8-C. 검증 명령

```powershell
corepack pnpm --filter web typecheck
corepack pnpm --filter web test
apps/web/node_modules/.bin/next.cmd build
apps/web/node_modules/.bin/prisma.cmd migrate status   # drift 0(스키마 무변경) 확인
```

---

## 9. 수동 smoke 시나리오

1. **긴 실행 중 Cancel**: ready→Start→planning/running overlay에서 **Cancel** → status `failed(user_cancelled)`, run.cancelled 이벤트, 중단/잔여 task `cancelled`, overlay 사라지고 cancelled copy(회색).
2. **취소 후 retry**: plan 없는 취소 → **reset** → `ready`(Start 가능). plan 있는 취소 → **clone-new-run**(원본 보존) → 새 run 로드.
3. **provider key 오류**: 잘못된 키로 plan/QA → `provider_auth`/401 → **Settings 안내** 노출.
4. **Ollama timeout**: 로컬 모델 지연 → `timeout`/504 → "시간 초과" + Retry/모델 변경 안내.
5. **Gemini schema_error**: 구조화 실패 → strict 1회 보정 → 그래도 실패 시 `schema_error`/502 → "더 강한 모델" 안내.
6. **rate_limit(가능 시)**: 429 → `rate_limit` 안내 + 수동 Retry.
7. **SSE 차단/새로고침**: overlay에서 transport=polling 표시, 새로고침 시 state로 복원(취소 상태 포함).
8. **회귀**: Phase 4/5/6 흐름(run 진행·Final result·feedback revisit·`/runs`·`/teams`·기존 retry/edit-models) 무회귀.

---

## 10. 리스크와 완화

- **취소 race(executor vs cancel.ts)**: cancel.ts 단일 writer + executor aborted 가드로 차단. 동일 내용 재기록은 무해.
- **abort 미지원 in-flight 호출**: worker compositeAbort의 wall-clock timeout이 상한, loop-top 가드가 다음 task 차단 → 최악의 경우 "현재 task는 끝까지, 이후 중단".
- **공용 분류기 추출 회귀**: 4개 파일 동작을 **정확히 보존**해야 함(특히 abort/timeout 통과 순서). 추출 후 동작 보존 우선 + 단위테스트로 고정.
- **worker 분류 강화의 부수효과**: 지금까지 `task_failed:*`로 뭉개지던 timeout/schema가 세분화되면 failureClass/UI 분기가 늘어남 → executor `mapPlanErrorReason`/failureClass에 대응 분기 필수.
- **DagGraph cancelled 시각 누락**: decision #2 채택 시 추가 안 하면 cancelled task가 빈/미정 스타일로 보임 → 함께 처리.

---

## 11. PHASE_LOG.md 업데이트 계획 (지금은 미반영)

구현·검증 완료 후 기록 예정(승인 전 작성하지 않음):
- "Current Status"에 한 줄: `Phase 7 (Run Control & Provider Stability) implemented ... cancel + unified provider error classification, no schema migration, no new dependency.`
- 별도 섹션: 결정사항(취소 표현, task 처리, 공용 에러 모듈), 신규/수정 파일, 검증 결과(typecheck/test 수/route 수/migrate clean), 수동 smoke 결과, 연기 항목(resume-from-failed-task, rate_limit auto-backoff).
- 계획 승인 시 제안 한 줄(구현 전): `Phase 7 planning drafted on 2026-05-24 (PHASE7_PLAN.md); scope = cancel + provider error stability, no schema migration planned.`

---

## 12. 산출물 요약

- 신규 lib: `lib/agents/{providerError,poErrorResponse}.ts`, `lib/runs/{cancelState,cancel}.ts`
- 신규 API: `app/api/runs/[runId]/cancel/route.ts`
- 신규 UI: `components/run/{CancelRunButton,RunProgressOverlay}.tsx`(후자는 분리)
- 수정: `runRegistry.ts`, `executor.ts`, `po.ts`/`lead.ts`/`team.ts`/`leadRevise.ts`/`worker.ts`, `failureClass.ts`, `start/route.ts`, 4개 라우트 `mapPoError`→공용, `RunStream.tsx`, `DagGraph.tsx`, `runs/[runId]/page.tsx`, `package.json`
- 신규 테스트: `providerError.test.ts`, `poErrorResponse.test.ts`, `cancelState.test.ts` (+ `failureClass.test.ts` 확장)
- **스키마 변경: 0. 새 dependency: 0.**
