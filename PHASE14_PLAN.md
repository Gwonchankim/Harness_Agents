# Phase 14 Plan — Reports ↔ TaskAttempt Linkage

> 상태: **승인 완료 — 구현 대기 (코드 미수정)**. `PHASE_LOG.md`는 구현/검증 후 별도 갱신.
> 주 테마: Phase 11 **TaskAttempt history**를 Phase 5 **report export 흐름**에 연결 — `report.md`(run-level)와 `agent-reports/{agentId}.md`(agent/task별)에 attempt/retry/rerun/resume **요약** 반영. `result.md`(deliverable)는 **무변경**. **schema 0, dependency 0, 신규 API 0** 목표.

> 파일명 정정: 사용자가 언급한 `lib/results/exportRunOutputs.ts`의 실제 파일명은 **`lib/results/exportReports.ts`** 입니다.

---

## 승인 후 확정 결정사항 (Confirmed — 2026-05-25)

1. **`result.md` 무변경** — 최종 deliverable. attempt/retry/rerun 이력은 실행 관측 정보이므로 **report 계열에만** 반영. `finalResult.ts` / FinalResult UI / executor의 `exportFinalResult` 흐름 불변.
2. **요약만 (전문 미포함)** — `report.md`/`agent-reports/{agentId}.md`에 `TaskAttempt.resultText` 전문은 **절대 미포함**. 포함 가능 항목: attempt count · status별 count · source별 count(initial/resume/rerun_from_task/auto_resume) · latest attempt status/source · rerun/resume/auto_resume 여부 · failed/cancelled attempt 수 · duration/resultBytes 요약. 전문 비교/열람은 Phase 12 AttemptHistory UI 책임.
3. **Artifact overwrite 현행 유지** — 파일은 기존처럼 덮어쓰기, DB `Artifact` row는 기존 정책대로 새 row append. `(runId, kind, path)` upsert/Artifact 정리는 **Phase 15+ 보류**.
4. **historical fallback** — TaskAttempt 없는 historical run은 attempt 섹션을 **생략하거나 "No attempt history recorded"** 로 graceful degrade. 과거 파일 소급 재생성/backfill **안 함**.
5. **다수 attempt** — 요약 중심이므로 agent-report에 **전체 attempt 요약 표시**(task당 상한 N 없음). `resultText` 전문 미포함이라 파일 크기 리스크 낮음. compact mode/pagination은 **Phase 15+ 보류**.

**추가 원칙(확정):** schema migration **0** · dependency **0** · 신규 API **0** · executor 로직 변경 없음 · `result.md`/FinalResult UI 변경 없음 · `report.md`·`agent-reports`만 attempt summary 반영 · **`TaskAttempt.resultText`는 쿼리/select 하지 않음**.

---

## 1. 현재 코드 기준 사실 정리 (검증됨)

| 항목 | 사실 | 위치 |
| --- | --- | --- |
| 리포트 생성 시점 | executor가 run 성공 시마다 `exportRunReports(runId)` 호출(초기 실행 `executeInner` + resume/rerun `resumeInner`). best-effort(실패해도 run 성공 불변). → **rerun/resume/auto-resume 후 리포트 재생성** = 누적 TaskAttempt가 자동 반영됨. | `dag/executor.ts` (executeInner ~505, resumeInner ~251) |
| export 오케스트레이터 | 단일 prisma 쿼리: run + `team.agents` + `plan.rationale` + `tasks{ id, taskKey, name, description, expectedOutput, status, agentId, startedAt, completedAt, result, error }`(orderBy createdAt asc). tasks → `ReportTaskInput` 매핑(outputBytes는 `result` JSON의 bytes, durationMs는 startedAt/completedAt), agentId별 그룹 → `AgentReportTaskInput`(+text=result.text). | `lib/results/exportReports.ts` |
| 파일/Artifact | `writeArtifact()`가 `report.md`/`agent-reports/{agentId}.md`를 `writeWorkspaceFile`로 디스크에 쓰고(덮어쓰기) **매 export마다 새 `Artifact` 행 생성**(kind `report_md`/`agent_report_md`, run-level, taskId 미설정, path/bytes/sha256). upsert/중복제거 없음. | `exportReports.ts` writeArtifact |
| 빌더(순수) | `report.ts`/`agentReport.ts`는 순수 함수, `node:test`로 테스트됨. `RunReportInput`/`ReportTaskInput`(taskKey,title,agentName,status,durationMs,outputBytes,error), `AgentReportInput`/`AgentReportTaskInput`(+description,expectedOutput,text). **현재 TaskAttempt 미참조** — `Task.result`/status/error 최신값만. | `lib/results/report.ts`, `agentReport.ts` (+ tests) |
| result.md | `finalResult.ts`=사용자 deliverable(Final Output + Supporting Agent Outputs). attempt 미참조, 미참조 유지가 맞음. | `lib/results/finalResult.ts` |
| TaskAttempt | Phase 11 테이블. 필드: attemptNumber, status(running|done|failed|cancelled), source(initial|resume|rerun_from_task|auto_resume), resultText, resultBytes, error, startedAt, completedAt. `Task.attempts` 가상 관계 **이미 존재**. | `prisma/schema.prisma` TaskAttempt |
| 연결에 필요한 쿼리 확장 | exportReports의 tasks select에 `attempts: { select: { attemptNumber, status, source, resultBytes, error, startedAt, completedAt }, orderBy: { attemptNumber: 'asc' } }` 추가. **`resultText`는 제외**(크기 + redactor 미경유 신뢰경계 — 전문은 report에 넣지 않음). durationMs는 startedAt/completedAt 파생. | exportReports tasks select |
| 기존 result.md 흐름 보존 | `finalResult.ts`/`exportFinalResult`(executor)는 **무변경**. attempts는 report/agent-report에만 추가하므로 deliverable 흐름과 독립. | — |
| UI 노출 | `report_md`/`agent_report_md` 아티팩트를 링크/프리뷰하는 **UI 없음**(grep 0건) → 리포트는 **파일 export 전용**. (in-app 관측성은 Phase 11/12 AttemptHistory + Phase 13 timeline이 담당.) | components/app 전수 검색 |
| historical run | exportReports는 호출 시 DB 재조회. pre-Phase-11 task는 `attempts` 빈 배열 → attempt 요약 생략(graceful). 단 **이미 생성된 과거 report.md 파일은 그 run을 다시 성공시키지 않는 한 갱신 안 됨**(export는 성공 시에만 발화). | exportReports |

**핵심:** tasks 쿼리에 `attempts` include(resultText 제외) 추가 + 빌더 입력에 optional `attempts` 필드 추가 + 마크다운 요약 렌더. result.md/executor/스키마/의존성/API 무변경.

---

## 2. 포함 범위 / 제외 범위

### 포함 (Phase 14)
1. **빌더 입력 확장(가산)** — `ReportTaskInput`/`AgentReportTaskInput`에 optional `attempts?: AttemptSummaryRow[]`. 기존 호출부/테스트 무영향.
2. **순수 요약 헬퍼** `lib/results/attemptSummary.ts` — attempt 배열 → 요약(총 시도수, 추가 시도(=count-1), source 집합, rerun/auto_resume 여부, 마지막 status). 단위 테스트.
3. **report.md** — task 타임라인 표에 attempt 정보(예: `Attempts` 열 = 시도수, retried/reran 표시) + run-level **"Attempt summary"** 섹션(재시도/rerun/auto-resume된 task만 요약).
4. **agent-reports/{agentId}.md** — task별 **Attempts** 하위 섹션(attemptNumber·status·source·duration·resultBytes·error 요약 행, **전문 미포함**).
5. **exportReports 쿼리 확장** — tasks에 `attempts` include(resultText 제외) + 빌더 입력 매핑.
6. 테스트(빌더·요약 헬퍼·historical(attempts 없음)·multiple/rerun/auto_resume).

### 제외 (Phase 15+)
- **`result.md` 변경**(deliverable, 무변경).
- **UI 노출**(report/agent-report 링크·프리뷰) — 파일 export 전용 유지.
- **Artifact 행 중복제거/upsert**(기존 Phase 5 동작; 별도 과제).
- **과거 run 소급 재생성/backfill**(성공 시에만 export; 소급 안 함).
- attempt **전문(resultText)** 을 report에 포함.
- attempt 전문 전용 export 파일.

---

## 3. 산출물별 정책

| 산출물 | 정책 | 이유 |
| --- | --- | --- |
| **`result.md`** | **무변경** | 사용자 deliverable(최종 산출물). 실행 이력(attempt)은 deliverable이 아님. `finalResult.ts`/executor 흐름 보존. |
| **`report.md`** | run-level **attempt summary 추가** + task 표에 시도수/재실행 표시 | "무슨 일이 있었나"(실행 리포트)에 attempt history가 자연스럽게 속함. |
| **`agent-reports/{agentId}.md`** | task별 **attempt history 요약 추가**(요약 행, 전문 X) | agent별 디버깅 시 해당 task의 시도 내역이 유용. 전문은 in-app AttemptHistory(Phase 12)가 담당. |
| **UI** | 이번 Phase는 **파일 export만** | 리포트 아티팩트 노출 UI가 현재 없고, in-app 관측성은 Phase 11~13에서 이미 제공. UI 노출은 Phase 15+. |

---

## 4. schema / dependency 변경 여부

**schema 0 · dependency 0.** `Task.attempts` 가상 관계는 Phase 11에서 이미 존재 → 쿼리 include만 추가(마이그레이션 불필요). 신규 패키지 없음. (불가피 변경 없음 — 필요한 데이터가 모두 기존 TaskAttempt 테이블에 있음.)

---

## 5. API / lib / UI 변경 계획

### lib (신규/소폭, 순수)
- **`src/lib/results/attemptSummary.ts`** (신규) — 
  ```ts
  interface AttemptSummaryRow { attemptNumber: number; status: string; source: string; durationMs: number | null; resultBytes: number | null; error: string | null; }
  interface TaskAttemptRollup {
    count: number;
    statusCounts: Record<string, number>;   // done | failed | cancelled | running
    sourceCounts: Record<string, number>;   // initial | resume | rerun_from_task | auto_resume
    failedCount: number;                     // failed + cancelled attempts
    latestStatus: string | null;
    latestSource: string | null;
    reran: boolean; resumed: boolean; autoResumed: boolean;
    totalDurationMs: number | null;
    latestResultBytes: number | null;
  }
  export function rollupTaskAttempts(attempts: readonly AttemptSummaryRow[]): TaskAttemptRollup;
  ```
  순수, 테스트. status/source별 count 집계, latest status/source, rerun/resume/auto_resume 판별, failed+cancelled 수, duration/resultBytes 요약. **`resultText`는 입력에 없음(쿼리/select 안 함).**
- **`src/lib/results/report.ts`** — `ReportTaskInput.attempts?: AttemptSummaryRow[]` 추가. 표에 `Attempts`(시도수, >1이면 표시) + 조건부 "Attempt summary" 섹션(rollup 사용). `attempts` 없으면 기존과 동일 출력(하위호환).
- **`src/lib/results/agentReport.ts`** — `AgentReportTaskInput.attempts?: AttemptSummaryRow[]` 추가. task별 Attempts 요약 하위 섹션(있을 때만).

### export 오케스트레이터
- **`src/lib/results/exportReports.ts`** — tasks select에 `attempts`(resultText 제외) include 추가; `reportTasks`/agent-report 매핑에 `attempts` 배열(durationMs 파생) 전달. writeArtifact/파일경로/Artifact 생성 로직 **무변경**.

### executor
- **무변경.** 기존 `exportRunReports` 호출 지점 그대로(성공 시 재생성).

### result.md / finalResult.ts
- **무변경.**

### API / UI
- **신규 API 없음. UI 변경 없음**(파일 export 전용).

> Phase 8~13(resume/rerun/auto-resume/attempt/timeline) 흐름 불변. `result.md` deliverable 불변.

---

## 6. 테스트 계획 (순수 단위 + DB/디스크는 수동 smoke)

- **신규** `attemptSummary.test.ts` — `rollupTaskAttempts`: 0/1/다중 attempt, status별·source별 count 집계, rerun/resume/auto_resume 판별, failed+cancelled 수, latestStatus/latestSource, totalDuration.
- **`report.test.ts`** (확장) — attempts 포함 입력 → 표 `Attempts` 열 + "Attempt summary" 섹션 렌더; **attempts 미지정(historical) → 기존 출력 그대로**(회귀); multiple/rerun/auto_resume 케이스.
- **`agentReport.test.ts`** (확장) — task별 attempt 요약 섹션 렌더; attempts 없을 때 미표시.
- **회귀**: 전체 `typecheck` + `test`(현재 204 + 신규) + `next build`(라우트 변동 0) + `prisma migrate status`(4 migrations, 0 added).

---

## 7. 수동 smoke 시나리오

> export는 run 성공 시 발화. 디스크 경로: `projects/{slug}/runs/{runId}/report.md`, `…/agent-reports/{agentId}.md`, `…/result.md`.

1. **신규 succeeded run**(provider 1회, 또는 기존 succeeded run을 rerun) → report.md에 각 task 1 attempt, agent-report에 attempt 요약; result.md 변화 없음.
2. **rerun된 task가 있는 run**(예: `cmpk0uedb…`/`cmpjndyul…`을 rerun) → 해당 task attempts ≥2, report.md "Attempt summary"에 reran=true·source=rerun_from_task, agent-report에 attempt 행 2개.
3. **auto-resume된 run** → attempt source=auto_resume가 요약에 표시.
4. **TaskAttempt 없는 historical run**(pre-Phase-11) → attempts 빈 배열 → attempt 요약 생략, 기존 report 형식 유지(크래시 없음).
5. **디스크 export 확인**: `result.md`(무변경) / `report.md`(attempt summary 추가) / `agent-reports/*`(attempt 요약 추가) 내용·존재 검증.

---

## 8. 리스크와 결정 질문

### 리스크
- R1 attempt 전문을 report에 넣으면 파일 비대 + 신뢰경계 노출 → **요약만**(전문 제외)으로 회피.
- R2 `writeArtifact`가 export마다 Artifact 행 중복 생성(기존 동작) → Phase 14 범위 밖(결정 질문).
- R3 재시도 매우 많은 task → agent-report attempt 행 다수 → 표시 상한(결정 질문).
- R4 과거 report.md는 재실행 전까지 attempt 미반영(소급 안 함) — 문서화.

### 결정 (확정됨 — 위 "승인 후 확정 결정사항" 참조)
1. result.md = **무변경**(deliverable).
2. report/agent-report = **요약만**(count/status별·source별 count/latest/rerun·resume·auto_resume 여부/failed·cancelled 수/duration·resultBytes), **resultText 전문 제외**.
3. Artifact overwrite = **현행 유지**(파일 덮어쓰기 + DB 새 row append). upsert/정리는 Phase 15+.
4. historical fallback = attempt 섹션 생략 또는 "No attempt history recorded", **소급 재생성/backfill 안 함**.
5. 다수 attempt = agent-report에 **전체 요약 표시**(상한 없음). compact/pagination은 Phase 15+.

---

## 검증(Verification) 요약
```
corepack pnpm --filter web typecheck                   # 0 errors
corepack pnpm --filter web test                        # 204 + attemptSummary/report/agentReport 신규 케이스
corepack pnpm --filter web exec next build             # PASS, 라우트 변동 0
corepack pnpm --filter web exec prisma migrate status  # 4 migrations, 0 added (schema 무변경)
```
+ 수동 smoke 2(rerun summary)·3(auto_resume source)·4(historical 생략)·5(디스크 result/report/agent-reports) 통과. result.md 무변경·Phase 8~13 경로 무영향 확인.
