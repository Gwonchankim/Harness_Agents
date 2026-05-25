# Phase 11 Plan — Attempt History & Before/After Result Comparison (TaskAttempt)

> 상태: **계획 확정 — 구현 대기**. 본 문서 완성 후 사용자 지시에 따라 구현 착수. `PHASE_LOG.md`는 구현/검증 후 별도 갱신.
> 방향(확정): **TaskAttempt 신규 테이블 1개(1 migration)** + **task별 attempt 타임라인 + 최신↔직전 attempt full diff UI**. 범위는 좁게.

---

## 승인 후 확정 결정사항 (Confirmed decisions — 2026-05-25)

1. **attempt 단위** = `runOneTask` 1회 = `TaskAttempt` 1개. transient retry(rate_limit/timeout으로 인한 `task.retry.attempt`)는 **별도 attempt로 승격하지 않고** 한 attempt 내부 이벤트로 유지.
2. **source 4값** = `initial | resume | rerun_from_task | auto_resume`. 라우트/recovery에서 **명시적으로 전달**(거친 2값보다 Phase 8/9/10 흐름 구분·디버깅 가치 큼).
3. **backfill 없음**. Phase 11 이전 run은 TaskAttempt 0행 → UI에서 "attempt 기록 없음 / 이전 버전 run"으로 degrade. `Task.result`로 attempt #1을 합성하는 스크립트는 정확한 과거 history가 아니므로 **만들지 않음**.
4. **`/attempts` 응답에 `resultText` 인라인 포함**. 단 **task card 펼침 시에만 온디맨드 fetch** — run list/전체 run load에서는 attempt 전문을 부르지 않음. 대형 출력 문제 발생 시 Phase 12에서 메타/전문 분리.
5. **cancelled/orphan attempt**: abort/cancel 시 attempt를 `cancelled`로 닫음. recovery sweep도 고아 `running` TaskAttempt를 `cancelled`(error=`process_restart`)로 닫음. **running 방치 금지.**

**구현 가드(확정):**
- TaskAttempt 테이블 1개 외 **schema 변경 금지**.
- `Task.result`는 **유지**(latest output cache/source). TaskAttempt = **history source of truth**.
- `RunEvent`는 audit/stream 용도 유지.
- `resultText`는 redactor 미경유 전문 저장 → 기존 `Task.result`와 **동일 신뢰 경계**로 취급(외부 공개/로그 출력 금지).
- `openAttempt`/`closeAttempt`는 `runOneTask` 주변 **최소 삽입**(executor 흐름 과변경 금지).
- `attemptNumber`는 taskId별 `max+1` 계산 + `@@unique([taskId, attemptNumber])`로 방어. **unique 충돌 시 조용히 덮지 말고 명확한 오류로 실패.**
- 기존 Phase 8/9/10 resume/rerun/auto-resume 경로 불변 — **순수 테스트+타입체크 통과 후 수동 smoke** 진행.

---

## Context — 왜

Phase 9(done task rerun)·Phase 10(auto-resume) 이후 같은 task가 여러 번 실행될 수 있으나, **이전 attempt의 결과 전문이 내구성 있게 남지 않는다**:
- `Task.result`는 rerun 시 `null`로 덮어써짐(`resume.ts:104`).
- `RunEvent` payload는 `redactEventPayload`의 4KiB(`MAX_EVENT_TEXT_BYTES`, `redactor.ts:13`) truncation을 거쳐 **큰 결과 전문을 못 담음**. `task.reset`은 `previousBytes`(크기)만 기록(`resume.ts:112-133`).
- `agent.output.delta` 재생 재구성은 lossy + O(n).

목표인 "attempt별 결과 history"·"rerun 전후 full 비교"는 이벤트 재구성으로 **신뢰성 있게 불가**. 전문 스냅샷은 **redactor 미경유 테이블 컬럼**(현재 `Task.result`처럼 `executor.ts:692-695`에서 직접 write)에 둬야 한다. → **full attempt history의 source of truth = TaskAttempt**, RunEvent는 audit/stream 유지.

---

## 현재 코드 기준 사실 정리 (검증됨)

| 항목 | 사실 | 위치 |
| --- | --- | --- |
| task 실행 1회 | `runOneTask`의 `while(true)` 1 호출 = 논리적 attempt 1개. transient 재시도마다 `task.started` 재방출(버퍼 리셋). | `executor.ts:616-752` |
| 성공 write | `Task.result={text,bytes}` JSON + `task.completed`. **redactor 미경유(전문 보존)**. | `executor.ts:692-709` |
| 실패 write | `Task.error`(240자 redact) + `task.failed`. | `executor.ts:736-748` |
| rerun 리셋 | `Task.result/error/startedAt/completedAt=null`, status=pending. 이전 전문 소실. | `resume.ts:100-109` |
| 이벤트 size guard | `appendEvent`→`redactEventPayload`가 4KiB 초과 문자열 truncate. | `events/append.ts:22`, `redactor.ts:13` |
| 이벤트 인덱스 | `RunEvent @@index([runId,createdAt])`, `@@index([taskId])`. | `schema.prisma:276-278` |
| diff 재사용 | `diffLines(before,after):DiffLine[]`('add'|'del'|'ctx') + `countDiff`. 의존성 0, 테스트 있음. | `feedback/diff.ts:17-66` |
| UI 재구성 | RunStream 리듀서가 `task.started`/`task.reset`에서 버퍼 비움 → **최신 attempt만** 보존. | `RunStream.tsx` |
| 마이그레이션 | 3개. `build`=`prisma generate && next build`(자동 migrate 아님). prisma cwd=apps/web 필요. | `prisma/migrations/`, `package.json:7` |
| 관계 필드 | Prisma 관계 필드는 가상 → 신규 테이블 FK만 DDL, 기존 테이블 컬럼 변경 0. | schema.prisma |

---

## 포함 범위 (In Scope)

1. **`TaskAttempt` 테이블 1개** — attempt별 status/resultText(전문)/error/timing/attemptNumber/source 영속.
2. **executor 쓰기 훅(최소 삽입)** — `runOneTask` 1회당 open(running)→close(done/failed/cancelled). 기존 `Task.result`/RunEvent write는 **유지**(병행).
3. **source 스레딩(4값)** — `initial|resume|rerun_from_task|auto_resume`.
4. **read API** — `GET /api/runs/[runId]/tasks/[taskId]/attempts` (온디맨드, resultText 인라인).
5. **UI** — task별 attempt 타임라인 + 최신↔직전 `resultText` full diff(`diffLines` 재사용).
6. **recovery 보정** — sweep이 고아 `running` TaskAttempt를 `cancelled`(error=process_restart)로 닫음.
7. **순수 헬퍼 + 테스트** — `nextAttemptNumber`, `selectComparison`.

## 제외 범위 (Out of Scope) — Phase 12+

- 임의의 두 attempt 선택 비교 UI(기본은 최신↔직전 고정).
- result.md/report.md/agent-reports 전체 diff(비교 대상은 `TaskAttempt.resultText`만).
- transient 재시도를 별도 attempt로 승격.
- `Task.result` 제거/구조 변경(유지).
- 새 dependency, 동시성>1, TaskAttempt 외 schema 추가.
- `/attempts` 메타/전문 분리(필요 시 Phase 12).

---

## TaskAttempt가 정말 필요한가 — 분석 + 0-migration 대안 비교

| 요구 | 0-migration (RunEvent 재구성) | TaskAttempt 테이블 |
| --- | --- | --- |
| 이전 attempt **결과 전문** | ❌ 4KiB truncation + `Task.result` 덮어쓰기 → 신뢰 불가 | ✅ redactor 미경유 컬럼에 전문 |
| attempt별 status/duration/error 1급 조회 | △ 전 이벤트 스캔·파싱(O(n)) | ✅ 행 단위 인덱스 조회 |
| attemptNumber 영속 | ❌ 유도값(task.reset 카운트) | ✅ 컬럼 + `@@unique` |
| 스키마 변경 | ✅ 0 | ❌ 신규 테이블 1개 |
| 구현량 | 중(재구성 로직) | 소~중(write 훅 + 테이블) |

**결론:** 전후 full 비교는 0-migration으로 **원천적 한계**(size guard·덮어쓰기). 비용 작은(테이블 1개, 기존 테이블 DDL 0) TaskAttempt가 "DB=source of truth"에 부합 → **TaskAttempt 채택**. (0-migration은 본 비교로 기록, 미채택.)

---

## 스키마 변경안 + 마이그레이션 영향 / rollback / backfill

**신규 모델** (`schema.prisma`):
```prisma
model TaskAttempt {
  id            String    @id @default(cuid())
  taskId        String
  runId         String
  attemptNumber Int       // 1-indexed per task; max+1, @@unique 방어, 충돌 시 명확 오류
  status        String    // running | done | failed | cancelled
  source        String    // initial | resume | rerun_from_task | auto_resume
  resultText    String?   // 성공 시 task output 전문(redactor 미경유, source of truth)
  resultBytes   Int?
  error         String?   // 실패 시 redact 요약(<=240)
  startedAt     DateTime
  completedAt   DateTime?
  createdAt     DateTime  @default(now())

  task Task @relation(fields: [taskId], references: [id], onDelete: Cascade)
  run  Run  @relation(fields: [runId], references: [id], onDelete: Cascade)

  @@unique([taskId, attemptNumber])
  @@index([taskId])
  @@index([runId])
}
```
- **기존 Task/Run**: 가상 back-relation 필드만 추가(`attempts TaskAttempt[]` / `taskAttempts TaskAttempt[]`) → **컬럼/DDL 변경 0**.
- **마이그레이션 영향**: DDL = `CREATE TABLE TaskAttempt` + 2 index + 1 unique + 2 FK(onDelete Cascade). 기존 데이터 변경 없음. 적용: cwd=apps/web `prisma migrate dev --name phase11_task_attempt`. (dev server가 query-engine DLL 점유 시 `prisma generate` EPERM → dev server 중지 후 실행.) 3→**4개**.
- **Rollback**: 순수 가산 테이블. 코드 revert + 테이블 drop만으로 안전 복귀. 기존 read(`Task.result`) 무영향.
- **Backfill**: **없음**(확정). historical run은 0행 → UI degrade. 합성 스크립트 미작성.

---

## API / UI / lib 변경 계획

### lib (신규/소폭)
- **`src/lib/runs/taskAttempt.ts`** (신규) — `openAttempt({runId,taskId,source})`: `attemptNumber=nextAttemptNumber(max)+1`, status='running', startedAt; 반환 id. **unique 충돌은 throw**(조용한 덮어쓰기 금지). `closeAttempt(id,{status,resultText,resultBytes,error,completedAt})`. `nextAttemptNumber(existing)`는 순수 함수(테스트).
- **`src/lib/runs/attemptCompare.ts`** (신규, 순수) — `selectComparison(attempts)` → `{ latest, previous } | null`(done/failed 중 최신 2개, running 제외). 단위 테스트.
- **`src/lib/feedback/diff.ts`** — 재사용(무수정).

### executor / 흐름 (추가·최소)
- `runOneTask`: 시작에 `openAttempt(source)`; 종료 경로(done/failed/aborted, pre-flight 실패 포함)에서 `closeAttempt`. 기존 write 불변(병행). `source`는 인자 전달.
- `executeRun(runId,{signal})` → `'initial'`; `executeResume(runId,{signal,source})` → resumeInner→runOneTask 전달.
- 호출부: `/start`='initial', `/resume`='resume', `/tasks/[taskId]/retry`='rerun_from_task', `recovery.maybeAutoResume`='auto_resume'.
- **`recovery.ts`**: sweep에 고아 `running` TaskAttempt를 `cancelled`(error=process_restart)로 닫는 updateMany 추가.

### API (신규 read 1개)
- **`GET /api/runs/[runId]/tasks/[taskId]/attempts`** — `ensureRecovered()` 후 TaskAttempt `attemptNumber asc` 반환(메타 + `resultText` 인라인). **task card 펼침 시에만 호출**, run list/전체 load에서는 미호출.

### UI (좁게)
- **`src/components/run/AttemptHistory.tsx`** (신규) — task별 collapsible. 타임라인 행(attemptNumber, status 배지[`DagGraph` STATUS_STYLE 재사용], source, duration, resultBytes, 시각, error) + 최신↔직전 `resultText` `diffLines` 렌더(RevisionDiff add/del/ctx 스타일 재사용). 0행이면 "기록 없음" degrade.
- 부착: `DagGraph` task 카드(터미널) 또는 `AgentReportPane` — 기존 레이아웃 비파괴, 펼침 시 fetch.

> RunEvent/스트리밍/Phase 8·9·10 경로 불변. TaskAttempt write는 모두 가산.

---

## 테스트 계획 (레포 관례: 순수 단위 + DB/provider는 수동 smoke)

- **신규 순수 테스트**: `taskAttempt.test.ts`(`nextAttemptNumber`: 빈/연속/누락), `attemptCompare.test.ts`(`selectComparison`: 0/1/2/3 attempt, done·failed 혼합, running 제외).
- 기존 `diff.test.ts` 회귀.
- 전체 `typecheck` + `test`(현재 167 + 신규) + `next build`(라우트 +1) + `prisma migrate status`(**4 migrations**, drift 0). **순수 테스트+타입체크 선통과 후** 수동 smoke.

---

## 수동 smoke 시나리오 (provider=Gemini, 최소 task)

1. `prisma migrate dev` 적용(dev server 중지 후) → migrate status 4개.
2. **rerun 전후**: 2-task succeeded run에서 leaf done task를 rerun → TaskAttempt 2행(#1, #2 source=rerun_from_task), `resultText` 상이. `/attempts` + UI 타임라인 2행 + 최신↔직전 diff.
3. **auto-resume**: HARNESS_AUTORESUME=1로 중단 run 재개 → attempt `source=auto_resume`.
4. **실패 attempt**: 실패 task → attempt status=failed + error, diff는 직전 done과 비교.
5. **historical run**(0행) → "기록 없음" degrade, 기존 출력 정상.
6. **cancel/restart 고아**: 실행 중 취소/프로세스 종료 후 sweep → 고아 running attempt가 `cancelled`로 닫힘.

---

## 리스크 (결정 질문은 위 Confirmed decisions에서 해소)

- R1 attempt 단위 혼동 → 확정: runOneTask 1회=1 attempt.
- R2 `resultText` 전문 저장 시 행 크기 증가 → 기존 `Task.result`와 동일 경계(새 리스크 아님), 외부 노출 금지.
- R3 source 스레딩이 executeResume 시그니처 + 3 호출부 표면 증가 → 작음, 가산.
- R4 마이그레이션 운영(Windows DLL EPERM) → dev server 중지 후 migrate.
- R5 attemptNumber 경합 → 단일 프로세스(concurrency=1) + `@@unique` 방어 + 충돌 시 throw.

---

## 검증(Verification) 요약
```
corepack pnpm --filter web typecheck                  # 0 errors
corepack pnpm --filter web test                       # 167 + 신규 순수 케이스
corepack pnpm --filter web exec next build            # PASS, 라우트 +1(/attempts)
corepack pnpm --filter web exec prisma migrate status # 4 migrations, drift 0
```
+ 수동 smoke 2(전후 diff)·3(auto_resume source)·5(historical degrade)·6(고아 close) 통과. Phase 8/9/10 경로 무영향 확인.
