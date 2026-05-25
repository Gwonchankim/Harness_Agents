# Phase 15 Plan — Artifact/Export Hygiene + Report Discovery UX

> 상태: **승인 완료 — 구현 대기 (코드 미수정)**. `PHASE_LOG.md`는 구현/검증 후 별도 갱신.
> 주 테마: 앱 안에서 run 산출물(`result.md`/`report.md`/`agent-reports/*`)을 쉽게 찾고 확인 + append-only Artifact 행을 **표시 계층에서 latest만** 선택. **schema 0, dependency 0.** cleanup/upsert는 Phase 16+ 보류.

---

## 승인 후 확정 결정사항 (Confirmed — 2026-05-25)

1. **Artifact 정책** = **append 유지 + latest 표시**. DB Artifact row는 기존처럼 append-only, UI/조회 계층에서 `(runId, kind, path)` 기준 **최신 artifact만** 선택해 표시. upsert/cleanup/backfill/unique index는 **Phase 16+ 보류**.
2. **schema migration 0 · dependency 0** 확정.
3. **preview 수준** = **lazy 텍스트 preview + path copy**. artifacts 메타를 먼저 보여주고, 펼칠 때 별도 endpoint로 파일 내용 lazy fetch. **markdown 렌더링 신규 dependency 미도입**(plain text/markdown source 표시로 충분). **다운로드는 Phase 16+ 보류.**
4. **state API** = **artifacts metadata만** 포함(전문 미포함). 전문은 별도 lazy endpoint에서 `artifactId` 기준 fetch. page 초기 로드도 메타만 전달.
5. **result.md 책임** = exports 패널에 `result.md`도 **"exported file"** 로 포함(+ report.md/agent-reports 동일 패널), **기존 `FinalResultPane`은 "최종 결과물 보기"로 그대로 유지**.

**추가 원칙(확정):** schema migration 0 · dependency 0 · Artifact append-only 유지 · cleanup/backfill 없음 · 신규 endpoint는 **텍스트 파일 preview lazy fetch 전용** · 파일 경로는 **workspace safeJoin/safe path 검증** 사용 · DB엔 있으나 디스크에서 사라진 파일은 **graceful error** 표시 · 대형 파일은 **preview 길이 제한** · Phase 16+ 후보로 **artifact cleanup/upsert/download/markdown renderer** 문서화.

---

## 1. 현재 코드 기준 사실 정리 (검증됨)

| 항목 | 사실 | 위치 |
| --- | --- | --- |
| Artifact 모델 | `id, runId, taskId?, kind, path, mimeType(@default text/markdown), bytes(@default 0), sha256?, createdAt`. **`updatedAt` 없음, `(runId,kind,path)` unique 없음.** index: `@@index([runId])`,`[taskId]`,`[kind]`. | `prisma/schema.prisma` Artifact |
| 생성 정책 | 전부 `prisma.artifact.create`(=append). 재export마다 새 행. result.md(executor), report.md/agent-reports(exportReports), team(revision/approve, 참고용). | 아래 |
| result.md | executor `exportFinalResult`가 `writeWorkspaceFile`로 디스크 기록 후 `artifact.create({kind:'result_md'})`. | `dag/executor.ts` (exportFinalResult; executeInner/resumeInner 성공 경로) |
| report.md / agent-reports | exportReports의 `writeArtifact` 헬퍼가 `report_md`/`agent_report_md` 행 생성. 경로 `…/runs/{runId}/report.md`, `…/agent-reports/{agentId}.md`. | `lib/results/exportReports.ts` |
| 파일 vs DB 발산 | `writeWorkspaceFile`은 동일 path를 **덮어쓰기**(파일은 singleton). 그러나 DB는 unique 없어 **행 누적**. → 핵심 hygiene 이슈. | `lib/workspace/writeWorkspaceFile.ts` |
| 이미 있는 latest 패턴 | `loadRunResultMarkdown(runId)` = `artifact.findFirst({where:{runId,kind:'result_md'}, orderBy:{createdAt:'desc'}})` 후 파일 read → **kind별 최신 선택 + 파일 read 패턴 존재**(재사용/일반화 대상). 과거 run은 plan/task로 fallback 합성. | `lib/results/finalResult.ts` |
| executor export 호출 | executeInner + resumeInner 성공 경로 모두 `exportFinalResult` + `exportRunReports` 호출 → rerun/resume마다 행 누적. | `dag/executor.ts` |
| run 상세 데이터 | page.tsx는 **Artifact 목록 미조회**. `loadRunResultMarkdown`로 result.md 문자열만 얻어 `finalResult`로 RunStream에 inline 전달. report.md/agent-reports 미노출. | `app/runs/[runId]/page.tsx` |
| state API | 응답 `{run,tasks,events,finalResult,nextSince}`. **artifacts 미반환**, finalResult 문자열만. | `app/api/runs/[runId]/state/route.ts` |
| UI 노출 현황 | `report_md`/`agent_report_md`/artifact 링크를 보여주는 UI **전무**(grep 0건). `FinalResultPane`만 result.md 문자열을 `<pre>`로 표시(별도 fetch 없음, inline). | `RunStream.tsx` FinalResultPane |
| RunStream 레이아웃 | status바 → recovery → resume/retry → `DagGraph` → `FinalResultPane` → `RunActivityTimeline` → `AgentReportPane` → overlay. | `RunStream.tsx` 렌더부 |
| 재사용 자산 | collapsible(AttemptHistory/RunActivityTimeline `▾/▸`), Phase 12 lazy 콘텐츠 엔드포인트 패턴(`attempts/[attemptId]`), `STATUS_STYLE`, 시간 포맷, `safeJoin`/`workspaceRoot`(경로 안전). | 각 파일 |

**핵심:** 중복은 **표시 계층에서 latest 선택**(이미 `loadRunResultMarkdown`가 쓰는 `orderBy createdAt desc` 패턴)으로 해소 가능 → schema 변경 없이 hygiene 달성. report.md/agent-reports는 메타 노출 + 전문은 lazy fetch.

---

## 2. 포함 범위 / 제외 범위

### 포함 (Phase 15)
1. **순수 헬퍼** `selectLatestArtifacts(rows)` — append-only Artifact 행을 `(kind, path)`별 **최신(createdAt desc)** 으로 dedupe → 표시용 목록. 단위 테스트.
2. **Artifact 메타 로드** — page.tsx(초기) + state API가 run의 Artifact **메타데이터**(id,kind,path,bytes,sha256,createdAt,taskId)를 `selectLatestArtifacts`로 정리해 전달. **파일 전문 미포함.**
3. **lazy 콘텐츠 엔드포인트** `GET /api/runs/[runId]/artifacts/[artifactId]` — 소속 검증 후 workspace 파일 read(미존재 시 `missing` 플래그). preview용.
4. **신규 컴포넌트** `RunExportsPane.tsx` — collapsible "Run exports" 패널: result.md/report.md/agent-reports 최신 항목(kind·path·bytes·최신 createdAt) + per-row **path 복사** + **lazy preview**(앞부분, truncation). 산출물 없으면 graceful.
5. RunStream 배선(`FinalResultPane` 아래에 RunExportsPane).

### 제외 (Phase 16+)
- Artifact **`(runId,kind,path)` upsert / unique index / 중복행 cleanup / backfill**(스키마/마이그레이션 동반) → 보류.
- 파일 **다운로드/OS 열기**, 마크다운 **렌더링**(react-markdown 등 신규 dep) → 보류(텍스트 preview만).
- team 아티팩트(AGENTS.md/team.json) 노출 → 보류(run exports에 집중).
- 전문을 state/페이지에 inline 적재.

---

## 3. Artifact 정책 제안

| 방안 | 내용 | 장점 | 단점 | migration |
| --- | --- | --- | --- | --- |
| **A. append 유지 + latest 표시 (권장)** | 생성은 그대로 append, **UI/조회는 `(kind,path)`별 최신만** 선택(`selectLatestArtifacts`) | 코드 변경 작음, 위험 0, 기존 `loadRunResultMarkdown` 패턴과 일관, 감사 이력(모든 export) 보존 | DB에 중복행 계속 누적(표시엔 무해) | **0** |
| B. `(runId,kind,path)` upsert | 생성을 upsert로 | DB 깔끔 | `@@unique` 필요 → **migration**, 기존 중복행 정리 필요, 감사 이력 상실 | 1+ |
| C. cleanup/backfill | 과거 중복행 정리 스크립트 | DB 정리 | 일회성 운영 + 위험 | (B와 병행) |

**권장:** **A (append + latest 표시, 0-migration)**. B(upsert)·C(cleanup)는 **Phase 16+ 보류**(사용자 방향과 일치). dedupe는 순수 `selectLatestArtifacts`가 표시 시점에 담당.

---

## 4. UX 설계

- **배치**: `FinalResultPane` **아래**, `RunActivityTimeline` 위에 "Run exports" collapsible 패널(산출물끼리 묶음). 기본 collapsed(또는 succeeded면 expanded — 결정 질문).
- **표시 대상**: `result_md`(1) · `report_md`(1) · `agent_report_md`(N, agentId별). 각 행: 파일명/경로, bytes, 최신 생성 시각, kind 라벨. agent-report는 path의 `{agentId}`를 `team.agents`로 이름 매핑.
- **행 액션**: **path 복사**(navigator.clipboard, dep 없음) + **preview**(펼치면 lazy fetch → 앞 N자 + "Show full"/접기, `<pre>`; FinalResultPane 스타일 재사용). **다운로드/열기/마크다운 렌더는 Phase 16+.**
- **상태별 표시**:
  - succeeded: result/report/agent-reports 표시.
  - failed/cancelled: export는 성공 시에만 생성되므로 보통 없음 → "No exports yet for this run." (단 부분 export가 있으면 있는 것만 표시).
  - historical(성공했지만 과거): 존재하는 artifact만 표시. result.md는 FinalResultPane fallback과 별개로, Artifact 행이 없으면 exports에 미표시(또는 "result.md available via deliverable above" 안내 — 결정).
  - 산출물 0개: "No exports yet."
- **stale**(DB 행 있으나 파일 없음): preview 시 `missing` → "file no longer on disk" 표시(크래시 없음).
- **result.md 책임 분리**: `FinalResultPane`=렌더된 deliverable(기존 유지). `RunExportsPane`=파일 발견/경로/preview(목록). result.md는 두 곳에 다른 목적으로 등장(결정 질문).

---

## 5. API / lib / UI 변경 계획

### lib (신규, 순수)
- **`src/lib/results/artifactList.ts`** — 
  ```ts
  interface ArtifactRow { id: string; kind: string; path: string; bytes: number; sha256: string | null; createdAt: string; taskId: string | null; }
  export function selectLatestArtifacts(rows: readonly ArtifactRow[]): ArtifactRow[]; // (kind,path)별 최신, 안정 정렬
  ```
  단위 테스트.
- **workspace 안전 read** — `loadRunResultMarkdown`의 파일 read를 일반화한 작은 reader(없으면 추가): `workspaceRoot()` + `safeJoin(path)` read, 미존재 시 null. (신규 dep 없음.)

### API
- **신규 `GET /api/runs/[runId]/artifacts/[artifactId]`** (신규): `ensureRecovered` → artifact가 run 소속 검증 → 파일 read → `{ artifact:{kind,path,bytes,createdAt}, content?:string, missing?:true }`. (전문은 여기서만, on-demand.)
- **`state` API 확장**: 응답에 `artifacts`(메타, `selectLatestArtifacts` 적용) 추가 — **전문 미포함**(결정 질문). rerun 후 패널 자동 갱신용.

### UI
- **`src/components/run/RunExportsPane.tsx`** (신규) — 메타 목록 렌더 + path 복사 + lazy preview(artifact 콘텐츠 엔드포인트). collapsible, graceful degrade.
- **`app/runs/[runId]/page.tsx`** — run의 Artifact 메타 조회 → `selectLatestArtifacts` → RunStream initial로 전달.
- **`src/components/run/RunStream.tsx`** — `FinalResultPane` 아래 `<RunExportsPane artifacts={...} agents={state.team.agents} runId=… status=…/>` 추가. (state API가 artifacts 반환 시 reducer에 보관.)

> exportReports/finalResult **생성 로직 무변경**(append 유지). executor 무변경. result.md/FinalResultPane 동작 유지.

---

## 6. schema / dependency 변경 여부

**권장: schema 0 · dependency 0.** dedupe는 `selectLatestArtifacts`(표시), 콘텐츠는 fs read + 기존 `safeJoin`, 복사는 `navigator.clipboard`. unique/upsert(방안 B)를 택하면 `@@unique([runId,kind,path])` migration + 기존 중복행 정리가 필요 → **Phase 16+ 보류**(0-migration 대안=방안 A로 충분). markdown 렌더링 라이브러리(신규 dep)는 미도입(텍스트 preview).

---

## 7. 테스트 계획

- **신규 순수** `artifactList.test.ts` — `selectLatestArtifacts`: 동일 (kind,path) 중복 → 최신 1개, 서로 다른 kind/path 보존, agent-reports 여러 path, 빈 입력 → [], 정렬 안정성, createdAt 동률 처리.
- **회귀**: 전체 `typecheck` + `test`(현재 213 + 신규) + `next build`(신규 라우트 +1: artifacts/[artifactId]) + `prisma migrate status`(4 migrations, 0 added). exportReports/finalResult 생성 회귀(report/agentReport 기존 테스트 유지).
- 콘텐츠 엔드포인트/패널 = 수동 smoke. (소속검증 404, missing 플래그는 smoke로.)

---

## 8. 수동 smoke 시나리오

> 디스크 경로: `projects/{slug}/runs/{runId}/result.md|report.md|agent-reports/*.md`.

1. **신규 succeeded run**(또는 기존 succeeded run을 rerun) → exports 패널에 result/report/agent-reports 최신 1행씩, path·bytes·시각 일치.
2. **rerun으로 report 재생성된 run** → Artifact 행은 누적(중복)이나 패널은 **(kind,path)별 최신 1개만** 표시(dedupe 확인), 최신 createdAt 갱신.
3. **agent-reports 여러 개 있는 run**(다중 agent) → agent-report 항목 N개, agentId→이름 매핑.
4. **historical run** → 존재하는 artifact만 표시(없으면 "No exports yet").
5. **failed run** → 보통 exports 없음 → graceful 안내.
6. **stale**: report.md 파일 삭제 후 preview → `missing` 표시(크래시 없음).
7. 디스크 파일 내용과 preview 일치, path 복사 동작.
8. 회귀: result.md는 FinalResultPane에 그대로 표시(기존 유지).

---

## 9. 리스크와 결정 질문

### 리스크
- R1 append-only 중복행 계속 누적(표시엔 무해, DB 성장) → 정리는 Phase 16+.
- R2 콘텐츠 엔드포인트가 임의 파일 read → **소속 검증 + `safeJoin`(traversal 방지)** 필수.
- R3 대형 report/agent-report preview → truncation + lazy(목록엔 메타만).
- R4 DB 행 있으나 파일 없음(stale) → `missing` 플래그.
- R5 state API에 artifacts 메타 추가 → 작지만 응답 약간 증가(전문은 제외).

### 결정 (확정됨 — 위 "승인 후 확정 결정사항" 참조)
1. Artifact = **append 유지 + `(runId,kind,path)` latest 표시**(0-migration). upsert/cleanup/backfill/unique는 Phase 16+.
2. **schema 0 · dependency 0**.
3. preview = **lazy 텍스트 preview + path copy**. markdown 렌더 dep·다운로드는 Phase 16+.
4. state API = **artifacts metadata만**(전문 미포함); 전문은 lazy endpoint(`artifactId`).
5. exports 패널에 **result.md 포함**(exported file), **FinalResultPane은 최종 결과물 보기로 유지**; report.md·agent-reports도 동일 패널.

### Phase 16+ 후보 (문서화)
- Artifact `(runId,kind,path)` upsert / 중복행 cleanup / backfill / unique index(+migration).
- 파일 **다운로드**, **markdown 렌더러**(신규 dep), team 아티팩트(AGENTS.md/team.json) 노출.

---

## 검증(Verification) 요약
```
corepack pnpm --filter web typecheck                   # 0 errors
corepack pnpm --filter web test                        # 213 + selectLatestArtifacts 케이스
corepack pnpm --filter web exec next build             # PASS, 라우트 +1 (artifacts/[artifactId])
corepack pnpm --filter web exec prisma migrate status  # 4 migrations, 0 added (schema 무변경)
```
+ 수동 smoke 1(succeeded exports)·2(rerun dedupe latest)·4(historical)·6(stale missing) 통과. result.md/FinalResult·exportReports 생성·Phase 8~14 경로 무영향 확인.
