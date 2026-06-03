# Phase 20 Plan — Server-Side Full RunEvent Link Audit (read-only)

> 상태: **계획 검토 단계 (코드 미수정)**. 산출물은 본 `PHASE20_PLAN.md` 1개. `PHASE_LOG.md` / `PHASE19_PLAN.md` 미수정, schema/migration/package 미변경, 브랜치 미생성, 구현 미시작.
> 방향: Phase 19 dry-run planner가 "loaded/visible" 한정으로 보류했던 **RunEvent↔Artifact 링크 카운트를 서버측 전체 DB 기준으로 권위 있게 산출**한다. **read-only only — 삭제/dedupe/update/upsert/unique/삭제버튼 일절 없음.** 실제 cleanup은 Phase 21+ 별도 backup-gated destructive Phase로 분리. schema 0 / dependency 0. **신규 read-only route 1개 허용**(opt-in fetch).

---

## 0. 확정 결정 (Confirmed decisions)

> 사용자 승인 완료. 본 Phase 구현은 이 결정을 contract로 따른다.

1. **주제 = server-side full RunEvent link audit only.** read-only / non-destructive / schema 0 / dependency 0. 실제 cleanup/delete/dedupe/unique/upsert는 **Phase 21+ 별도 backup-gated destructive Phase**.
2. **endpoint 정책 = 신규 read-only route 허용.** `GET /api/runs/[runId]/artifacts/cleanup-audit` opt-in fetch(exports pane 열 때만). state polling에 groupBy를 매번 얹지 않기 위함. **route는 read-only — write/delete/update/upsert 절대 금지.**
3. **audit 입력 = 서버 자체 산출.** route가 run의 Artifact row를 조회하고 기존 latest 정의(`createdAt` desc, `id` desc)로 비-latest candidate id를 **서버에서** 산출. 클라이언트가 삭제 후보 id를 계산해 넘기지 않음. Phase 21 cleanup이 재사용하도록 **순수·테스트 가능한 helper**로 분리.
4. **audit 범위 = 전 kind 후보 그룹 산출, 링크는 result_md 중심 설명.** RunEvent 링크는 `result.created`/`result_md`만 실제 의미가 있음. 다른 kind는 `0 linked events` / `no linked events expected`로 표기. UI에 "RunEvent links only apply to result artifacts today" 설명 추가.
5. **UI 표기.** RunExportsPane에 opt-in audit fetch 추가. Phase 19 **loaded/visible 링크**와 server-side **full audit 링크**를 구분 표기. 예: `Loaded links: N` / `Full audit links: M` / `These links would be set to null by a future cleanup`. 여전히 **비파괴 / 삭제 버튼 없음 / cleanup 실행 없음 / "would free bytes" 미사용**.
6. **삭제 후보 id 목록.** helper/route 결과에는 per-group 비-latest candidate id를 포함해도 됨(Phase 21 재사용 + 테스트용 내부 데이터). **UI는 기본적으로 id 목록 미노출, 카운트 중심.**

---

## 1. 현재 코드 기준 사실 (검증됨, file:line)

### 1.1 "loaded/visible" 부분성 (Phase 20 동기)
- `app/api/runs/[runId]/state/route.ts` events 매핑은 Phase 19에서 `artifactId`를 additive로 노출하지만 **polling 경로 한정**. **SSE `RunEventEnvelope`(`src/lib/dag/runRegistry.ts:6-`)에는 `artifactId` 필드가 없음** → SSE/initial로만 로드된 클라이언트는 링크가 안 보임. events take 1000 cap도 있어 **loaded 카운트는 과소보고** 가능. → 서버측 전체 DB 카운트가 필요.

### 1.2 RunEvent 링크 / FK
- artifactId를 RunEvent에 설정하는 곳은 **`src/lib/dag/executor.ts:544-547`의 `result.created` 한 곳뿐**. report/agent/team은 링크 없음 → audit는 사실상 result_md만 유의미(§0.4).
- `prisma/migrations/20260505143208_init/migration.sql:153` — `RunEvent_artifactId_fkey ... ON DELETE SET NULL`. (Phase 20은 삭제하지 않음; 이 사실은 "미래 cleanup 시 NULL 될 링크"를 설명하기 위한 근거.)

### 1.3 latest / candidate 정의 (재사용)
- `src/lib/results/artifactList.ts:23-43` — `isNewer`(createdAt desc, id desc) + `selectLatestArtifacts`(그룹당 latest), `groupArtifactHistory`(`{latest, versions[]}`, newest-first). 키 `` `${kind} ${path}` ``. **비-latest candidate id = 그룹 versions 중 latest 제외**. 입력 미변경(읽기 전용 재사용).
- `src/lib/results/runArtifacts.ts` — `loadRunArtifacts`(latest-per-group + Phase 18/19 stats), `loadArtifactHistory`(per-(kind,path) versions). take 상한 RUN_ARTIFACTS_MAX 1000 / HISTORY_MAX 200.

### 1.4 Phase 19 planner / 데이터 흐름
- `src/lib/results/artifactCleanupPlan.ts` — `planGroupCleanup`/`summarizeCleanupPlan`(loaded set 기반 `loadedLinkedEventsAffected` 카운트). Phase 20 audit는 이를 보완(권위 카운트)하되 대체하지 않음(loaded와 full 둘 다 표기).
- `src/components/run/RunExportsPane.tsx` — open 시 run-level "Cleanup preview (no changes made)" + history 패널 내 per-row preview. download/copy-path/history/preview. **삭제 버튼 없음**.
- `src/components/run/RunStream.tsx` — `loadedLinkedArtifactIds`(polling 링크 set) → RunExportsPane prop.

### 1.5 라우트 구조 / 감사 인프라
- `app/api/runs/[runId]/artifacts/`에 `[artifactId]/route.ts`(preview), `[artifactId]/download/route.ts`, `history/route.ts` 존재 → 신규 `cleanup-audit/route.ts` sibling 추가 위치.
- `src/lib/events/append.ts`는 `artifactId` 파라미터 지원(미래 cleanup audit 이벤트용; **이번 Phase 미사용**).

---

## 2. 포함 범위 / 제외 범위

### 2.1 포함 (In scope)
- 순수 helper(`artifactLinkAudit.ts`, +test): 후보 산출 + 링크 카운트 집계(read-only, prisma-free).
- 신규 **read-only** route `GET /api/runs/[runId]/artifacts/cleanup-audit`: 서버에서 artifact 조회 + 후보 비-latest id 산출 + `runEvent.groupBy`로 전체 DB 링크 카운트 → JSON.
- `RunExportsPane`: opt-in audit fetch + loaded vs full audit 링크 구분 표기(+result-only 설명). **삭제/실행 버튼 없음.**
- 순수 helper 단위 테스트 + provider-free **read-only** smoke.

### 2.2 제외 (Out of scope → Phase 21+)
- 실제 cleanup / delete / dedupe / update / upsert / `@@unique`. **삭제 버튼 금지.**
- backup/VACUUM/cleanup executor, `artifacts.cleaned` 감사 이벤트 발행.
- cross-run / admin dashboard, zip/bundle, markdown renderer.
- audit route에서의 어떤 write(create/update/delete/upsert)도 금지.

### 2.3 절대 미변경 (invariant)
- `prisma/schema.prisma`, migrations, lockfile, **artifact 생성부 4곳**(`executor.ts:531`·`exportReports.ts:165`·`teams/route.ts:204`·`approve.ts:169`), `PHASE_LOG.md`, `PHASE19_PLAN.md`.
- `selectLatestArtifacts`/`groupArtifactHistory`(읽기 전용 재사용), `planGroupCleanup`/`summarizeCleanupPlan`(Phase 19, 변경 없음 — 보완만), preview/download/history routes, state route, RunStream의 기존 동작. **Artifact·RunEvent row는 읽기만.**

---

## 3. lib / API / UI 변경 계획

### 3.1 신규 순수 helper — `src/lib/results/artifactLinkAudit.ts`
- prisma-free, I/O 없음, 입력 미변경.
- `selectCleanupCandidates(rows: readonly ArtifactRow[])` → per-(kind,path) `{ kind, path, latestId, candidateIds: string[] }` (candidateIds = 비-latest id, `groupArtifactHistory`/`isNewer` 기준). 모든 candidateIds의 flat 목록도 제공(route가 groupBy where:{in} 에 사용).
- `buildLinkAudit(candidates, linkCountByArtifactId: ReadonlyMap<string, number>)` → per-group `{ kind, path, latestId, candidateCount, linkedEventsAffected }`(linkedEventsAffected = Σ candidateIds의 linkCount) + run-level `{ totalGroups, cleanupCandidateRows, affectedGroups, fullAuditLinkedEvents }`(fullAuditLinkedEvents = Σ 전 그룹 linkedEventsAffected).
- 링크가 없는 kind는 자연히 linkedEventsAffected 0.

### 3.2 신규 read-only route — `app/api/runs/[runId]/artifacts/cleanup-audit/route.ts`
- `runtime='nodejs'`, `dynamic='force-dynamic'`. **GET only, read-only.**
- 단계: ① `prisma.artifact.findMany({ where:{runId}, orderBy:{createdAt:'desc'}, take: RUN_ARTIFACTS_MAX, select:{id,kind,path,createdAt} })` → rows. ② `selectCleanupCandidates(rows)` → candidates + candidateIds. ③ `prisma.runEvent.groupBy({ by:['artifactId'], where:{ runId, type:'result.created', artifactId:{ in: candidateIds } }, _count:{ _all:true } })` → `linkCountByArtifactId` Map. (candidateIds 비면 groupBy 생략.) ④ `buildLinkAudit(...)` → JSON.
- 응답(read-only): `{ summary: { totalGroups, cleanupCandidateRows, affectedGroups, fullAuditLinkedEvents }, groups: [{ kind, path, candidateCount, linkedEventsAffected, candidateIds? }] }`. (Q6: candidateIds는 Phase 21 재사용/테스트용으로 포함 가능하나 UI는 카운트만.)
- **write 동사 0 — findMany/groupBy(읽기)만.** 신규 endpoint이지만 read-only.

### 3.3 UI — `src/components/run/RunExportsPane.tsx`
- open 시 **opt-in fetch** `GET …/artifacts/cleanup-audit` → `auditState`(loading/data/error)에 저장(기존 lazy fetch 패턴 재사용). 기존 Phase 18/19 표시는 유지.
- run-level: Phase 19 "Cleanup preview" 줄에 인접해 **`Loaded links: N` / `Full audit links: M`** 구분 표기 + `These links would be set to null by a future cleanup` + 작은 설명 `RunEvent links only apply to result artifacts today`.
- per-group(선택): history 패널 preview에서 해당 그룹의 full-audit linkedEvents를 loaded와 함께 표기 가능(카운트만).
- **삭제/실행 버튼 없음, "would free/reclaim/save space" 미사용.** download/copy-path/history/preview 무회귀.

### 3.4 `apps/web/package.json` (test 스크립트만)
- `artifactLinkAudit.test.ts`만 additive 등록. dependencies/devDependencies 불변.

---

## 4. schema / dependency 영향: **0 / 0**
- Prisma migration 0(스키마 무변경) — 구현 후 `prisma migrate status` 4 migrations up-to-date 재확인.
- 신규 dependency 0(package.json test 스크립트만). **신규 read-only route +1**(라우트 수 +1; write 없음) — Q2로 명시 허용.

## 5. 테스트 계획
- `artifactLinkAudit.test.ts`(prisma-free, 결정적):
  - `selectCleanupCandidates`: 빈 입력; 단일 버전(candidateIds []); 다버전(candidateIds = 비-latest, latestId = isNewer 기준); 복수 그룹; 키 `${kind} ${path}` 일치; 입력 미변경.
  - `buildLinkAudit`: linkCount 맵으로 per-group linkedEventsAffected(Σ candidate 링크) / candidateCount; run-level totals(cleanupCandidateRows/affectedGroups/fullAuditLinkedEvents); 링크 없는 kind → 0; 빈 입력 → zeros; 입력 미변경.
- 회귀: `corepack pnpm typecheck`(0), `corepack pnpm test`(기존 279 + 신규 전부 pass), `corepack pnpm exec next build`(신규 route 등록 확인, 라우트 수 +1).

## 6. provider-free smoke 계획 (`apps/web/smoke-p20.mts`, read-only 우선)
- 작성 → 실행 → 삭제(미커밋). 동적 import + CJS 언래핑(정적 named import 금지). route 핸들러는 동적 import로 로드.
- **read-only 우선**: 기존 run에 대해 cleanup-audit route GET → summary가 raw `artifact.findMany` 그룹핑(비-latest 후보 수)과 일치, fullAuditLinkedEvents가 raw `runEvent.groupBy(type:'result.created', artifactId in candidates)`와 일치 검증. **어떤 row도 생성/수정/삭제하지 않음.**
- 링크 케이스(필요 시): 임시 다버전 result_md + 비-latest 가리키는 임시 `result.created` RunEvent 생성 → audit의 해당 그룹 linkedEventsAffected = 1, fullAuditLinkedEvents 반영 검증 → `finally`에서 임시 RunEvent + Artifact 삭제, 잔여 0(기존 row 미변경).
- `corepack pnpm exec tsx apps/web/smoke-p20.mts` → 전건 pass 후 삭제.

## 7. (구현 후) code-review 포커스
- **read-only/비파괴**: route·helper·UI 어디에도 artifact/runEvent write(create/update/delete/upsert) 없음, 삭제 버튼 없음(이번 Phase 핵심 불변).
- scope: §2.1 파일 한정, schema/migration/lockfile/생성부4/`PHASE_LOG`/`PHASE19_PLAN` 무변경.
- 용어: "would free/reclaim/save space" 미사용. 링크는 "loaded" vs "full audit" 구분, result-only 설명 포함.
- 정확성: candidate = 비-latest(isNewer 일치), linkedEvents = result.created 한정 groupBy 합. additive UI(구 데이터 무crash).

## 8. 리스크 & Deferred
- **리스크**
  - (a) **신규 endpoint 추가**(Phase 15~19 "endpoint 최소" 기조에서 +1) — read-only·opt-in으로 한정, Q2 명시 승인.
  - (b) audit는 take 상한(RUN_ARTIFACTS_MAX) 내 후보 집계 — 매우 큰 run은 후보가 capped(현 그룹 최대 7 ≪ 1000; 문서화). groupBy는 candidateIds in 절로 제한되어 안전.
  - (c) result_md 외 kind는 링크 0 — UI에서 "result artifacts only" 설명으로 혼동 방지.
  - (d) loaded vs full 카운트 차이는 의도된 투명성(SSE는 artifactId 미노출). UI가 둘을 분리 표기.
  - (e) candidateIds를 응답에 포함 시 id 노출 — UI 미표시, Phase 21 재사용/테스트 한정.
- **Deferred → Phase 21+**: 실제 cleanup/dedupe + backup + tx + `artifacts.cleaned` 감사 이벤트(별도 destructive Phase); `@@unique`+upsert(Phase 22, append-only 종료); cross-run/admin dashboard; zip/bundle; markdown renderer.

## 9. 구현 순서 초안 (승인·구현 단계에서만)
1. 순수 `artifactLinkAudit.ts`(`selectCleanupCandidates` + `buildLinkAudit`) + 테스트, package.json 등록 → `corepack pnpm test`.
2. 신규 read-only route `cleanup-audit/route.ts`: artifact findMany → candidates → runEvent.groupBy(read) → buildLinkAudit → JSON. **write 없음** → typecheck/build(route 등록 확인).
3. `RunExportsPane`: opt-in audit fetch + loaded vs full audit 표기(+result-only 설명, 삭제 버튼 없음) → typecheck/build.
4. 검증: typecheck / test(279+신규) / `next build`(라우트 +1) / `prisma migrate status`(0 added).
5. provider-free **read-only** smoke(`smoke-p20.mts`): audit 카운트 vs raw artifact/runEvent 그룹핑 일치 + 링크 케이스 → 실행 → 삭제 → 잔여 0.
6. code-review(read-only·비파괴·scope·용어·endpoint 정당성) → 보고 후 커밋/PR(별도 승인).

> 각 단계는 surgical edit + 즉시 검증. 본 문서 작성 단계에서는 코드·스키마·`PHASE_LOG.md`·`PHASE19_PLAN.md`·브랜치를 일절 변경하지 않는다. **이번 Phase의 핵심 불변: Artifact/RunEvent를 읽기만 하고, 신규 route도 read-only이며, 어떤 삭제/수정/삭제버튼도 만들지 않는다.**
