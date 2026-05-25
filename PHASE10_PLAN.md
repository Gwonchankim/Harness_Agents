# Phase 10 Plan — 복원력: 중단된 run 자동 재개 (Auto-Resume Interrupted Runs)

> 상태: **승인 완료 — 구현 진행** (브랜치 `phase-10-auto-resume`). `PHASE_LOG.md`는 구현/검증 후 별도 갱신.
> 주 테마: **중단된 run 자동 재개**. 스키마 정책: **0-migration 엄격 우선**(확정).

---

## 승인 후 확정 결정사항 (Confirmed — 2026-05-25)

1. **`HARNESS_AUTORESUME` 기본 OFF.** 자동 provider 비용이 발생할 수 있으므로 명시적 opt-in일 때만 auto-resume 동작.
2. **자동 재개 대상 보수적 제한** — 아래 4조건을 **모두** 만족할 때만 `prepareResume({kind:'auto'})` → `executeResume`:
   - `failedReason === 'process_restart'`
   - `ExecutionPlan` 존재
   - `done` task ≥ 1
   - non-done task ≥ 1
3. **stale cutoff = 기존 15분 유지** (`HARNESS_RECOVERY_STALE_MS`). recovery가 너무 최근의 planning/running run을 건드리지 않음.
4. **실행 시점 lazy 유지.** `instrumentation.ts` 등 eager boot hook 미도입. 기존 라우트 진입 시 `ensureRecovered()` 호출 구조 안에서 확장.
5. **auto-resume 실패 시 무리한 반복 금지.** `failed` 상태로 남기고 RunEvent에 실패 기록(`run.autoresume.failed`). UI는 기존 retry/resume UX로 사용자가 직접 재시도.

**설계 정합 갱신(결정 #2 반영):** 적격성을 `failedReason === 'process_restart'`로 게이팅하므로, **기존 fail-marking 트랜잭션/이벤트를 한 줄도 바꾸지 않고**(=`run.completed(process_restart)` 그대로 발행) 그 **뒤에 auto-resume를 순수 추가 단계로 얹는다**. 즉 fail 경로(Phase 8/9 영향 0)는 불변, `maybeAutoResume()`만 추가. 감사 이벤트 순서: `run.completed(process_restart, success:false)` → `task.reset…` → `run.resumed(trigger:'process_restart')` → 정상 실행 → `run.completed(success:true)`. (`run.resumed`가 run을 다시 `running`으로 돌리므로 UI/replay는 정상 복구로 수렴.)

**추가 제약(확정):** schema migration 0 · new dependency 0 · executor core 변경 최소화 · Phase 8/9 resume/rerun 흐름 불변 · 구현 브랜치 `phase-10-auto-resume`.

---

## Context — 왜 이 작업인가

현재 하니스는 프로세스가 죽으면(개발 중 dev server 재시작, 크래시 등) `running`/`planning` 상태로 DB에 남은 run을
`lib/runtime/recovery.ts`의 `ensureRecovered()`가 **`failed`(reason=`process_restart`)로 마킹만** 한다. 즉,
이미 끝난 `done` task의 결과가 DB에 남아 있어 **재개 가능한데도** 사용자가 수동으로 다시 `/resume`를 눌러야 한다.

Phase 8/9에서 이미 **resume 기계장치**(`prepareResume({kind:'auto'})` → `executeResume`)가 완성되어 있다.
`prepareResume(auto)`는 `failed`/`cancelled` task만 `pending`으로 리셋하고 `done` task는 결과를 재사용한다.
Phase 10은 **recovery 경로가 "failed 마킹"에서 멈추지 말고, 적격 run에 한해 그 resume 기계장치를 자동으로 호출**하도록
확장한다. 새 테이블/마이그레이션/의존성 없이, 기존 검증된 코드를 조합하는 것이 목표다.

**의도한 결과:** 프로세스 재시작 후 사용자가 앱을 열면(또는 첫 API 요청 시), 중단된 run이 `done` task를 재사용하며
중단 지점부터 자동으로 이어서 완료된다. 단, 무단 provider 비용 발생을 막기 위해 **기본값 OFF의 env 플래그로 opt-in**한다.

---

## 현재 코드 기준 사실 정리 (검증됨)

| 항목 | 사실 | 위치 |
| --- | --- | --- |
| 복구 sweep | `ensureRecovered()`는 프로세스당 1회(memoized), 모든 라우트 진입부에서 await. `planning`/`running` & `updatedAt < cutoff`(기본 15분, `HARNESS_RECOVERY_STALE_MS`) run을 찾아 `failed`+running task `failed` 마킹 후 `run.completed(success:false)` 이벤트. **재개는 안 함.** | `src/lib/runtime/recovery.ts:14-64` |
| resume 진입 | `prepareResume(runId,{kind:'auto'})`는 `run.status==='failed'`일 때만 동작. `failed`/`cancelled` task→`pending`(result wipe), run→`running`, `task.reset`+`run.resumed` 이벤트. executor는 안 돌림(라우트가 책임). | `src/lib/runs/resume.ts:56-153` |
| resume 발사 패턴 | 라우트가 `AbortController` 등록(`registerRunController`) 후 `void executeResume(runId,{signal}).finally(clearRunController)` fire-and-forget. | `app/api/runs/[runId]/resume/route.ts:32-40` |
| executor | `executeResume`는 `inFlight` Set으로 run당 1회 가드. `resumeInner`는 plan+task 로드 → `done` 결과 seed → 비-done task를 topo 순서로 실행. **plan 없으면 동작 불가.** concurrency=1 고정. | `src/lib/dag/executor.ts:83-95, 97-247` |
| 레지스트리 | `registerRunController`/`clearRunController`/`abortRun` 재사용 가능. 프로세스 재시작 시 controller/bus는 소실(주석에 명시). | `src/lib/dag/runRegistry.ts:57-77` |
| 이벤트 타입 | `run.resumed`는 enum에 존재하나 `RunResumedPayload.mode`는 `'auto'|'fromTask'`로 Phase 9의 `'rerunFromTask'` 누락. `task.reset`은 enum에 **없음**(free-form 문자열로 사용 중). | `src/lib/events/types.ts:5-17, 85-90` |
| 테스트 관례 | 모든 `*.test.ts`가 **순수 함수**만 테스트(어떤 테스트도 `@db/client`/`prisma` import 안 함). `recovery.ts`엔 테스트 없음. | `src/lib/**/*.test.ts` (grep 결과 0건 DB-touch) |
| 스키마 | 마이그레이션 3개, migration 2 이후 안정. `Task.result`는 덮어쓰기 단일 JSON `{text,bytes}`. attempt/retry 카운트 필드 없음. | `apps/web/prisma/schema.prisma`, `prisma/migrations/` |

**핵심 통찰:** recovery가 run을 `failed(process_restart)`로 마킹 → running task도 `failed`가 됨 → 이 상태가 바로
`prepareResume(auto)`의 입력 조건과 정확히 맞는다. 즉 **recovery → prepareResume(auto) → executeResume**가 자연스럽게 조합된다.
`failed`로 마킹된 (구)running task는 `pending`으로 리셋되어 재실행되고, `done` task는 결과가 재사용된다. **executor 변경 불필요.**

---

## 포함 범위 (In Scope)

1. **자동 재개 코어** — `recovery.ts`가 적격 중단 run에 대해 `prepareResume({kind:'auto'})` + `executeResume`(AbortController 등록 포함)를 자동 발사.
2. **opt-in 플래그** — `HARNESS_AUTORESUME`(기본 **OFF**). OFF면 현재 동작(failed 마킹만) 100% 유지. ON일 때만 자동 재개.
3. **순수 판정 함수 추출** — `shouldAutoResume(run, { autoResume })` → `boolean` (결정 #2의 4조건). 단위 테스트 대상.
4. **감사(audit)** — 성공 재개는 `run.resumed` payload에 `trigger:'process_restart'` 기록. **실패 재개는 `run.autoresume.failed`(reason) 기록 후 `failed` 유지, 반복 없음**(결정 #5). 기존 fail-marking(`run.completed(process_restart)`)은 그대로 유지(추가 단계 설계).
5. **(곁들이기) 이벤트 타입 위생** — `RunResumedPayload.mode`에 `'rerunFromTask'` 추가, `trigger?` 필드 추가, `task.reset` / `run.autoresume.failed` 타입 문서화(`appendEvent.type`은 free-form `string`이라 강제는 아니나 가독성/감사 추적용).

## 제외 범위 (Out of Scope) — Phase 11+로 명시 보류

- **`planning` 단계 중단 run의 자동 재개** — plan이 없거나 불완전 → `executeResume`가 `no_plan`. 재계획(executeRun)은 PO/Lead 재호출 비용 + 비결정성 → 보류. 이 run들은 현행대로 `failed` 마킹.
- **동시성 > 1 / 병렬 task 실행** (Phase 후보였으나 별도 테마).
- **TaskAttempt 영속 테이블** (0-migration 정책에 따라 보류).
- **eager 부팅 훅(`instrumentation.ts`)** — 클라이언트 요청 없이도 부팅 즉시 재개. 본 Phase는 기존 lazy `ensureRecovered` 경로 유지(아래 결정 질문 참조).
- **SIGTERM/SIGINT graceful shutdown 마킹** — 신호 핸들러 추가는 위험/범위 초과로 보류.

---

## 변경 계획 (lib / API / UI)

### lib (코어)

**`src/lib/runtime/recovery.ts`** (주 변경 — 기존 fail-marking은 불변, auto-resume를 추가 단계로 얹음)
- 순수 함수 추가(결정 #2, 테스트 대상):
  ```ts
  export interface AutoResumeCandidate {
    failedReason: string | null;
    hasPlan: boolean;
    doneCount: number;
    nonDoneCount: number;
  }
  export function shouldAutoResume(
    run: AutoResumeCandidate,
    opts: { autoResume: boolean },
  ): boolean {
    if (!opts.autoResume) return false;
    if (run.failedReason !== 'process_restart') return false;
    if (!run.hasPlan) return false;
    if (run.doneCount < 1) return false;
    if (run.nonDoneCount < 1) return false;
    return true;
  }
  ```
- `recoverInterruptedRuns()` 루프: **기존 트랜잭션/`run.completed(process_restart)` 이벤트 그대로 유지**. 그 직후, `autoResumeEnabled()`이면 `await maybeAutoResume(r.id)` 호출(추가 단계).
- `maybeAutoResume(runId)` (신규, 임퓨어):
  1. 방금 마킹된 run 재조회: `failedReason`, `plan{select:{id}}`, `tasks{select:{status}}` → `doneCount`/`nonDoneCount` 산출.
  2. `shouldAutoResume(...)` false면 return(=`failed` 유지).
  3. `const res = await prepareResume(runId, { kind:'auto' }, { trigger:'process_restart' })` — run→running, failed→pending 리셋, done 재사용, `task.reset`+`run.resumed(trigger)` 이벤트.
  4. `isResumeError(res)`면 → **반복 없음**: `run.autoresume.failed`(reason) 이벤트만 남기고 return(run은 `failed` 그대로, 결정 #5).
  5. ok면 `AbortController` 등록 후 `void executeResume(runId,{signal}).catch(...).finally(clearRunController)` — `/resume` 라우트와 동일 패턴. catch에서 (드문) executor throw 시 `updateMany({where:{id,status:'running'}}, failed)`로 방어적 복귀 + `run.autoresume.failed` 기록.
- 메모이즈/once-per-process 보장 유지(`recovered` promise). 여러 stale run은 순차 prepare 후 executor는 비동기 발사(run별 독립, `inFlight`가 중복 가드).
- `autoResumeEnabled()` env 헬퍼 추가(`HARNESS_AUTORESUME` == `'1'`/`'true'`, 기본 OFF). 기존 `recoveryStaleMs()`(15분) 유지.

**`src/lib/runs/resume.ts`** (소폭)
- `prepareResume(runId, mode, opts?: { trigger?: 'process_restart' })` 선택 3번째 인자 추가. `run.resumed` payload에 `trigger`가 있으면 병합. 기존 호출부 무영향(하위호환).

**`src/lib/events/types.ts`** (곁들이기/위생)
- `Phase4EventType`(또는 별도 Phase10 타입)에 `'task.reset'` 추가.
- `RunResumedPayload.mode`에 `'rerunFromTask'` 추가, `trigger?: 'process_restart'` 추가.

> import 방향: `recovery.ts` → `resume.ts`, `executor.ts`, `runRegistry.ts`. executor/resume/runRegistry는 recovery를 import하지 않으므로 **순환 의존 없음**. 모두 server-side nodejs(`runtime='nodejs'` 라우트에서만 진입).

### API
- **신규 라우트 없음.** 동작은 기존 `ensureRecovered()`(모든 라우트 진입부 호출)에 자연 편승. 즉 재시작 후 **첫 API 요청** 시 자동 재개 트리거.

### UI
- **필수 변경 없음.** `RunStream.tsx`는 이미 `run.resumed`를 처리하고 SSE/폴링으로 진행을 따라간다. 재개 시 사용자는 run이 다시 `running`으로 살아나는 것을 그대로 본다.
- (선택, 본 Phase 제외 가능) run 헤더에 "재시작 후 자동 재개됨" 배지(`run.resumed.trigger==='process_restart'` 기반). 결정 질문 참조.

---

## 스키마 변경 필요 여부

**없음 (0 migration).** 추가 테이블/컬럼/enum 없음. `failed`/`pending`/`running`은 기존 free-form status 문자열, 신규 이벤트는
free-form `RunEvent.type`/`payload`(컴파일 타임 타입만 추가). prisma 스키마 파일 **무수정**, 마이그레이션 폴더 **0개 추가**.

---

## 테스트 계획

레포 관례(순수 함수 단위 테스트, DB/provider는 수동 smoke)를 따른다.

**신규: `src/lib/runtime/recovery.test.ts`** — `shouldAutoResume` 순수 테스트:
- `autoResume:false` → 항상 `false` (기본 동작 보존 보장).
- `failedReason !== 'process_restart'` → `false`.
- `hasPlan:false` → `false`.
- `doneCount:0` (재사용할 진행 없음) → `false`.
- `nonDoneCount:0` (재개할 일 없음) → `false`.
- 4조건 모두 충족(`process_restart` + plan + done≥1 + nonDone≥1) → `true`.

**기존 테스트 회귀(영향 확인):**
- `resumePlan.test.ts` — `prepareResume` 3번째 인자는 옵션이므로 무영향. mode/타입 변경 컴파일 통과 확인.
- 전체 `corepack pnpm --filter web typecheck` + `test`(현재 161 통과) 유지 + recovery 케이스 추가.
- `corepack pnpm --filter web exec next build` PASS(라우트 수 변동 0).
- `corepack pnpm --filter web exec prisma migrate status` → "up to date", **0 added**.

---

## 수동 smoke 시나리오 (provider=Gemini)

> dev server가 Prisma query-engine DLL을 잡으므로 전체 `pnpm build` 대신 `next build` 단독 사용(세션 노트 참조).

1. **중단 상태 인위 재현** (provider 비용 최소화):
   - dev DB의 succeeded 멀티 task run(예: 2~5 task) 하나를 골라, DB 직접 업데이트로 run.status=`running`, 마지막 leaf task.status=`running`, `updatedAt`을 cutoff 이전(예: 20분 전)으로 조작. 상위 task는 `done` 유지.
   - 또는 실제 다중 task run을 시작한 직후 dev server를 강제 종료.
2. **OFF 회귀 확인:** `HARNESS_AUTORESUME` 미설정으로 dev server 기동 → 아무 run API 1회 호출 → 해당 run이 `failed(process_restart)`로만 마킹되고 재개 안 됨(현행 동작 보존).
3. **ON 자동 재개:** `HARNESS_AUTORESUME=1`로 dev server 기동 → run 페이지 진입(또는 아무 run API 1회) →
   - 기대: `done` task의 `startedAt` **불변**(재사용), (구)running task가 `pending`→재실행→`done`, run이 `running`→`succeeded`.
   - 이벤트(시간 역순): `run.completed`(이번엔 success) … `task.completed` … `run.resumed(trigger:'process_restart')` … `task.reset` … `run.completed(process_restart, success:false)` … (추가 단계 설계상 process_restart의 `run.completed`는 **유지**되고, 그 뒤 `run.resumed`가 run을 다시 살린다.)
4. **폴백 안전:** plan 없는(planning 단계) 중단 run은 ON에서도 `failed`로만 남는지 확인.
5. **취소 호환:** 자동 재개 중 `/cancel` 호출 시 AbortController로 중단되는지 확인(레지스트리 재사용).

---

## 리스크와 결정 질문

### 리스크
- **R1 (중심): recovery가 provider/LLM 호출을 유발.** 지금까지 순수 DB였던 복구 경로가 비용 발생 경로가 됨. → **env 기본 OFF opt-in**으로 차단. ON은 명시적 선택.
- **R2: 부팅 시 stampede.** 중단 run이 여러 개면 동시에 여러 executor 발사 → provider 부하 스파이크. (run별 executor는 concurrency=1이지만 run끼리는 병렬.) 로컬 단일 사용자 가정상 보통 1~2개로 적음.
- **R3: cutoff 지연.** 기존 15분 cutoff 때문에 방금 죽인 run은 즉시 재개되지 않음(15분 경과 후 또는 `HARNESS_RECOVERY_STALE_MS` 하향 필요).
- **R4: lazy 트리거.** 첫 API 요청 전까지 재개 안 됨(앱을 안 열면 대기). eager 부팅 훅 부재.

### 결정 질문 (3~5)
1. **opt-in vs 기본 ON** — `HARNESS_AUTORESUME` 기본값을 **OFF(권장)**로 둘까, 아니면 로컬 편의를 위해 기본 ON으로 할까? (R1)
2. **stampede 상한** — 부팅 시 동시 자동 재개 run 수를 `HARNESS_AUTORESUME_MAX`(예: 기본 1~2)로 제한할까, 아니면 적격 전부 발사할까? (R2)
3. **cutoff 처리** — 자동 재개도 기존 15분 cutoff를 그대로 따를까(최소 변경), 아니면 "프로세스당 1회 sweep 시점엔 `inFlight`가 비어 있으므로 모든 `planning`/`running`은 진짜 orphan"이라는 근거로 **재개 판정에 한해 cutoff 무시**(진정한 부팅 재개)할까? (R3)
4. **트리거 방식** — 본 Phase는 기존 **lazy `ensureRecovered`(권장, 0 신규 파일)** 유지로 갈까, 아니면 `instrumentation.ts` eager 부팅 훅까지 포함할까? (R4)
5. **UI 배지** — `run.resumed.trigger==='process_restart'` 기반 "재시작 후 자동 재개됨" 배지를 본 Phase에 포함할까, 아니면 코어/감사만 하고 UI는 보류할까?

---

## Known Limitations (Phase 11+)

- **Single-worker / process-local 가정** — auto-resume의 중복 방지는 executor의 process-local `inFlight` Set과 controller 레지스트리(`runRegistry.ts`)에 의존한다. 여러 Next worker/프로세스가 동시에 뜨면 같은 run을 두 worker가 각각 auto-resume해 **provider 이중 실행**이 발생할 수 있다. 현 하니스는 단일 worker(`next dev`/단일 프로세스)를 가정하므로 비범위. multi-worker 배포 시 cross-process claim/lock 필요.
- **task 사이 중단(pending-only)은 auto-resume 대상 아님** — done은 있으나 비-done이 전부 `pending`(failed/cancelled 없음)인 run은 `prepareResume(auto)`가 reset할 대상이 없어 재개되지 않는다(`no_resumable_tasks`로 조용히 failed 유지). 이는 Phase 8 수동 `resume(auto)`와 동일한 한계로, 보통 sweep이 중단된 running task를 failed로 마킹하므로 거의 발생하지 않는다.
- **lazy 트리거** — 부팅 후 첫 API 요청 전까지 재개되지 않음(eager boot hook 미도입, 결정 #4).

## 검증(Verification) 요약

```
corepack pnpm --filter web typecheck                  # 0 errors
corepack pnpm --filter web test                       # 161 + recovery 케이스 통과
corepack pnpm --filter web exec next build            # PASS, 라우트 수 변동 0
corepack pnpm --filter web exec prisma migrate status # up to date, 0 added
```
+ 위 수동 smoke 2(OFF 회귀)·3(ON 자동 재개)·4(planning 폴백) 통과.
