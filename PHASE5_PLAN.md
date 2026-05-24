# Phase 5 — Result, Feedback, Revision (상세 구현 계획)

> 상태: **승인됨 + 보정 반영 (구현 진행)**.
> 원칙: **DB = source of truth**, md/json = export/cache. 파일 1개 = 책임 1개.
> 기존 Phase 4 `result.md` 흐름은 **깨지 않고 확장**한다.

## 승인 후 보정사항 (2026-05-24)

1. **승인 시 기존 Agent row 삭제 금지.** Task/Feedback/AgentRating/RunEvent가 agentId를 참조하므로
   agentId 보존이 필수. Phase 5는 agent **추가/삭제를 범위 밖**으로 두고, 기존 N명 Agent를
   **agentId 기준 update**만 한다. Lead revision proposal 스키마에 각 agent의 기존 **agentId 포함**.
2. **Approve 요청에 `baseRevisionId` 포함**, 서버에서 `Team.currentRevisionId`와 일치 검증.
   불일치 시 **409 `revision_stale`** (오래된 diff 승인 방지).
3. **FeedbackBatch는 append-only.** 제출마다 새 batch 생성, revision propose는 **최신 FeedbackBatch** 기준.
4. **`writeWorkspaceFile` 공용 추출은 최소 변경.** Phase 4 `result.md`(`finalResult.ts`) 흐름은
   **건드리지 않고**, 신규 writer는 새 공용 모듈만 사용.
5. **PHASE5_PLAN.md UTF-8 무결성 확인** (BOM 없음, strict UTF-8 디코드 OK — 검증 완료).

---

## 0. 현재 코드 기준 사실 정리 (계획의 근거)

조사로 확인한 실제 상태:

- DB 스키마(`apps/web/prisma/schema.prisma`)에 `FeedbackBatch`, `Feedback`,
  `AgentRating`, `TeamRevision`(+`feedbackBatchId`, `sourceRunId`)가 **이미 존재**하며
  `20260505143208_init` 마이그레이션에 포함되어 있다. → **Phase 5 신규 스키마 불필요.**
- `result.md`는 `lib/dag/executor.ts`의 `exportFinalResult()`가 run 성공 직후 생성.
  순수 빌더는 `lib/results/finalResult.ts`의 `buildFinalResultMarkdown()`.
- `result.created` 이벤트 + `ResultCreatedPayload` 타입(`lib/events/types.ts`) 존재.
  Artifact `kind='result_md'` 생성, `loadRunResultMarkdown()`로 재로딩.
- Final Result 패널은 `components/run/RunStream.tsx`의 `FinalResultPane`.
  오래된 succeeded run용 fallback은 `app/runs/[runId]/page.tsx`의 `fallbackFinalResult`.
- 상태 API `app/api/runs/[runId]/state/route.ts`가 `finalResult`를 함께 반환.
- TeamRevision **v1**은 `app/api/teams/route.ts` 팀 생성 트랜잭션에서 작성됨
  (`proposedBy:'po'`, `approvedBy:'user'`, `version:1`, `currentRevisionId` 설정).
- `components/team/RevisionDiffViewer.tsx`는 Phase 3 stub(단일 `<pre>` 프리뷰)이며
  `components/team/TeamComposer.tsx:502`에서 `agentsMd` prop으로 사용 중.
- 팀 직렬화기 `lib/team/serialize.ts` (`buildSnapshot`→`agentsMd`/`teamJson`),
  팀 파일 export `lib/workspace/exportService.ts` (원자적 write).
- 구조화 출력 패턴: `lib/agents/runtime.ts:generateObject` + `lib/agents/lead.ts`/`po.ts`
  (타임아웃·auth·schema 에러 분류 + strict-repair 재시도). Phase 5에서 그대로 재사용.
- 팀 제안 스키마/상수: `lib/agents/team.prompt.ts`의 `teamProposalSchema`,
  `TEAM_AGENT_COUNT=5`. Lead 개선 제안 출력에 재사용.

> 경로 주의: `PLAN.md`의 옛 스케치는 `teams/{teamId}/runs/...`였으나 **실제 구현·요구사항(#14)은
> `projects/{projectSlug}/runs/{runId}/...`**. 본 계획은 실제 구현 컨벤션을 따른다.

---

## 1. 이미 구현된 것 vs Phase 5 신규 범위

### 1-A. 이미 구현됨 (재사용/확장만, 새로 만들지 않음)

| 항목 | 위치 | Phase 5에서의 취급 |
|---|---|---|
| `result.md` 생성 | `executor.ts:exportFinalResult` + `lib/results/finalResult.ts` | 출력 오케스트레이터로 **추출·확장** |
| `result.created` 이벤트 | `lib/events/types.ts`, `appendEvent` | payload **하위호환 확장** |
| `result_md` Artifact + 재로딩 | `finalResult.ts:loadRunResultMarkdown` | 동일 패턴을 report/agent-report에 복제 |
| Final Result 패널 | `RunStream.tsx:FinalResultPane` | 그대로 유지 |
| 오래된 succeeded run fallback | `page.tsx:fallbackFinalResult` | report/agent-report에도 동일 fallback 적용 |
| Feedback/Revision **DB 테이블** | `schema.prisma` (init 마이그레이션) | **그대로 사용, 변경 없음** |
| TeamRevision **v1** 작성 | `app/api/teams/route.ts` | v2+ 로직을 공용 헬퍼로 **분리·재사용** |
| 팀 직렬화/export | `lib/team/serialize.ts`, `lib/workspace/exportService.ts` | 재export에 재사용 |
| 구조화 LLM 호출 + 에러분류 | `lib/agents/lead.ts`, `po.ts`, `runtime.ts` | Lead 개선 제안에 동일 패턴 적용 |

### 1-B. Phase 5 신규 구현 범위

1. `report.md` (run 실행 리포트) 생성.
2. `agent-reports/{agentId}.md` (에이전트별 리포트) 생성.
3. Run 완료 후 **Feedback 페이지** (`/runs/[runId]/feedback`) + UX.
4. 결과물 피드백(1~5 + custom text) & **에이전트별 피드백**(좌:수행내용 / 우:입력, 반응형 grid).
5. `FeedbackBatch` / `Feedback` / `AgentRating` 저장(단일 트랜잭션).
6. **Lead 개선 제안**: feedback + result/report/agent-reports를 읽고 새 `AGENTS.md`/`team.json` 제안.
7. **diff 계산** + **diff viewer** (의존성 없는 LCS).
8. **revision propose → 사용자 승인/거절 → 승인 시에만 TeamRevision v2 생성**(기존 보존, `currentRevisionId` 갱신).

---

## 2. `report.md` 생성 방식

`report.md`는 **deliverable(result.md)와 별개**인 "무엇이 어떻게 실행됐는가" 리포트.

- 순수 빌더 신규: `lib/results/report.ts` → `buildRunReportMarkdown(input): string`.
  - 입력: run prompt, team(name/roster), plan rationale, tasks(taskKey/agent/status/duration/bytes/error), 합계, 시작·종료시각.
  - 내용 섹션:
    - `# Run report — {teamName}`
    - `## Overview` (prompt, team, lead, 모델 구성, 총 task 수/성공/실패, 총 소요)
    - `## Plan rationale` (ExecutionPlan.rationale)
    - `## Task timeline` (표: `# | taskKey | agent | status | duration | output bytes`)
    - `## Failures` (있을 때만, error 요약)
    - `## Outputs` (result.md / agent-reports 링크 경로)
- 생성 시점: **run 성공 직후**, 출력 오케스트레이터(§아래 7-A)에서 result.md와 함께 작성.
- Artifact `kind='report_md'`, 경로 `projects/{slug}/runs/{runId}/report.md`.
- **하위호환 fallback**: 과거 succeeded run이 report.md를 안 가진 경우, feedback 페이지 서버
  컴포넌트가 `buildRunReportMarkdown`로 즉석 생성해 표시(디스크 미기록). 기존
  `page.tsx:fallbackFinalResult`와 동일 철학.

---

## 3. `agent-reports/{agentId}.md` 생성 방식

- 순수 빌더 신규: `lib/results/agentReport.ts` → `buildAgentReportMarkdown(input): string`.
  - 입력: agent(name/role/model/isLead) + 해당 agent에게 배정된 task들(name/description/expectedOutput/status/timing/output text/error).
  - 내용:
    - `# {agentName}{(Lead)} — agent report`
    - `## Profile` (role, model/provider)
    - task별: `### {title}` + 메타(`taskKey`, status, duration) + `expectedOutput` + 실제 출력(코드블록) + 실패 시 error.
- 대상: 이번 run에서 **task가 1개 이상 배정된 agent만**. (Lead는 Phase 4 기준 task 미수행 →
  보통 제외되지만, 향후 Lead가 task를 가지면 자동 포함.)
- 경로: `projects/{slug}/runs/{runId}/agent-reports/{agentId}.md` (agentId = cuid).
- Artifact `kind='agent_report_md'` (agent별 1 row). 생성 시점 = run 성공 직후(오케스트레이터).
- fallback: feedback 페이지에서 누락 시 즉석 생성(디스크 미기록).

---

## 4. Run 완료 이후 Feedback 페이지 UX

- 라우트(신규): `app/runs/[runId]/feedback/page.tsx` (server component, `runtime='nodejs'`,
  `dynamic='force-dynamic'`, 상단 `ensureRecovered()`).
- 진입점: `RunStream.tsx`의 succeeded 상태에서 **"Give feedback"** CTA(링크) 추가.
  (또는 `FinalResultPane` 하단에 버튼.) 홈(`app/page.tsx`)의 succeeded run도 동일 링크 노출 옵션.
- 가드: run이 존재하지 않거나 `status!=='succeeded'`면 안내 + 런 상세로 회귀. team 없으면 안내.
- 페이지 데이터 로드: run+team+agents, tasks(+result), result.md(`loadRunResultMarkdown`),
  report.md/agent-reports(없으면 fallback 빌드), 현재 `currentRevision`, 기존 FeedbackBatch 유무.
- 흐름(클라이언트):
  1. **결과물 피드백** + **에이전트별 피드백** 입력 → 제출(POST feedback).
  2. 제출 성공 후 **"팀 개선 제안 받기"** 버튼 → revision propose 호출(LLM, 진행 오버레이).
  3. diff 검토 → **승인/거절**.
- 재방문: 이미 피드백 제출된 run은 제출 내역 요약 표시 + (제안 미승인 시) 제안 단계로 재진입 가능.

---

## 5. 결과물 피드백 (1~5 + custom text)

- 컴포넌트(신규): `components/feedback/ResultFeedback.tsx`.
  - result.md 프리뷰(접힘/펼침, 기존 `FinalResultPane` 스타일 재사용).
  - **1~5 점수**: 공용 `components/feedback/RatingInput.tsx`(별/숫자 5버튼, 단일 책임, 재사용).
  - **custom text**: `<textarea>` (선택 입력, 길이 상한 e.g. 4000자, 클라이언트+서버 양쪽 검증).
- 상태는 상위 `FeedbackForm`이 보유(controlled).

---

## 6. 에이전트별 피드백 (좌:수행내용 / 우:입력, 반응형 grid)

- `components/feedback/AgentFeedbackGrid.tsx`: 반응형 grid
  `grid-cols-1 md:grid-cols-2 lg:grid-cols-3` (5~6 agent → 자연스러운 **2x3** 배치).
- 셀: `components/feedback/AgentFeedbackCard.tsx` (단일 책임으로 grid에서 분리).
  - **좌측(수행 내용)**: agent name/role/model + 해당 agent의 task 출력 요약(스크롤 박스).
    데이터 출처 = tasks의 result 텍스트(또는 agent-report 일부). `AgentReportPane`의 표현 재사용 가능.
  - **우측(입력)**: `RatingInput`(1~5) + comment `<textarea>`.
- 미평가 agent 허용(부분 제출 가능). 최소 1개 입력 또는 결과 점수만으로도 제출 허용(정책: §17 참조).

---

## 7. FeedbackBatch / Feedback DB 저장 방식

세 테이블의 역할을 **명확히 구분**(의도된 약간의 비정규화):

| 테이블 | 역할 | Phase 5 기록 규칙 |
|---|---|---|
| `FeedbackBatch` | 한 번의 제출 = 1 batch. 결과 점수 스칼라 보관 | `resultRating`, `resultComment` ← 결과물 피드백 |
| `Feedback` | 균일 피드백 로그(결과+에이전트) | `kind='result'`(agentId=null) 1행 + 평가된 agent마다 `kind='agent'` 1행 |
| `AgentRating` | agent별 정규 점수(집계·`@@unique[batchId,agentId]`) | 평가된 agent마다 1행 |

- 저장 모듈(신규): `lib/feedback/persist.ts` → `createFeedbackBatch(input): Promise<{batchId}>`.
  - **append-only(보정 #3)**: 제출마다 **항상 새 batch** 생성(기존 batch 수정/덮어쓰기 금지).
  - 단일 `prisma.$transaction`으로 batch + Feedback rows + AgentRating rows 생성.
  - 입력 검증: rating ∈ 1..5(정수), comment 길이 상한, agentId가 해당 team 소속인지 확인.
  - revision propose는 항상 **그 run의 최신 FeedbackBatch**(`orderBy createdAt desc`)를 사용.
- 점수 집계(신규, 선택): `lib/feedback/aggregate.ts` → `recomputeTeamScore(teamId)`.
  - `Team.score`를 결과/에이전트 평점의 러닝 평균으로 갱신(트랜잭션 내 또는 직후).
  - PLAN 원칙("한 번의 나쁜 run으로 자동 재작성 금지")에 따라 **점수만 갱신, 자동 변경 없음**.
- 이벤트: `feedback.submitted`(payload: batchId, resultRating, ratedAgents 수) emit(선택, 진행/감사용).

---

## 8. Lead 개선 제안 방식

- 프롬프트/스키마(신규): `lib/agents/leadRevise.prompt.ts`.
  - **전용 스키마** `teamRevisionSchema`(보정 #1): 각 agent는 기존 **`agentId` 필수 echo** +
    `name/role/isLead/systemPrompt/toolsAllowed/tags/changeReason`. **model 필드 없음**(모델 변경은
    범위 밖 — 기존 modelId/provider 유지, 모델 교체는 기존 team-models 흐름이 담당).
  - 최상위: `rationale`, (선택)`teamDescription`. agents 배열 길이/agentId 집합은 **서버에서
    현재 팀과 정확히 일치하는지 검증**(추가/삭제 불가).
  - 시스템 프롬프트: "현재 팀을 개선하라. agentId/agent 수는 그대로 유지하고 각 agent를 개선만 하라.
    큰 변경은 반복적/명시적 피드백이 있을 때만."
- 호출 모듈(신규): `lib/agents/leadRevise.ts` → `proposeTeamRevision(ctx)`.
  - `lead.ts` 패턴 그대로: `generateObject` + `runWithGenerateTimeout` + auth/schema 에러 분류 +
    strict-repair 1회 재시도. Lead agent의 `modelId` 사용.
  - 입력 컨텍스트(토큰 보호 위해 **요약/절단**):
    - 현재 `AGENTS.md`/`team.json` (currentRevision snapshot),
    - feedback(결과 점수/코멘트 + agent별 점수/코멘트),
    - `result.md`, `report.md`, `agent-reports/*`의 핵심 발췌(길이 상한).
  - 검증: teams 라우트의 `validateNewProposal`과 동일 규칙(정확히 1 lead, tool allowlist,
    모델 enabled, agent 수) — 검증 로직을 `lib/team/validateProposal.ts`로 **추출하여 공유**.
- 결과는 **DB에 TeamRevision으로 저장하지 않음**(승인 전). propose 단계는 §9-A 참조.

---

## 9. TeamRevision v2 생성 (승인 시에만)

### 9-A. 제안(propose) 단계 — TeamRevision 미생성

- 모듈(신규): `lib/revision/propose.ts` → `proposeRevision(runId)`.
  - currentRevision + **최신 FeedbackBatch**(보정 #3) 로드 → `proposeTeamRevision` 호출 → 검증 →
    `buildSnapshot`로 제안 snapshot(`agentsMd`/`teamJson`) 생성 → `diffLines`로 diff 계산 → 결과 반환.
  - 응답에 `baseRevisionId = Team.currentRevisionId`, `feedbackBatchId` 포함(approve가 재전송).
  - `revision.proposed` 이벤트 emit(payload: 요약 카운트 + reason; 대용량 금지).
- **제안 저장 전략(결정)**: **stateless 라운드트립** 채택(권장).
  - propose API가 `{ currentSnapshot, proposedSpec, proposedSnapshot, diff }`를 반환,
    클라이언트가 보유. 승인 시 클라이언트가 `proposedSpec`을 그대로 재전송.
  - 승인 라우트가 **teams 라우트와 동일한 풀 검증**을 재수행 후 영속화 → 클라이언트 변조가
    무의미(검증 통과한 유효 팀만 저장됨, 단일 사용자 로컬 MVP에 안전).
  - 장점: 신규 스키마/임시 테이블 불필요, "승인 시에만 v2 생성" 원칙 정확히 충족, DB 결정 trail은
    `revision.proposed/approved/rejected` 이벤트로 남음.
  - 대안(미채택): 제안을 Artifact(`revision_proposal_*`)로 디스크 저장 후 승인 시 재로딩 →
    감사성↑이나 파일 의존/정리 부담. 필요 시 후속 확장으로 분리.

### 9-B. 승인(approve) 단계 — v2 생성

- 모듈(신규): `lib/revision/approve.ts` →
  `approveRevision({ runId, baseRevisionId, feedbackBatchId, proposedSpec })`.
  - 공용 헬퍼(신규) `lib/team/revision.ts`:
    - `nextVersion(teamId)` = `max(version)+1`,
    - `createApprovedRevision(tx, {...})` = TeamRevision row 생성(아래 필드 보존).
  - **선검증(보정 #2)**: `Team.currentRevisionId !== baseRevisionId` → **409 `revision_stale`**
    (오래된 diff 승인 차단).
  - 트랜잭션:
    1. 제안 spec 재검증: agents의 **agentId 집합 == 현재 팀 agent 집합**(추가/삭제 0), 정확히 1 lead,
       tool allowlist, 필드 비어있지 않음(`lib/revision/validate.ts`).
    2. **agentId 기준 update만**(보정 #1): 각 agent row의 `name/role/isLead/systemPrompt/toolsAllowed/tags`
       갱신. **modelId/provider 유지, row 삭제/생성 없음.** `leadAgentId` 재계산(isLead).
    3. `TeamRevision` 신규 row 생성:
       `teamId, version=nextVersion, agentsSnapshot, agentsMd, teamJson,
        proposedBy='lead', approvedBy='user', sourceRunId=runId, feedbackBatchId,
        reason, approvedAt=now`.
    4. `Team.currentRevisionId = 새 revision.id`, `Team.leadAgentId` 갱신.
    5. **기존 revision rows는 절대 수정/삭제하지 않음**(이력 보존).
  - 트랜잭션 후 **best-effort 재export**: `exportTeamFiles`로
    `projects/{slug}/teams/{teamId}/AGENTS.md`·`team.json` 갱신 + Artifact rows.
  - `revision.approved` 이벤트 emit(payload: newVersion, revisionId).

### 9-C. 거절(reject)

- 모듈(신규): `lib/revision/reject.ts`(또는 approve 모듈 내 분기) → `revision.rejected` 이벤트만 emit.
  TeamRevision/Agent 변경 없음.

---

## 10. diff viewer 구현 방식 (결정)

- **결정: Phase 3 `RevisionDiffViewer` stub은 건드리지 않고, 신규 전용 컴포넌트 작성.**
  - 이유: `RevisionDiffViewer`는 `TeamComposer.tsx:502`에서 `agentsMd` 프리뷰로 사용 중 →
    시그니처 변경 시 Phase 3 흐름 파손 위험. 또한 "파일 1개=책임 1개" 원칙상 프리뷰와
    before/after diff는 책임이 다름.
- 순수 diff(신규): `lib/feedback/diff.ts`
  - `diffLines(before: string, after: string): DiffLine[]` — **의존성 없는 LCS**
    (Phase 3 조정사항 "no diff dependencies" 준수, npm diff 라이브러리 미사용).
    `DiffLine = { type: 'add'|'del'|'ctx'; text: string }`.
  - `summarizeTeamChanges(beforeSpec, afterSpec)` — 상위 요약(agent 추가/삭제/변경, lead 변경,
    모델 변경) 산출(team.json 기반).
  - 단위 테스트 추가(§15).
- 표현 컴포넌트(신규): `components/feedback/RevisionDiff.tsx`
  - `diffLines` 결과를 적/녹 라인으로 렌더 + `summarizeTeamChanges` 상단 요약 배지.
  - 입력은 순수 데이터(서버에서 계산해 전달)만 받는 presentational 컴포넌트.

---

## 11. API route 목록 (신규)

| 메서드/경로 | 책임 | 호출 lib |
|---|---|---|
| `POST /api/runs/[runId]/feedback` | FeedbackBatch+Feedback+AgentRating 생성, 점수 집계 | `lib/feedback/persist.ts`, `aggregate.ts` |
| `POST /api/runs/[runId]/revision` | `action: 'propose'\|'approve'\|'reject'` 디스패치 | `lib/revision/{propose,approve,reject}.ts` |

- 두 라우트 모두 **thin**: 입력 파싱/가드만, 도메인 로직은 lib에. `runtime='nodejs'`,
  `dynamic='force-dynamic'`, 상단 `ensureRecovered()`.
- 가드: run 존재·`status==='succeeded'`·team 존재. revision propose는 currentRevision 필요.
- (선택) `app/runs/[runId]/feedback`용 GET은 server component가 직접 prisma 조회로 대체(별도 라우트 불필요).

---

## 12. UI page / component 목록 (신규)

페이지:
- `app/runs/[runId]/feedback/page.tsx` — server. 데이터 로드 + 가드 + `FeedbackForm` 렌더.

컴포넌트(`components/feedback/`):
- `FeedbackForm.tsx` — 클라이언트 오케스트레이터(state 보유, 제출, 이후 RevisionReview 전환).
- `ResultFeedback.tsx` — 결과물 점수+텍스트+result 프리뷰.
- `AgentFeedbackGrid.tsx` — 반응형 grid 컨테이너.
- `AgentFeedbackCard.tsx` — 셀(좌:수행내용 / 우:입력).
- `RatingInput.tsx` — 공용 1~5 선택기(결과+agent 재사용).
- `RevisionReview.tsx` — propose 호출/진행 오버레이/diff 표시/승인·거절.
- `RevisionDiff.tsx` — diff presentational 렌더러.

기존 수정(최소):
- `components/run/RunStream.tsx` — succeeded 시 "Give feedback" CTA 추가(렌더만 추가).
- (선택) `app/page.tsx` — succeeded run 카드에 feedback 링크.

> Phase 3 `RevisionDiffViewer.tsx`, `TeamComposer.tsx`는 **변경하지 않음**.

---

## 13. 필요한 schema 변경 여부

- **신규 모델/필드 불필요.** `FeedbackBatch`/`Feedback`/`AgentRating`/`TeamRevision`가 이미
  존재·마이그레이션 완료.
- 착수 전 `prisma migrate status`로 **drift 0 확인**. drift가 있으면 그 원인부터 해결(Phase 5와 무관한
  잔여 drift가 v2 흐름을 막지 않도록).
- 만약 구현 중 정말 불가피한 필드가 필요해지면(예: `FeedbackBatch.summary`) → **단 1개의 additive
  마이그레이션**만, nullable/기본값 포함으로 추가하고 본 문서에 기록. (현 설계상 불필요.)

---

## 14. 파일 export 경로

| 산출물 | 경로 | Artifact kind | 시점 |
|---|---|---|---|
| result.md (기존) | `projects/{slug}/runs/{runId}/result.md` | `result_md` | run 성공 직후 |
| report.md (신규) | `projects/{slug}/runs/{runId}/report.md` | `report_md` | run 성공 직후 |
| agent-reports (신규) | `projects/{slug}/runs/{runId}/agent-reports/{agentId}.md` | `agent_report_md` | run 성공 직후 |
| 팀 재export (승인 시) | `projects/{slug}/teams/{teamId}/AGENTS.md`·`team.json` | `team_md`/`team_json` | revision 승인 후 |

- 모든 쓰기는 **원자적**(tmp→rename) + `safeJoin`(workspace 밖 차단) + 5MB 상한.
  공용 `lib/workspace/writeWorkspaceFile.ts`를 **신규 추출**하되, **보정 #4: 최소 변경** —
  기존 `finalResult.ts`/`exportService.ts`는 **그대로 두고**(Phase 4 result.md 흐름 불변),
  신규 report/agent-report writer만 공용 모듈을 사용한다. (기존 코드 이관은 하지 않음.)

---

## 15. 검증 명령

```powershell
pnpm --filter web typecheck
pnpm --filter web test
pnpm --filter web exec next build
pnpm --filter web exec prisma migrate status
```

- `typecheck` — 타입/이벤트 payload/스키마 정합.
- `test` — **신규 순수 모듈 단위테스트를 `package.json` test 스크립트에 추가**:
  - `lib/feedback/diff.test.ts` (LCS add/del/ctx, 동일/완전상이 케이스, summarizeTeamChanges)
  - `lib/results/report.test.ts`, `lib/results/agentReport.test.ts` (빌더 출력 스냅샷/구조)
  - (선택) `lib/team/revision.test.ts` (nextVersion 계산)
- `next build` — 신규 page/route 빌드.
- `prisma migrate status` — drift 0(스키마 무변경) 확인.
- 실패 시 1회 수정 후 재실행(프로젝트 표준 절차).

---

## 16. 수동 smoke 시나리오

1. 기존 succeeded run 상세(`/runs/[runId]`)에서 **Final result** 정상 표시 확인(Phase 4 회귀 없음).
2. 디스크 확인: `projects/{slug}/runs/{runId}/`에 `result.md` + **신규** `report.md`,
   `agent-reports/{agentId}.md` 생성. (신규 run 1건 실행해 생성 시점 검증.)
3. 과거 run(파일 없던 run): feedback 페이지에서 report/agent-report **fallback** 렌더 확인.
4. `/runs/[runId]/feedback` 진입 → 결과물 1~5 + 텍스트, agent별 grid(좌:내용/우:입력) 표시.
5. 피드백 제출 → DB에 `FeedbackBatch` 1, `Feedback`(result+agent) N+1, `AgentRating` N 행 생성 확인.
   `Team.score` 갱신 확인.
6. "팀 개선 제안 받기" → Lead 제안 + **diff viewer**(적/녹 라인 + 요약) 표시.
7. **거절** → `revision.rejected` 이벤트만, TeamRevision/Agent 불변 확인.
8. 다시 제안 → **승인** → `TeamRevision` v2 생성, `Team.currentRevisionId` 갱신,
   **v1 row 보존**, `teams/{teamId}/AGENTS.md`·`team.json` 갱신 확인.
9. 동일 team으로 신규 run 시작 시 v2(현재 revision) 반영 확인.
10. 비정상: feedback 라우트에 잘못된 rating(0,6,문자) → 400, 트랜잭션 미생성 확인.

---

## 17. 위험 요소 & 범위 밖 항목

### 위험 / 주의

- **Agent 동기화(승인 시)**: 보정 #1로 **agentId 기준 update만** 수행(추가/삭제 없음) → FK 참조
  (Task/Feedback/AgentRating/RunEvent) 안전. agent 추가/삭제는 Phase 5 범위 밖.
- **오래된 diff 승인**: 보정 #2의 `baseRevisionId` 검증으로 차단(409 `revision_stale`).
- **LLM 비용/지연**: Lead 제안은 명시적 버튼으로만 호출(자동 호출 금지) + 진행 오버레이 + 타임아웃 재사용.
- **컨텍스트 폭주**: result/report/agent-reports 발췌는 길이 상한·절단 필수.
- **stateless 라운드트립 신뢰**: 승인 시 서버 풀 재검증으로 방어(로컬 단일 사용자 전제).
- **이벤트 payload 비대화**: 제안 본문은 payload에 싣지 않음(요약만). 본문은 응답/재전송으로 처리.
- **공용 writer 추출 시 회귀**: `finalResult.ts`/`exportService.ts` 이관은 선택사항으로 분리해
  Phase 4 export 회귀 위험 최소화.
- **부분 제출 정책**: 결과 점수만/일부 agent만 평가 허용. 최소 조건은 "결과 rating 또는 1개 이상 입력".

### 범위 밖 (Phase 5에서 구현하지 않음)

- SaaS, 인증/멀티유저, 배포.
- inter-team collaboration.
- vector/임베딩 검색.
- tool-calling 루프(에이전트 도구 실행). (registry는 유지하되 미사용.)
- 자동 팀 재작성(피드백→무승인 적용), 점수 기반 자동 모델 교체.
- AgentRating 대시보드/분석, Team Library 분석.
- Worker/BullMQ 추출, 동시성 >1.

---

## 18. 신규/수정 파일 요약 (단일 책임 기준)

신규 lib:
- `lib/results/report.ts` — run 리포트 빌더(순수)
- `lib/results/agentReport.ts` — agent 리포트 빌더(순수)
- `lib/results/exportRunOutputs.ts` — 출력 오케스트레이터(result+report+agent-reports 쓰기/Artifact/이벤트)
- `lib/workspace/writeWorkspaceFile.ts` — 공용 원자적 writer(추출)
- `lib/feedback/persist.ts` — FeedbackBatch/Feedback/AgentRating 트랜잭션
- `lib/feedback/aggregate.ts` — Team.score 재계산(선택)
- `lib/feedback/diff.ts` — LCS diff + 팀 변경 요약(순수)
- `lib/agents/leadRevise.prompt.ts` — 개선 제안 프롬프트/전용 스키마(agentId echo, model 변경 없음)
- `lib/agents/leadRevise.ts` — 개선 제안 호출
- `lib/revision/validate.ts` — 제안 검증(agentId 집합 일치·1 lead·tool allowlist)
- `lib/team/revision.ts` — nextVersion / createApprovedRevision 헬퍼
- `lib/revision/propose.ts`, `lib/revision/approve.ts`, `lib/revision/reject.ts`

신규 API:
- `app/api/runs/[runId]/feedback/route.ts`
- `app/api/runs/[runId]/revision/route.ts`

신규 UI:
- `app/runs/[runId]/feedback/page.tsx`
- `components/feedback/{FeedbackForm,ResultFeedback,AgentFeedbackGrid,AgentFeedbackCard,RatingInput,RevisionReview,RevisionDiff}.tsx`

수정(최소):
- `lib/dag/executor.ts` — 기존 `exportFinalResult`(result.md) 호출은 **그대로 두고**, 그 뒤에
  report.md/agent-reports export 호출 1줄 추가(best-effort). result.md 흐름 불변(보정 #4).
- `lib/events/types.ts` — `revision.proposed/approved/rejected` 타입 추가(result.created는 불변).
- `components/run/RunStream.tsx` — succeeded 시 "Give feedback" CTA(렌더만 추가).
- `apps/web/package.json` — test 스크립트에 신규 테스트 추가.

> `finalResult.ts`, `exportService.ts`, `app/api/teams/route.ts`는 **변경하지 않음**(보정 #4).

신규 Artifact kind: `report_md`, `agent_report_md`.
신규 이벤트: `revision.proposed`, `revision.approved`, `revision.rejected`, (선택) `feedback.submitted`.
스키마 변경: **없음**.
