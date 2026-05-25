# Phase 13 Plan — Run Activity Timeline

> 상태: **계획 검토 단계 (코드 미수정)**. 산출물 확정 후 사용자 지시에 따라 구현. `PHASE_LOG.md`는 구현/검증 후 별도 갱신.
> 주 테마: **Run activity timeline** — Phase 7~12에서 쌓인 `RunEvent`를 run 상세 화면에 사람이 읽기 쉬운 시간순 활동 로그로 노출. **schema 0, dependency 0, 신규 API 0** 목표.

---

## 승인 후 확정 결정사항 (Confirmed — 2026-05-25)

1. **이벤트 범위** — 아래 타입을 timeline에 포함, token/output stream 계열·팀/피드백 이벤트는 제외:
   - 포함: `run.started`, `plan.created`, `run.running`*, `task.started`, `task.retry.attempt`, `task.reset`, `task.completed`, `task.failed`, `run.resumed`, `run.autoresume.failed`, `run.cancelled`, `run.completed`, `result.created`.
   - 제외: `agent.output.delta`, `agent.output.completed`, `revision.*`, `feedback.*`.
   - \***주의(정확성):** `run.running`은 **현재 코드에서 emit되지 않는** 이벤트다(이벤트 어휘에 없음; 상태는 `plan.created` 후 prisma update로 `running`이 되지만 전용 이벤트 없음). → 변환기 type→label 맵에 **인식 가능 타입으로 등록(방어적/미래 대비)** 하되, 현재 run에는 해당 항목이 **나타나지 않음**. 이벤트 emit 추가(executor 변경)는 **본 Phase 범위 밖**(원칙: executor 무수정).
2. **누락/구버전 payload** — 숨기지 않음: type 기반 일반 라벨로 표시, payload 부족 시 가능한 값만 노출(나머지 생략), **알 수 없는 이벤트도 낮은 우선순위/neutral 스타일로 표시**해 historical run이 깨지지 않게 함.
3. **다수 이벤트** — 기존 SSR 1000 / client 2000 윈도 + 컴포넌트 내부 스크롤로 충분. pagination·server-side filtering·take 상향은 **Phase 14+ 보류**.
4. **기본 open/closed + 배치** — 기본 **collapsed**; **단 failed/cancelled run은 자동 expanded** 시작(succeeded는 collapsed 유지). 배치는 **`DagGraph` 아래, Agent Output 위**. 제목 `Run activity` + **이벤트 수 표시**.

**추가 원칙(확정):**
- schema migration **0** · dependency **0** · **신규 API 없음**.
- 기존 `state.events`, `state.tasks`, `state.team.agents`만 사용.
- timeline 변환은 순수 함수 `buildActivityTimeline`으로 분리 + 단위 테스트.
- `agent.output.delta`는 **절대** timeline에 넣지 않음.
- Reports ↔ TaskAttempt 연결은 **Phase 14** 보류.

---

## 권장 순서 검증 (Run timeline 우선)

사용자 추천대로 **Phase 13 = Run activity timeline**, Reports↔TaskAttempt 연결은 **Phase 14로 보류**가 타당. 근거:
- timeline은 이벤트가 **이미 클라이언트 `state.events`에 적재**되어 있어 **신규 API/쿼리 0**, schema 0, dependency 0 → 가장 자기완결적·저위험.
- Phase 7~12에서 저장만 되고 사용자에게 안 보이던 이벤트(retry/reset/resumed/autoresume/cancel)를 드러내는 **즉효 관측성** 가치.
- Reports↔TaskAttempt는 `exportReports` 쿼리 + 리포트 빌더 + (기존 run 재생성) 경로를 건드려 표면이 더 넓고 executor export 경로와 교차 → 별도 Phase가 깔끔.

---

## 1. 현재 코드 기준 사실 정리 (검증됨)

| 항목 | 사실 | 위치 |
| --- | --- | --- |
| 이벤트 어휘 | `RunEvent.type` free-form, 타입은 컴파일 타임. timeline 후보: `run.started, plan.created, task.started, task.completed, task.failed, task.retry.attempt, task.reset, run.resumed, run.autoresume.failed, run.cancelled, run.completed, result.created`. 고볼륨 제외 대상: `agent.output.delta`/`agent.output.completed`. Phase 5 `revision.*`는 팀 단위라 범위 밖. | `src/lib/events/types.ts:5-145` |
| payload 상세 | task.started(taskKey,agentName,title) · task.completed(taskKey,durationMs) · task.failed(taskKey,error,durationMs) · task.retry.attempt(taskKey,attempt,kind,delayMs,retryAfterMs?) · task.reset(taskKey,previousStatus,previousBytes,reason,resetByTaskKey?) · run.resumed(mode,resumedTasks,doneReused,fromTaskKey?,trigger?) · run.autoresume.failed(reason) · run.cancelled(failedReason,cancelledTasks) · run.completed(success,succeededTasks,failedTasks,failedReason?) · plan.created(planId,taskCount,rationale) · result.created(artifactId,path,bytes). | `src/lib/events/types.ts` |
| 이벤트가 이미 클라이언트에 있음 | 페이지가 최근 **1000개** 이벤트를 SSR 로드해 `RunStream`에 `initial.events[]`로 전달. payload는 **파싱된 JSON**. | `app/runs/[runId]/page.tsx` (events take:1000), `RunStream` `InitialEvent {id,type,taskId,agentId,payload,createdAt}` |
| RunStream이 이벤트 보존 | reducer가 `append-events`로 원본 이벤트를 `state.events`에 **그대로 누적**(`.slice(-2000)` 캡). task 상태/출력 갱신과 별개로 이벤트 원본 유지. SSE/폴링 라이브 append도 동일. | `RunStream.tsx` (RUN_EVENT_TYPES, `events:[...].slice(-2000)`) |
| 이름 해석 데이터 | `state.team.agents[]`(id,name,role,isLead,provider,modelId) + `state.tasks[]`(taskKey,name,agentId,status) 클라이언트 보유 → taskKey→task name, agentId/payload.agentName→agent name 해석 가능. | `page.tsx`/`RunStream.tsx` props |
| 조회/정렬 | events `orderBy createdAt asc, id asc`. state route take:1000, events SSE history take:2000. | `app/api/runs/[runId]/state/route.ts`, `events/route.ts` |
| 기존 timeline 없음 | run 이벤트를 사용자에게 시간순으로 보여주는 컴포넌트 **없음**(qa/Timeline은 무관). 신규 작성 필요. | components 전수 검색 |
| 재사용 자산 | `STATUS_STYLE`(DagGraph) · `formatDuration`/`formatAge`(RunProgressOverlay) · `formatMs`/`elapsed`(results/report.ts) · `toLocaleString` · AttemptHistory의 collapsible(▾/▸) 패턴 · RevisionDiff의 리스트/`max-h overflow-auto` 렌더 패턴. 새 dep 불필요(React+Tailwind). | 각 파일 |
| 레이아웃 | RunStream 렌더 순서: 상태/Start 바 → (조건부) 모델복구 → (조건부) Resume/Retry → `DagGraph` → `FinalResultPane` → `AgentReportPane`, + `RunProgressOverlay` 오버레이. | `RunStream.tsx` 렌더부 |

**핵심:** timeline은 **이미 보유한 `state.events`만으로 렌더 가능** → 신규 API/쿼리/스키마 0. 순수 변환 함수 + 신규 표시 컴포넌트 + RunStream 배선만 추가.

---

## 2. 포함 범위 / 제외 범위

### 포함 (Phase 13)
1. **순수 변환 lib** `src/lib/runs/activityTimeline.ts` — `buildActivityTimeline(events, { tasks, agents })` → `TimelineItem[]`(필터·라벨·레벨·시각). 단위 테스트.
2. **신규 컴포넌트** `RunActivityTimeline.tsx` — collapsible "Activity" 섹션, `state.events` 기반 시간순 렌더. 라이브 업데이트(이벤트가 append되면 자동 갱신).
3. **RunStream 배선** — `<RunActivityTimeline events={state.events} tasks={state.tasks} agents={state.team.agents} runStatus={state.status} />` 추가(`DagGraph` 아래).
4. historical/empty run **graceful degrade**("활동 기록 없음").

### 제외 (Phase 14+)
- Reports↔TaskAttempt 연결(result.md/report.md/agent-reports에 attempt 요약).
- 서버측 timeline API / 기존 이벤트 윈도(1000/2000) 넘는 pagination.
- `agent.output.delta` 스트리밍 뷰(이미 AgentReportPane이 담당).
- `revision.*` 이벤트, per-event artifact drill-down.
- 이벤트 검색/내보내기.

---

## 3. UX 설계

- **배치**: `DagGraph` 바로 아래 collapsible "Activity (N)" 섹션. (대안: FinalResult와 AgentReport 사이 — 결정 질문.)
- **기본 상태**: **collapsed**(상세 화면 간결 유지; 디버깅 시 펼침). 실패/취소 run은 자동 expand 옵션 검토(결정 질문).
- **아이템 구성**: `시각 · [레벨 점/아이콘] · 라벨 · (상세)`. 예시:
  - `run.started` → "Run started"
  - `plan.created` → "Plan created · {taskCount} tasks"
  - `task.started` → "Task `{name}` ({agent}) started"
  - `task.completed` → "Task `{name}` completed · {durationMs}"
  - `task.failed` → "Task `{name}` failed · {error} · {durationMs}"
  - `task.retry.attempt` → "Retry #{attempt} ({kind}, {delayMs})"
  - `task.reset` → "Task `{name}` reset (was {previousStatus}) · {reason}"
  - `run.resumed` → "Run resumed ({mode}{trigger?})· {resumedTasks} re-run, {doneReused} reused"
  - `run.autoresume.failed` → "Auto-resume failed · {reason}"
  - `run.cancelled` → "Run cancelled · {cancelledTasks} tasks cancelled"
  - `run.completed` → success: "Run completed" / 실패: "Run failed · {failedReason}"
  - `result.created` → "Result exported"
- **레벨/색**(STATUS_STYLE 재사용·근사): success(task.completed, run.completed success), error(task.failed, run.cancelled, run.autoresume.failed, run.completed 실패), warn(task.retry.attempt, task.reset, run.resumed), info(run.started, plan.created, task.started, result.created).
- **정렬**: 시간 오름차순(서사 흐름). `state.events`가 이미 asc.
- **많은 이벤트 처리**: `max-h` 스크롤 박스(RevisionDiff 패턴). 기존 캡(초기 1000 / 클라이언트 `.slice(-2000)`)에 의존 — 매우 긴 run은 가장 이른 이벤트가 윈도에서 빠질 수 있음(문서화; pagination은 Phase 14). 필요 시 "최근 N개 표시" 라벨.
- **필터**: 기본 미도입(이미 고볼륨 delta 제외). 향후 레벨 필터는 선택(결정 질문).

---

## 4. API / lib / UI 변경 계획

### lib (신규, 순수)
- **`src/lib/runs/activityTimeline.ts`** — 
  ```ts
  type TimelineLevel = 'info' | 'success' | 'warn' | 'error';
  interface TimelineItem { id: string; at: string; level: TimelineLevel; label: string; detail?: string; type: string; }
  interface TimelineCtx { tasks: { taskKey: string; name: string; agentId: string | null }[]; agents: { id: string; name: string }[]; }
  export function buildActivityTimeline(events: readonly EventLike[], ctx: TimelineCtx): TimelineItem[];
  ```
  - timeline 대상 type만 통과(delta/completed/ revision 제외), 시간 오름차순 유지.
  - payload는 방어적으로 읽음(필드 누락/구버전/unknown type → type 기반 일반 라벨, **크래시 없음**).
  - taskKey→task name, agentId/payload.agentName→agent name 해석(없으면 taskKey/원시값 fallback).

### UI
- **`src/components/run/RunActivityTimeline.tsx`** (신규) — props `{ events, tasks, agents, runStatus }`. `buildActivityTimeline` 호출 → collapsible 리스트 렌더(레벨 색, 시각 `toLocaleTimeString`, 라벨/상세). 0건 → degrade.
- **`src/components/run/RunStream.tsx`** — `DagGraph` 아래에 `<RunActivityTimeline …/>` 추가. **state.events는 이미 존재 → reducer 변경 불필요.**

### API
- **신규 없음.** 기존 `initial.events`(SSR 1000) + 라이브 SSE/폴링 append로 충분. (page.tsx events take 상향은 불필요 — 1000이면 일반 run 충분; 매우 긴 run은 Phase 14 pagination.)

### package.json
- `activityTimeline.test.ts` 등록.

> RunStream 스트리밍/Phase 8~12(resume/rerun/auto-resume/attempt) 경로 불변. executor/recovery/schema 무변경.

---

## 5. schema / dependency 변경 여부

**schema 0 · dependency 0.** 이벤트는 이미 저장/적재되며 timeline은 읽기 전용 변환·표시. 신규 컬럼/마이그레이션/패키지 없음. (불가피 변경 없음 — 모든 필요한 데이터가 기존 `state.events`/`tasks`/`agents`에 존재.)

---

## 6. 테스트 계획

- **신규 순수 테스트** `activityTimeline.test.ts`:
  - delta/completed/revision 이벤트 **제외** 확인.
  - 각 timeline type → 올바른 level/label/detail 매핑.
  - taskKey→name, agentId→name 해석(+미존재 fallback).
  - payload 누락/부분/unknown type → 크래시 없이 일반 라벨.
  - 빈 입력 → `[]`; 정렬(asc) 유지.
- **회귀**: 전체 `typecheck` + `test`(현재 188 + 신규) + `next build`(라우트 변동 0) + `prisma migrate status`(4 migrations, 0 added). Phase 8~12 흐름 무영향(컴포넌트 추가만, reducer/route 무변경).

---

## 7. 수동 smoke 시나리오 (provider 호출 불필요 — 기존 run 데이터 사용)

1. **succeeded run**(예: `cmpk0uedb…` 또는 5-task `cmpjndyul…`): run.started→plan.created→task.started/completed→result.created→run.completed 시간순 표시.
2. **failed run**(`cmphu0wvf…`, planning 실패, task 0): 최소 이벤트(run.completed failed 등) 표시, 크래시 없음.
3. **cancelled run**: run.cancelled + task cancelled 항목.
4. **resumed/autoresumed/rerun이 있는 run**(`cmpk0uedb…`엔 task.reset/run.resumed/run.autoresume 이력 존재): reset/resumed/retry 항목이 적절한 level로 표시.
5. **historical/이벤트 적은 run**: 누락/구버전 payload에도 degrade("활동 기록 없음" 또는 가능한 항목만), 크래시 없음.
6. (회귀) 펼침/접힘 토글, 라이브 run에서 이벤트 추가 시 timeline 자동 갱신.

---

## 8. 리스크와 결정 질문

### 리스크
- R1 매우 긴 run은 초기 1000 / 클라이언트 2000 윈도 밖 이벤트가 timeline에 없음 → 문서화, pagination은 Phase 14.
- R2 구버전/누락 payload(과거 run) → 방어적 변환 필수(일반 라벨).
- R3 이벤트 다수 시 DOM 렌더 비용 → `max-h` 스크롤 + (선택) "최근 N개".
- R4 라벨 i18n/길이 — 간결 라벨 + 상세는 보조 텍스트.

### 결정 (확정됨 — 위 "승인 후 확정 결정사항" 참조)
1. 이벤트 범위 = 11종 + `result.created` 포함, delta/completed·revision.*·feedback.* 제외. (`run.running`은 인식만, 현재 미emit.)
2. 누락/구버전 payload = 숨기지 않고 일반 라벨 표시, unknown은 neutral 스타일.
3. 다수 이벤트 = 기존 윈도 + 스크롤(pagination Phase 14 보류).
4. 기본 collapsed(단 failed/cancelled 자동 expanded), 배치 `DagGraph` 아래·Agent Output 위, 제목 `Run activity` + 이벤트 수.

---

## 검증(Verification) 요약
```
corepack pnpm --filter web typecheck                   # 0 errors
corepack pnpm --filter web test                        # 188 + activityTimeline 케이스
corepack pnpm --filter web exec next build             # PASS, 라우트 변동 0
corepack pnpm --filter web exec prisma migrate status  # 4 migrations, 0 added (schema 무변경)
```
+ 수동 smoke 1(succeeded)·3(cancelled)·4(resumed/rerun)·5(historical degrade) 통과. Phase 8~12 경로 무영향 확인.
