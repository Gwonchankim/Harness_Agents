# Phase 6 — 반복 사용성 / 팀 재사용 / 히스토리 / 이어가기 UX (상세 구현 계획)

> 상태: **구현 완료 + 검증 통과** — 2026-05-24. (typecheck / test 116·116 / next build 26 routes / migrate status clean)
> 기준 커밋: `main @ b4cdc9e (Update phase badge to phase 5)` — Phase 5 merge/push 완료 상태.
> 원칙(불변): **DB = source of truth**, md/json = export/cache. 파일 1개 = 책임 1개.
> **Phase 5 흐름(result/report/feedback/revision)을 깨지 않고 그 위에 탐색·재방문·재시도 UX만 얹는다.**
> **스키마 마이그레이션 0건 목표.** 새 dependency 0건 목표.

## 승인 후 확정 결정사항 (2026-05-24)

1. **Team Library 포함.** `/teams` + `/teams/[teamId]` 둘 다 Phase 6에 구현.
2. **Preview는 DB snapshot 기준.** `TeamRevision.agentsMd` / `teamJson`을 source of truth로 사용. 디스크 export md/json은 cache로만 취급.
3. **Retry는 하이브리드.** ExecutionPlan 없는 failed → in-place reset to `ready`. ExecutionPlan/Task 존재하는 failed → clone-new-run(기존 failed run 보존). **executor 무변경.**
4. **Revision rollback 제외.** Phase 6은 revision history 읽기/비교까지만. rollback은 Phase 7 이후 별도 계획.
5. **실패 run 모델 편집 기존 범위 유지.** provider/lead_plan 계열은 기존 team-models 편집 흐름 유지, 그 외 실패는 retry action이 담당. 모델 편집과 retry를 합치지 않음.

---

## 0. 현재 구현 상태 요약 (사실 기반)

### 0-A. Phase 0~5 완료 범위 (main 기준)

| Phase | 범위 | 핵심 산출물(실파일) |
|---|---|---|
| 0 | 모노레포 + Next 16 + Prisma SQLite + Default Project/ModelCatalog seed + read-only Settings | `prisma/schema.prisma`(18 모델), `seed.ts`, `lib/workspace/paths.ts` |
| 1 | Provider 어댑터(OpenAI/Anthropic/Ollama/Google) + 모델 availability + Secrets(keytar→AES-GCM) + redactor + tool registry/policy + fs tools | `lib/providers/*`, `lib/agents/runtime.ts`, `lib/secrets/*`, `lib/tools/*`, `lib/models/catalog.ts` |
| 2 | `/runs/new` 프롬프트 intake + PO 동적 Q&A(6지선다, 5=auto-judge, 6=custom) + edit/stale 전파 | `lib/agents/po*.ts`, `lib/qa/*`, `app/api/qa/[sessionId]/*`, `components/qa/*` |
| 3 | Team 추천(recall) + 신규 팀 제안 + 확정 → Team/Agent/TeamRevision v1 + AGENTS.md/team.json export | `lib/search/teamSearch.ts`, `lib/team/serialize.ts`, `lib/workspace/exportService.ts`, `app/api/teams/*`, `components/team/TeamComposer.tsx` |
| 4 | Lead DAG 계획 + 순차 executor + RunEvent(append-only) + SSE + 폴링 fallback + process_restart 복구 | `lib/agents/lead*.ts`, `lib/dag/*`, `lib/events/*`, `app/api/runs/[runId]/{start,events,state}`, `components/run/RunStream.tsx` |
| 5 | result.md/report.md/agent-reports + Feedback(Batch/Feedback/AgentRating) + Lead 개선 제안 + diff + 승인 시 TeamRevision v2 | `lib/results/*`, `lib/feedback/*`, `lib/agents/leadRevise*.ts`, `lib/revision/*`, `lib/team/revision.ts`, `app/api/runs/[runId]/{feedback,revision}`, `components/feedback/*` |

### 0-B. 전체 흐름 (현재 동작)

```
/runs/new (프롬프트 + PO 모델)
  → Run(status=po_qa) + QaSession 생성
  → /runs/new/{sessionId}  : PO Q&A (6지선다, edit/stale)
  → /runs/new/{sessionId}/compose : recall 추천 + 신규 팀 제안 → 확정
       → Team/Agent/TeamRevision v1 + AGENTS.md/team.json, Run.teamId 설정, Run.status=ready
  → /runs/{runId} : Start run → status=planning → Lead DAG → status=running → 순차 실행
       → 성공 시 result.md/report.md/agent-reports + Run.status=succeeded + Final result 패널
  → /runs/{runId}/feedback : 결과 1~5 + agent별 1~5/코멘트 제출(FeedbackBatch)
       → "팀 개선 제안" → Lead revision propose → diff → 승인 시 TeamRevision v2 (currentRevisionId 갱신)
```

### 0-C. 현재 남아있는 UX/제품적 빈틈 (Phase 6 대상)

조사로 확정한 사실:

1. **팀을 탐색/재사용할 1급 화면이 없다.** `/teams` 라우트 자체가 없음. Team은 recall(compose 단계)에서만 노출되고, 만든 팀을 따로 둘러볼 방법이 없다.
2. **TeamRevision 히스토리를 볼 화면이 없다.** v1/v2가 DB에 쌓이지만(`TeamRevision` rows) 표시 UI 없음.
3. **활성 AGENTS.md / team.json을 앱 안에서 볼 수 없다.** 디스크에만 export됨. 단, **동일 내용이 `TeamRevision.agentsMd` / `teamJson` 컬럼에 이미 저장**되어 있음(serialize.ts `buildSnapshot` 산출물).
4. **run 목록은 홈(`app/page.tsx`)에 최근 20개만**, 상태 필터/검색/팀별 보기 없음. `getResumeTarget()`이 상태별 이어가기 링크를 계산하지만 홈에 인라인되어 재사용/테스트 불가.
5. **feedback 페이지가 재방문을 인지하지 못한다.** `app/runs/[runId]/feedback/page.tsx`는 기제출 `FeedbackBatch`나 revision 상태를 조회하지 않고 **항상 빈 폼**을 렌더. 중복 제출/진행상황 안내 없음.
6. **실패/중단 run 재시도 경로가 부분적이다.**
   - `start` 라우트는 `status==='ready'`에서만 실행. 그 외 409.
   - `team-models` PATCH는 **lead_plan 계열 실패**(provider_unavailable/auth/unknown_provider/schema_error/timeout)만 `ready`로 reset.
   - **`task_failed:*`, `process_restart`, `lead_plan_aborted`, `lead_plan_invalid`, `lead_plan_failed`는 reset/retry 경로가 없어 `failed`에 영구 고착** → 사실상 재시도 불가.
7. **`Team.runCount`는 schema에만 존재하고 코드에서 한 번도 증가시키지 않음**(grep 확인) → 항상 0. 팀의 "연결된 run 수"는 `Run.teamId` 쿼리로 도출해야 함.
8. **recall은 compose 단계에 묶여 있음.** 독립적인 팀 검색/둘러보기 입구가 없음(`recall()`/`scoreTeams()` 로직 자체는 재사용 가능).

---

## 1. Phase 6 핵심 목표

“한 번 만든 팀과 run을 **다시 찾고, 상태를 이해하고, 안전하게 이어가거나 다시 돌리는**” 경험을 완성한다. 새 실행 엔진/스키마가 아니라 **읽기 화면 + 얇은 재시도 액션**이 중심.

1. 기존 run을 상태 필터/검색으로 탐색하고 정확한 단계로 이어가기.
2. Team Library(`/teams`)로 만든 팀을 재사용/탐색.
3. Team detail에서 활성 revision·agents·models·tools·연결 run·평점을 한 화면에서 확인.
4. TeamRevision 히스토리(읽기 전용) + 리비전 간 diff 확인.
5. 앱 내 AGENTS.md / team.json preview (**DB snapshot 기준**).
6. feedback/revision 재방문 UX(기제출/제안/승인 상태 인지).
7. 실패/중단 run 재시도 UX(실패 원인별 안내 + 안전한 retry/clone).

---

## 2. 구현 범위 — 포함 vs 연기

### 2-A. Phase 6 포함

- `/runs` 전용 run 목록(상태 필터 + 텍스트 검색) + 홈을 dashboard로 정리.
- `/teams` Team Library(활성 팀 카드 + 검색/정렬).
- `/teams/[teamId]` Team detail(활성 revision, agents/models/tools, AGENTS.md·team.json preview, 리비전 히스토리, 연결 run, 평균 점수/평점).
- 리비전 히스토리 **읽기 전용** + 리비전 간 diff(기존 `lib/feedback/diff.ts` 재사용).
- feedback 페이지 **재방문 인지**(기제출 batch 요약 + revision 단계로 재진입).
- 실패 run **재시도 액션**(`/api/runs/[runId]/retry`) + 원인별 CTA/안내.
- 실패 원인 분류를 **단일 순수 모듈**(`lib/runs/failureClass.ts`)로 추출(현재 RunStream/team-models에 흩어진 로직 정리).

### 2-B. Phase 7 이후로 연기 (명시)

- **리비전 rollback**(currentRevisionId를 과거 버전으로 되돌리기). Agent row 동기화(이름/프롬프트/tools 되돌림) 필요 → 위험. Phase 6은 히스토리 **열람만**.
- **task 실패 지점부터 부분 재개**(resume-from-failed-task). executor 변경 필요 → 연기. Phase 6 retry는 처음부터 다시.
- 임베딩/벡터 recall, 추천 고도화(현 keyword/tag/domain/history 유지).
- AgentRating **분석 대시보드/차트**. Phase 6은 단순 평균 수치만.
- Project 관리 UI(생성/이름변경/다중 프로젝트). Phase 6은 Default Project 유지.
- 리비전 흐름 밖에서의 직접 팀 편집(rename/agent 추가·삭제), 팀 삭제.
- 동시성 >1, Worker/BullMQ 추출, SaaS/auth/배포.

---

## 3. 화면 / 라우트 계획

| 라우트 | 신규/수정 | 종류 | 책임 |
|---|---|---|---|
| `/` | 수정 | server | dashboard: 빠른 액션 + 최근 run/팀 일부 + `/runs`·`/teams` 진입 |
| `/runs` | **신규** | server | 전체 run 목록 + 상태 필터(query `?status=`) + 검색(`?q=`) + 이어가기 CTA |
| `/runs/[runId]` | 수정 | server+client | 실패 시 retry CTA 추가(RunStream) |
| `/runs/[runId]/feedback` | 수정 | server | 기제출/revision 상태 인지 분기 |
| `/teams` | **신규** | server | Team Library: 활성 팀 카드 + 검색/정렬(score/recent/name) |
| `/teams/[teamId]` | **신규** | server | Team detail(아래 §7 상세) |
| `/teams/[teamId]/revisions` | **신규(선택)** | server | 리비전 목록이 길 때 전용 페이지. 기본은 detail 내 섹션으로 충분 → **선택 사항** |

> typedRoutes가 켜져 있으므로 `AppNav.tsx`의 `href` 유니온에 `/runs`, `/teams` 추가 필요(컴파일 강제).
> `app/runs/page.tsx` 추가는 기존 `/runs/new`·`/runs/[runId]`와 충돌 없음(세그먼트 index).

---

## 4. 데이터 / API 계획

### 4-A. 스키마 — **변경 없음**

- Team library/detail/history는 전부 기존 컬럼으로 도출 가능:
  - 활성 revision/preview → `Team.currentRevision.{version,agentsMd,teamJson,reason,createdAt}`
  - 히스토리 → `Team.revisions (orderBy version desc)`
  - agents/models/tools → `Team.agents.{name,role,isLead,modelId,provider,toolsAllowed,tags}`
  - 연결 run → `Run where teamId` (※ `runCount`는 미유지이므로 **사용하지 않음**)
  - 평균 점수 → `Team.score`(피드백 시 `lib/feedback/aggregate.ts`가 갱신; null이면 “—”)
  - 평점 → `AgentRating`/`Feedback`(batch별) 집계
- 착수 전 `prisma migrate status`로 drift 0 확인. **불가피한 추가 필드가 생기면** nullable/기본값 가진 **additive 단일 마이그레이션**만, 본 문서에 사유 기록. (현 설계상 불필요.)
- (선택) `runCount` 정합화는 **하지 않음**. 표시는 쿼리 집계로 대체(마이그레이션 회피).

### 4-B. 신규 API route (thin + lib 분리)

| 메서드/경로 | 책임 | 호출 lib |
|---|---|---|
| `POST /api/runs/[runId]/retry` | 실패 run 재시도(분류 후 reset-in-place 또는 clone-new-run) | `lib/runs/retry.ts`, `lib/runs/failureClass.ts` |

- 라우트는 **thin**: 파싱/가드만. 도메인 로직은 lib. `runtime='nodejs'`, `dynamic='force-dynamic'`, 상단 `ensureRecovered()`.
- **읽기 화면은 신규 route 불필요** — 서버 컴포넌트가 Prisma 직접 조회(기존 컨벤션과 동일).
- 팀 라이브러리 검색은 신규 route 없이 **서버 컴포넌트 + query param**으로 처리(`recall`/`scoreTeams`/`tokenize` 재사용). 별도 endpoint를 만들지 않음.

---

## 5. 기존 구현과의 연결

- **TeamSearch / recall**: `lib/search/teamSearch.ts`의 `scoreTeams`/`tokenize`/`jaccard`는 순수 함수 → `/teams` 라이브러리 검색에 그대로 재사용(Prisma 의존 `recall()`은 compose 전용으로 유지).
- **TeamRevision currentRevisionId**: detail의 “active revision”과 preview 소스. 히스토리는 `revisions` 전체. `lib/team/revision.ts`(nextVersion/createApprovedRevision)는 Phase 6에서 **호출만**, 변경 없음.
- **export된 AGENTS.md / team.json**: preview는 **디스크가 아니라 `TeamRevision.agentsMd/teamJson`**(DB snapshot)에서 읽음 → 제품 원칙 #2(DB=truth) 부합, 파일 부재/경로 이슈 회피. (디스크 export 흐름은 불변.)
- **Artifact rows**: detail의 “산출물” 링크/존재 표시는 `Artifact (kind in result_md/report_md/agent_report_md/team_md/team_json)`로 조회. 내용 렌더는 기존 `loadRunResultMarkdown` 등 재사용.
- **Run status state machine**: `getResumeTarget`을 `lib/runs/resumeTarget.ts`로 **추출**(순수)해 home·`/runs`가 공유 + 단위테스트. 상태값/전이는 변경 없음.
- **feedback/revision approve flow**: feedback 페이지가 최신 `FeedbackBatch` + `TeamRevision(sourceRunId=run)` 존재 여부를 읽어 분기. 제출/제안/승인 **API와 컴포넌트(FeedbackForm/RevisionReview)는 재사용**, 진입 상태만 추가.

---

## 6. UX 상세 — 이어가기 / 상태별 CTA

### 6-A. 기존 run 이어가기

- `/runs`와 home은 `resumeTarget(run)`이 만든 **단일 “Continue” CTA**로 정확한 단계 링크 제공(현재 home 로직과 동일, 추출만).
- run 카드에 상태 배지 + 팀명 + 프롬프트 2줄 + 실패 사유(있으면) 표시.

### 6-B. 상태별 CTA

| status | 1차 CTA | 링크/액션 |
|---|---|---|
| `po_qa`/`pending` | Continue Q&A (또는 Prompt intake) | `/runs/new/{sessionId}` 또는 `/runs/new` |
| (qa completed, team 없음) | Compose team | `/runs/new/{sessionId}/compose` |
| `ready` | Start run | `/runs/{runId}` (StartRunButton 기존 재사용) |
| `planning`/`running` | View progress | `/runs/{runId}` |
| `succeeded` | Give feedback / View result | `/runs/{runId}` · `/runs/{runId}/feedback` |
| `failed` | **원인별 분기**(§6-C) | retry / edit models / new run |

### 6-C. 실패 원인별 안내 (failureClass 기준)

`lib/runs/failureClass.ts`가 `failedReason → { category, recoverable, strategy, title, help }` 매핑:

| failedReason 패턴 | category | 안내 / CTA |
|---|---|---|
| `lead_plan_provider_unavailable:*` | provider_unavailable | “Lead provider 사용 불가” → **모델 편집 후 재시도**(기존 team-models reset 흐름) |
| `lead_plan_provider_auth:*` | provider_auth | “provider 키 확인 필요” → Settings 링크 + 모델 편집 |
| `lead_plan_unknown_provider:*` | provider_unknown | “알 수 없는 provider” → 모델 편집 |
| `lead_plan_schema_error` | schema_error | “Lead가 잘못된 DAG 출력” → 더 강한 모델로 편집 후 재시도 |
| `lead_plan_timeout:*` | timeout | “Lead 계획 시간 초과” → 더 빠른/강한 모델 편집 후 재시도 |
| `lead_plan_aborted` | aborted | “계획 중단됨” → **retry**(plan 없음 → in-place reset) |
| `lead_plan_invalid:*` / `lead_plan_failed:*` | plan_failed | “계획 생성 실패” → retry(+모델 편집 가능) |
| `task_failed:*` | task_failed | “실행 중 task 실패” → **새 run으로 다시 실행**(plan 존재 → clone, §6-D) |
| `process_restart` | process_restart | “서버 재시작으로 중단됨” → retry(plan 유무로 in-place/clone) |

> provider 계열은 **기존 team-models 흐름을 유지**(모델 편집이 핵심 복구). retry는 그 외(aborted/plan_failed/task_failed/process_restart)를 덮는다. 두 경로가 겹치지 않게 failureClass가 단일 기준을 제공.

### 6-D. retry 전략 (결정 필요 — §9)

- **plan(ExecutionPlan) 미존재**(대부분 lead_plan_* / 계획 단계 process_restart): **in-place reset** → `status=ready`, `failedReason/startedAt/endedAt` 초기화 → Start run 재사용. (안전: 충돌 row 없음.)
- **plan 존재**(task_failed / 실행 단계 process_restart): **clone-new-run** → `prompt`+`teamId`+`poModelId` 복제한 새 Run(status=`ready`) 생성, 기존 실패 run은 **히스토리로 보존**. (이유: `ExecutionPlan.runId @unique` + 기존 Task rows와 충돌 회피, executor 무변경.)
- 권장: 위 하이브리드. 대안은 §9 결정 질문에.

### 6-E. feedback / revision 재방문

`/runs/[runId]/feedback`는 진입 시 추가 조회:
- 최신 `FeedbackBatch`(+ `AgentRating`/`Feedback` 카운트), 해당 run을 `sourceRunId`로 하는 `TeamRevision` 존재 여부.
- 분기:
  - **미제출**: 현행 빈 폼(변경 없음).
  - **제출됨, 제안/승인 없음**: “이미 피드백 제출됨(결과 N점, agent M명 평가)” 요약 + “팀 개선 제안 받기”로 재진입(RevisionReview) + “다시 제출”(append-only 새 batch) 옵션.
  - **revision 승인됨**: “v{n} 적용됨” 배지 + Team detail 링크 + (원하면) 새 피드백 제출.
- `FeedbackBatch`는 append-only 유지(Phase 5 보정 #3) — 재제출은 새 batch.

### 6-F. Team detail에 표시할 정보

- **Header**: 팀명, domain, tags, status, 활성 revision 버전(v{n}), 평균 점수(`Team.score` 또는 “—”).
- **Agents**: lead 우선 정렬, 각 agent: name/role/isLead, model(`modelId (provider)`), toolsAllowed, tags, (있으면) 평균 평점.
- **Preview(탭)**: `AGENTS.md`(currentRevision.agentsMd) / `team.json`(currentRevision.teamJson) — 접힘/펼침. 기존 Final result 렌더 방식 재사용(새 dependency 없이).
- **Revision history**: 버전 내림차순 리스트(version, proposedBy, approvedBy, reason, sourceRunId 링크, createdAt). 각 항목 펼치면 이전 버전 대비 diff(`diffLines` + `RevisionDiff`).
- **Linked runs**: `Run where teamId` 목록(상태, 프롬프트, 결과 링크).
- **Ratings**: agent별 평균 + 결과 평균(집계 표).

---

## 7. 파일 단위 책임 (단일 책임 기준)

### 7-A. 신규 lib (순수 우선)

| 파일 | 책임 | 테스트 |
|---|---|---|
| `lib/runs/resumeTarget.ts` | run status → `{label, href, stage}` (순수, home/`/runs` 공유) | `resumeTarget.test.ts` |
| `lib/runs/failureClass.ts` | failedReason → `{category, recoverable, strategy, title, help}` (순수) | `failureClass.test.ts` |
| `lib/runs/retry.ts` | 실패 run 재시도: 분류→in-place reset 또는 clone-new-run (Prisma) | (통합은 수동 smoke) |
| `lib/runs/list.ts` | `/runs` 목록 쿼리 + 상태/검색 필터 (Prisma, 페이지 thin 유지) | — |
| `lib/teams/teamDetail.ts` | team detail view 조립(활성 revision, agents, revisions, linked runs) | — |
| `lib/teams/ratings.ts` | AgentRating/Feedback rows → per-agent/team 평균 (순수) | `ratings.test.ts` |
| `lib/teams/library.ts` | `/teams` 목록 + query 검색(scoreTeams 재사용) | — |

### 7-B. 신규 API

- `app/api/runs/[runId]/retry/route.ts` — thin, `lib/runs/retry.ts` 위임.

### 7-C. 신규 UI

페이지:
- `app/runs/page.tsx` — run 목록(필터/검색).
- `app/teams/page.tsx` — Team Library.
- `app/teams/[teamId]/page.tsx` — Team detail.
- (선택) `app/teams/[teamId]/revisions/page.tsx`.

컴포넌트:
- `components/runs/RunFilterBar.tsx` — 상태 필터 + 검색(client, URL query 갱신).
- `components/runs/RetryRunButton.tsx` — retry 액션(client).
- `components/teams/TeamCard.tsx` — 라이브러리 카드.
- `components/teams/SnapshotPreview.tsx` — AGENTS.md/team.json 탭 preview(client, 접힘/펼침).
- `components/teams/RevisionHistory.tsx` — 히스토리 + diff 펼침(client, `RevisionDiff` 재사용).
- `components/teams/LinkedRuns.tsx` — 연결 run 목록(server로 가능하면 server).

### 7-D. 수정 (최소)

- `app/page.tsx` — dashboard화(최근 일부 + `/runs`·`/teams` 링크), `resumeTarget` 사용.
- `app/runs/[runId]/feedback/page.tsx` — 기제출/revision 상태 조회·분기.
- `components/feedback/FeedbackForm.tsx` — “기제출 요약/재진입” 초기 모드 prop 추가(렌더 분기, 기존 제출 로직 불변).
- `components/run/RunStream.tsx` — `failed` 시 failureClass 기반 retry CTA 추가(기존 모델편집 패널과 공존).
- `components/navigation/AppNav.tsx` — `/runs`·`/teams` 링크 추가(href 유니온 확장), 배지 `Phase 6`.
- `apps/web/package.json` — test 스크립트에 신규 `*.test.ts` append.

> **변경하지 않음**: `lib/dag/executor.ts`(executor 무변경), `lib/team/serialize.ts`, `lib/team/revision.ts`, `lib/revision/*`, `app/api/teams/route.ts`, `app/api/runs/[runId]/{feedback,revision,team-models,start}/route.ts`, Phase 5 feedback/revision 컴포넌트(진입만 추가).

---

## 8. 검증 계획

```powershell
corepack pnpm --filter web typecheck
corepack pnpm --filter web test
apps/web/node_modules/.bin/next.cmd build
apps/web/node_modules/.bin/prisma.cmd migrate status
```

- `typecheck` — 신규 라우트/페이지/유니온(href) 타입 정합.
- `test` — 신규 순수 모듈 단위테스트(resumeTarget, failureClass, ratings) 통과. 기존 테스트 회귀 없음.
- `next build` — 신규 라우트(`/runs`, `/teams`, `/teams/[teamId]`, `/api/runs/[runId]/retry`) 빌드.
- `migrate status` — drift 0(스키마 무변경) 확인.

**수동 smoke 시나리오**

1. `/runs` — 상태 필터(`failed`/`succeeded`/`ready`)·검색 동작, Continue 링크가 올바른 단계로 이동.
2. `/teams` — 활성 팀 카드 표시, 검색/정렬 동작, 첫 실행(팀 0개) 빈 상태 안내.
3. `/teams/[teamId]` — 활성 revision(v{n}), agents/models/tools, AGENTS.md·team.json preview(=DB snapshot), 연결 run, 평점, 히스토리 표시.
4. 히스토리 항목 펼침 → v(n-1)↔v(n) diff(적/녹) 렌더.
5. `succeeded` run → feedback 제출 → `/runs/[runId]/feedback` 재진입 시 “기제출 요약” + 제안 재진입 노출.
6. 실패 run 종류별:
   - `lead_plan_provider_unavailable:*` → 모델 편집 패널(기존) 정상.
   - `lead_plan_aborted` 또는 plan 미존재 → **Retry** → in-place `ready` → Start 가능.
   - `task_failed:*` → **New run with this team** → 새 Run(ready), 기존 실패 run 보존 확인.
7. 회귀: 기존 `/runs/[runId]` 진행/Final result/Feedback/Revision 흐름 정상(Phase 4·5 무회귀).

---

## 9. 리스크와 결정 필요 사항

### 리스크 / 주의

- **clone-new-run의 run 증식**: task_failed 재시도마다 새 Run 생성 → 목록 증가. `/runs` 필터로 완화. (대안: in-place + plan/task 정리 = executor 위험.)
- **failureClass 단일화 회귀**: 현재 RunStream/team-models의 분기와 **정확히 동일**하게 매핑해야 provider 편집 흐름이 안 깨짐. 추출 시 기존 동작 보존 우선.
- **preview 소스**: DB snapshot은 “디스크 파일 실제 상태”와 다를 수 있음(파일 수동 변경 시). 제품 원칙상 DB가 truth이므로 의도된 동작이나, UI에 “DB snapshot 기준” 명시 권장.
- **score/ratings 빈 값**: 피드백 없는 팀은 `Team.score=null`, 평점 0건 → “—”로 안전 표시.
- **typedRoutes**: 신규 라우트 추가 시 `href` 타입 갱신 누락하면 빌드 실패 → AppNav/링크 일괄 점검.

### 결정 완료 (2026-05-24 승인) — 상단 “승인 후 확정 결정사항” 참조

1. Team Library 범위 → **`/teams` + `/teams/[teamId]` 모두 포함**.
2. preview 소스 → **DB snapshot(`TeamRevision.agentsMd/teamJson`)**.
3. retry 의미 → **하이브리드(plan 없으면 in-place reset, 있으면 clone-new-run)**.
4. 리비전 rollback → **Phase 6 제외(히스토리 열람/비교까지)**.
5. 실패 run 모델 편집 → **현행 유지(모델 편집과 retry 분리)**.

---

## 10. 산출물

- 본 문서: `PHASE6_PLAN.md` (계획). **코드 변경 없음.**
- **`PHASE_LOG.md` 기록 제안(승인 전 미반영)**: 본 계획 승인 시, `PHASE_LOG.md` "Current Status"에 한 줄
  `- Phase 6 planning drafted on 2026-05-24 (PHASE6_PLAN.md); scope = reuse/history/resume/retry UX, no schema migration planned.`
  추가를 제안. **구현 완료 항목이 아니므로 승인 전에는 기록하지 않음.**

### 신규/수정 요약

- 신규 lib: `lib/runs/{resumeTarget,failureClass,retry,list}.ts`, `lib/teams/{teamDetail,ratings,library}.ts`
- 신규 API: `app/api/runs/[runId]/retry/route.ts`
- 신규 UI: `app/runs/page.tsx`, `app/teams/page.tsx`, `app/teams/[teamId]/page.tsx`(+선택 revisions), `components/runs/{RunFilterBar,RetryRunButton}.tsx`, `components/teams/{TeamCard,SnapshotPreview,RevisionHistory,LinkedRuns}.tsx`
- 수정(최소): `app/page.tsx`, `app/runs/[runId]/feedback/page.tsx`, `components/feedback/FeedbackForm.tsx`, `components/run/RunStream.tsx`, `components/navigation/AppNav.tsx`, `apps/web/package.json`
- 신규 테스트: `resumeTarget.test.ts`, `failureClass.test.ts`, `ratings.test.ts`
- 스키마 변경: **없음**. 새 dependency: **없음**.
