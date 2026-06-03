# Phase 19 Plan — Dry-Run Cleanup Planner (non-destructive, read-only)

> 상태: **계획 검토 단계 (코드 미수정)**. 산출물은 본 `PHASE19_PLAN.md` 1개. `PHASE_LOG.md` / `PHASE18_PLAN.md` 미수정, schema/migration/package 미변경, 브랜치 미생성, 구현 미시작.
> 방향: Phase 18(redundancy 가시화) 위에 **"미래 cleanup이 무엇을 지울지" 미리보기**만 더한다. **실제 삭제/dedupe/unique/upsert/삭제 버튼은 일절 없음(Phase 20+).** Artifact row는 **읽기만** 한다. schema 0 / dependency 0 / 신규 server endpoint 0.

---

## 0. 확정 결정 (Confirmed decisions)

> 사용자 승인 완료. 본 Phase 구현은 이 결정을 contract로 따른다.

1. **주제 = dry-run cleanup planner only.** 비파괴 / read-only / schema 0 / dependency 0. 실제 cleanup·dedupe·unique index·upsert 전환은 **Phase 20+**.
2. **노출 위치 = `RunExportsPane` 내부에만.** per-row cleanup preview는 history 패널 근처, run-level summary는 Exports open block 상단. **별도 페이지·모달·cross-run dashboard 미포함(Phase 20+).**
3. **데이터 출처 = 신규 server endpoint 0.** 기존 artifacts metadata + 기존 history endpoint + Phase 18 metadata 재사용. planner 계산은 **prisma-free 순수 helper**.
4. **RunEvent 링크 영향 = 포함하되 "loaded/visible event links"로 제한.** 기존 `state/route.ts` events 매핑에 `artifactId`를 **additive로 추가**(신규 endpoint·신규 쿼리 아님). UI는 "loaded event links" / "visible event links"로 표기. **전체 DB 기준 정확한 링크 audit은 Phase 20+ server-side audit으로 보류.**
5. **planner 산출 단위**
   - per `(kind, path)` group: `keepLatestId`, older metadata rows count, **represented historical bytes**, same-content vs changed-version 구분, loaded RunEvent links that would be nulled.
   - run-level: total groups, cleanup candidate rows, affected groups, represented historical bytes, loaded linked events affected.
   - **"would free M bytes" 표현 금지.** 과거 파일 content는 이미 overwrite되어 디스크에 없으므로 row 삭제가 그만큼 디스크를 회수한다는 표현은 부정확. 대신 **"represented historical bytes" / "metadata rows" / "DB metadata cleanup candidate"**로 표기.
6. **messaging**: 지금은 변경 없음 / 미래 cleanup 미리보기일 뿐 / 실제 삭제 버튼 없음 / cleanup 실행 시 history는 latest-only로 축소 / 과거 버전은 metadata-only이며 content 복원 불가 / represented bytes는 과거 artifact metadata의 파일 크기 합이지 즉시 회수되는 디스크 공간이 아님.

---

## 1. 현재 코드 기준 사실 (검증됨, file:line)

### 1.1 append-only / 중복 / latest
- `prisma/schema.prisma:334-352` — Artifact에 `@@unique` 없음(append-only). dev.db 75 rows / 38 그룹 / ~49% redundant(Phase 16 측정).
- `src/lib/results/artifactList.ts:23-28` — latest = `createdAt` desc, 동률 시 `id` desc(`isNewer`). cleanup이 보존할 정확한 행. `selectLatestArtifacts`(31-43) / `groupArtifactHistory`(63-83)는 키 `` `${kind} ${path}` ``, 입력 미변경(읽기 전용 재사용).

### 1.2 RunEvent 링크 / FK
- `prisma/migrations/20260505143208_init/migration.sql:153` — `RunEvent_artifactId_fkey ... ON DELETE SET NULL ON UPDATE CASCADE`. → Artifact row 삭제 시 참조 RunEvent.artifactId는 **NULL**(제약 위반/orphan 없음).
- artifactId를 RunEvent에 설정하는 코드는 **`src/lib/dag/executor.ts:545,547`의 `result.created` 한 곳뿐**. report/agent/team(`exportReports.ts`/`teams/route.ts`/`approve.ts`)는 링크 없음. 매 export가 새 result_md + 새 result.created → keep-latest cleanup 시 **과거 result.created의 artifactId만 NULL**(최신 result_md는 보존되어 그 링크는 유지).

### 1.3 디스크 overwrite (represented bytes의 근거)
- `src/lib/workspace/writeWorkspaceFile.ts`(tmp→rename, 5MB cap, sha256/bytes 계산) / `finalResult.ts` / `exportService.ts` 모두 **동일 path 덮어쓰기** → 과거 버전 파일은 이미 디스크에 없음. **비-latest row 삭제 = 디스크 회수 0**. 따라서 planner는 "would free"가 아니라 "represented historical bytes"(과거 metadata의 bytes 합)로 표기해야 정확.

### 1.4 데이터 흐름 (신규 endpoint 불필요)
- `app/api/runs/[runId]/state/route.ts:43-47` — `runEvent.findMany`에 **`select` 절 없음** → 행 전체 반환(`e.artifactId` 이미 존재). 매핑(line 79-86)에서 `artifactId`만 누락 → **매핑에 `artifactId: e.artifactId` 1줄 additive**면 충분(쿼리·endpoint 불변).
- `loadRunArtifacts`(`runArtifacts.ts:23-`)는 전체 row 조회 후 `selectLatestArtifacts`로 dedupe(Phase 18에서 `countVersionsByGroup`로 versionCount/redundantCount/sameContentCount/changedVersionCount 부착). run-level 통계는 여기서 추가 계산 가능(추가 쿼리 없음).
- per-(kind,path) 전체 버전 메타(id/bytes/sha256/createdAt/latest)는 **기존 history endpoint**(`GET …/artifacts/history`, `loadArtifactHistory`)가 lazy 제공 → per-row 상세 planner의 데이터.
- `src/components/run/RunStream.tsx` — `state.events` 보유, `<RunExportsPane runId artifacts agents>`에 전달(현재 events 미전달). 클라이언트 이벤트 타입은 state route 응답 형태를 따름.

### 1.5 Phase 16/18 트레이드오프 (메시징 근거)
- keep-latest cleanup 후 history는 그룹당 1버전, Phase 18 redundancy는 0%로 붕괴. → planner 메시지는 "cleanup 실행 시 history가 latest-only로 축소"를 Phase 16/18의 "past versions are metadata only / not recoverable"와 일관되게 명시.

---

## 2. 포함 범위 / 제외 범위

### 2.1 포함 (In scope)
- 순수 planner helper(`artifactCleanupPlan.ts`, +test): per-group / run-level dry-run 산출(§3.1).
- `artifactStats.ts` / `loadRunArtifacts`에 **represented historical bytes**(그룹 비-latest bytes 합) additive 부착(이미 조회한 rows로 계산, 추가 쿼리 없음).
- `state/route.ts` events 매핑에 `artifactId` **1줄 additive**.
- `RunStream.tsx` — 로드된 이벤트의 링크 artifactId 집합(또는 events)을 `RunExportsPane`에 additive prop으로 전달.
- `RunExportsPane.tsx` — per-row cleanup preview(history 근처) + run-level summary(open block 상단). **삭제 버튼 없음**, read-only 표시만.
- 순수 helper 단위 테스트 + provider-free **read-only** smoke.

### 2.2 제외 (Out of scope → Phase 20+)
- 실제 cleanup / dedupe / 삭제 / update / upsert / `@@unique`. **삭제 버튼 금지.**
- 전체 DB 기준 RunEvent 링크 audit(서버측) — Phase 19는 "loaded/visible links"만.
- cross-run / admin dashboard, 별도 page/modal.
- `report.md`/`exportReports` 통합, zip/bundle, markdown renderer.
- 신규 server endpoint.

### 2.3 절대 미변경 (invariant)
- `prisma/schema.prisma`, migrations, lockfile, **artifact 생성부 4곳**(`executor.ts:531`·`exportReports.ts:165`·`teams/route.ts:204`·`approve.ts:169`), `PHASE_LOG.md`, `PHASE18_PLAN.md`.
- `selectLatestArtifacts`/`groupArtifactHistory`(읽기 전용), download/preview/history route, `loadArtifactHistory` 동작. **Artifact row는 읽기만(생성/수정/삭제/upsert 금지).**

---

## 3. lib / UI / state 변경 계획

### 3.1 신규 순수 helper — `src/lib/results/artifactCleanupPlan.ts`
- prisma-free, I/O 없음, 입력 미변경.
- `planGroupCleanup(versions: readonly ArtifactRow[], linkedArtifactIds?: ReadonlySet<string>)` → per-group:
  - `keepLatestId`(= `selectLatestArtifacts` 동일 기준의 최신 행 id),
  - `olderRows`(= versions − 1),
  - `representedHistoricalBytes`(= 비-latest 행 bytes 합),
  - `sameContentRows` / `changedVersions`(sha256 기준; Phase 18 정의 재사용 — null sha 제외),
  - `loadedLinkedEventsAffected`(= 비-latest 행 id 중 `linkedArtifactIds`에 포함된 수; 미전달 시 0/undefined).
- `summarizeCleanupPlan(metas, linkedArtifactIds?, latestResultMdId?)` → run-level:
  - `totalGroups`, `cleanupCandidateRows`(= Σ redundantCount), `affectedGroups`(versionCount>1), `representedHistoricalBytes`(= Σ per-group), `loadedLinkedEventsAffected`(= 로드된 `result.created` 이벤트 중 artifactId가 현재 latest result_md id가 아닌 수 — latest id는 metadata에 있음).
- 비고: 산출값은 전부 **카운트/바이트 합**일 뿐 어떤 행도 변경하지 않는다.

### 3.2 `src/lib/results/artifactStats.ts` (additive)
- `countVersionsByGroup`가 그룹별 `totalBytes`(또는 직접 `representedHistoricalBytes`)도 산출하도록 확장(이미 순회하는 rows로 계산). latest 식별은 loader가 가진 latest 행 bytes로 빼서 `representedHistoricalBytes = groupTotalBytes − latestBytes` 도출.

### 3.3 `src/lib/results/runArtifacts.ts` (additive)
- `ArtifactMeta`에 optional `representedHistoricalBytes?: number` 추가. `loadRunArtifacts`가 이미 조회한 rows로 그룹 totalBytes를 구해 `representedHistoricalBytes`(= totalBytes − 최신행 bytes)를 각 latest meta에 부착. **추가 쿼리/endpoint 없음, read-only.** `loadArtifactHistory` 무변경.

### 3.4 `app/api/runs/[runId]/state/route.ts` (additive 1줄)
- events 매핑(79-86)에 `artifactId: e.artifactId` 추가. `findMany`는 이미 전체 행 반환이라 **쿼리/select 변경 없음**. 다른 필드/계약 불변.

### 3.5 `src/components/run/RunStream.tsx` (additive)
- 클라이언트 이벤트 타입에 optional `artifactId?: string | null` 추가; `state.events`에서 artifactId가 있는 항목을 모아 **`loadedLinkedArtifactIds: Set<string>`**(또는 events)를 `RunExportsPane`에 additive prop으로 전달. 기존 reducer/SSE/polling 동작 불변(SSE/initial 경로는 이번 Phase에서 artifactId를 추가하지 않으므로 링크 신호는 polling 경로로 로드된 이벤트 기준 — "loaded/visible" 한정, §8 리스크).

### 3.6 `src/components/run/RunExportsPane.tsx` (additive 표시)
- **run-level summary**(open block 상단, Phase 18 redundancy 줄 인접): `summarizeCleanupPlan` 결과를 `total groups · cleanup candidate rows · affected groups · represented historical bytes · loaded linked events affected` 형태로 한 줄/소블록 표기.
- **per-row cleanup preview**: 해당 행의 history가 로드되면(또는 전용 토글) `planGroupCleanup(versions, loadedLinkedArtifactIds)` 결과로 `keep latest / N older metadata rows / represented historical bytes / M same-content · K changed / L loaded event links would be nulled` 표시. **삭제 버튼 없음.**
- messaging(§0.6) 문구를 명시. download/copy-path/history/preview 동작·마크업 무회귀.

### 3.7 `apps/web/package.json` (test 스크립트만)
- `artifactCleanupPlan.test.ts`만 additive 등록. dependencies/devDependencies 불변.

---

## 4. schema / dependency 영향: **0 / 0**
- Prisma migration 0(스키마 무변경) — 구현 후 `prisma migrate status` 4 migrations up-to-date 재확인.
- 신규 dependency 0(package.json test 스크립트만). **신규 server endpoint 0**(state route는 기존, additive 필드 1줄).

## 5. 테스트 계획
- `artifactCleanupPlan.test.ts`(prisma-free, 결정적):
  - `planGroupCleanup`: 단일 버전(older 0 / represented 0 / linked 0); 다버전 same sha(sameContentRows>0, changedVersions=1); 다버전 mixed sha(changed>1); null sha(분해 생략); `linkedArtifactIds`에 비-latest id 포함 시 `loadedLinkedEventsAffected` 증가, latest id만 포함 시 0; representedHistoricalBytes = Σ 비-latest bytes; keepLatestId = isNewer 기준.
  - `summarizeCleanupPlan`: 빈 입력(0); 혼합 그룹 합계; `loadedLinkedEventsAffected` = 비-latest로 향한 로드 result.created 수.
- package.json 등록 후: `corepack pnpm typecheck`(0), `corepack pnpm test`(기존 263 + 신규 전부 pass), `corepack pnpm exec next build`(라우트 수 불변).

## 6. provider-free smoke 계획 (`apps/web/smoke-p19.mts`, read-only 우선)
- 작성 → 실행 → 삭제(미커밋). 동적 import + CJS 언래핑(정적 named import 금지).
- **read-only 우선**: 기존 run에 대해 `loadRunArtifacts` + `loadArtifactHistory` 결과로 `planGroupCleanup`/`summarizeCleanupPlan`을 돌려 raw `findMany` 그룹핑(전체 행 수, 비-latest bytes 합, latest id)과 **일치** 검증. **어떤 행도 생성/수정/삭제하지 않음.**
- 필요 시에만 임시행(다버전 sha A,A,B + 단일) 결정적 케이스 추가 → `finally` 정리·잔여 0(기존 행 미변경). RunEvent 링크 케이스는 임시 `result.created`(artifactId=비-latest temp id) 1건으로 `loadedLinkedEventsAffected` 검증 후 정리.
- `corepack pnpm exec tsx apps/web/smoke-p19.mts` → 전건 pass 후 삭제.

## 7. (구현 후) code-review 포커스
- **비파괴**: 어떤 경로도 Artifact/RunEvent를 생성/수정/삭제/upsert하지 않고 read-only인지(이번 Phase 핵심 불변), 삭제 버튼이 없는지.
- scope: §2.1 파일에 한정, schema/migration/lockfile/생성부4/`PHASE_LOG`/`PHASE18_PLAN` 무변경.
- additive: `ArtifactMeta`/이벤트 타입/props 옵셔널 추가로 구 클라이언트·구 데이터 무crash; state route 계약 불변.
- 용어: "would free/reclaim disk" 미사용, "represented historical bytes"/"metadata rows" 사용. 링크 표기는 "loaded/visible" 한정.

## 8. 리스크 & Deferred
- **리스크**
  - (a) **링크 신호 partial**: state route(polling)만 `artifactId` additive 추가 → SSE/initial 경로로만 로드된 클라이언트에서는 링크가 안 보일 수 있음. 의도된 "loaded/visible event links" 한정이며 정확 audit은 Phase 20+(문서·UI에 명시).
  - (b) **용어 정확성**: represented historical bytes ≠ 디스크 회수(과거 파일은 이미 overwrite). UI/문구에서 반드시 구분.
  - (c) `ArtifactMeta`가 lib/컴포넌트 2곳 정의 → additive 옵셔널 동기화.
  - (d) per-row 상세는 history 로드 시 계산(미로드 그룹은 run-level 요약으로만); run-level represented bytes는 metadata에서 산출하므로 history 미로드여도 표기 가능.
  - (e) take 상한(RUN_ARTIFACTS_MAX/HISTORY_MAX) 내 집계(현 그룹 최대 7 ≪ 상한).
- **Deferred → Phase 20+**: 실제 cleanup/dedupe(+backup), `@@unique`+upsert, 서버측 전체 링크 audit, cross-run/admin dashboard, zip/bundle, markdown renderer.

## 9. 구현 순서 초안 (승인·구현 단계에서만)
1. 순수 `artifactCleanupPlan.ts`(`planGroupCleanup` + `summarizeCleanupPlan`) + 테스트, package.json 등록 → `corepack pnpm test`.
2. `artifactStats.ts` + `runArtifacts.ts`: `representedHistoricalBytes` additive 부착(보유 rows로 계산) → typecheck.
3. `state/route.ts`: events 매핑에 `artifactId` 1줄 additive → typecheck.
4. `RunStream.tsx`: 이벤트 타입 optional `artifactId` + `loadedLinkedArtifactIds` 도출·prop 전달 → typecheck.
5. `RunExportsPane.tsx`: run-level cleanup summary + per-row cleanup preview(삭제 버튼 없음, §0.6 메시징) → typecheck / build.
6. 검증: typecheck / test(263+신규) / `next build`(라우트 수 불변) / `prisma migrate status`(0 added).
7. provider-free **read-only** smoke(`smoke-p19.mts`): planner 산출 vs raw 그룹핑 일치 + 링크 케이스 → 실행 → 삭제 → 잔여 0.
8. code-review(비파괴·scope·additive·용어) → 보고 후 커밋/PR(별도 승인).

> 각 단계는 surgical edit + 즉시 검증. 본 문서 작성 단계에서는 코드·스키마·`PHASE_LOG.md`·`PHASE18_PLAN.md`·브랜치를 일절 변경하지 않는다. **이번 Phase의 핵심 불변: Artifact/RunEvent를 읽기만 하고, 어떤 삭제/수정/삭제버튼도 만들지 않는다.**
