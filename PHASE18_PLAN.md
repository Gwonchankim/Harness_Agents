# Phase 18 Plan — Artifact Lifecycle Visibility (Redundancy, non-destructive)

> 상태: **계획 검토 단계 (코드 미수정)**. 산출물은 본 `PHASE18_PLAN.md` 1개. `PHASE_LOG.md` / `PHASE17_PLAN.md` 미수정, schema/migration/package 미변경, 브랜치 미생성, 구현 미시작.
> 방향: Phase 16/17이 남긴 append-only Artifact 중복(현 dev.db 약 49%)을 **비파괴적으로 "보여주기"만** 한다. 같은 `(runId, kind, path)`의 버전 수와 run-level redundancy 요약을 `RunExportsPane`에 노출한다. **삭제/dedupe/unique/upsert/cleanup planner는 일절 하지 않는다(Phase 19+).** schema 0 / dependency 0 / 신규 endpoint 0.

---

## 0. 확정 결정 (Confirmed decisions)

> 사용자 승인 완료. 본 Phase 구현은 이 결정을 contract로 따른다.

1. **주제 = 후보 a only — Artifact lifecycle visibility / redundancy dashboard.** 비파괴 visibility만. cleanup / dedupe / `@@unique` / upsert는 **Phase 19+**.
2. **노출 범위 = run-scoped only.** `RunExportsPane` 안에서 per-row `N versions / N redundant`와 run-level redundancy summary 표시. **cross-run/admin dashboard는 Phase 19+ 보류.**
3. **dry-run cleanup planner 미포함.** 삭제하지 않아도 destructive 의미를 도입하므로 **Phase 19+ 보류**. 이번 Phase는 "보여주기"까지만.
4. **신규 endpoint 0.** 기존 artifacts metadata 로더(`loadRunArtifacts`) + 기존 history endpoint + client-side 계산만 사용. 필요하면 **순수 helper**만 두고 **서버 API는 추가하지 않는다.**
5. **report.md / `exportReports` 미수정.** UI visibility만. report 통합은 Phase 19+.
6. **redundancy 정의.** 기본 = `(kind, path)` 그룹 row count: `versions = group size`, `redundant = max(0, versions − 1)`. **sha256가 있으면** "same content"(동일 sha 중복) vs "changed versions"를 보조 표시 가능 — **순수 helper로 싸게 계산될 때만** 포함하고, scope가 커지면 row count만으로 제한.

---

## 1. 현재 코드 기준 사실 (검증됨, file:line)

### 1.1 Artifact 모델 / append-only
- `prisma/schema.prisma:334-352` — Artifact: `id/runId/taskId/kind/path/mimeType/bytes/sha256(nullable)/createdAt`, 인덱스 `@@index([runId]) @@index([taskId]) @@index([kind])`. **`@@unique` 없음** → 같은 `(runId, kind, path)`에 row 누적(append-only).
- 생성부 = **4개 `prisma.artifact.create` 호출(5 kind)**: `dag/executor.ts:531`(`result_md`), `results/exportReports.ts:165`(`report_md`+`agent_report_md`), `app/api/teams/route.ts:204` & `revision/approve.ts:169`(`team_md`+`team_json`). 본 Phase는 **이 4곳을 수정하지 않는다**.
- 4개 생성부 모두 write helper에서 `sha256`/`bytes` 계산해 저장 → 실데이터 sha256 null 없음(보조 표시의 전제).
- 현 중복도(Phase 16 dev.db 스냅샷): 75 rows / 38 distinct 그룹 / 중복 그룹 11 / 그룹당 최대 7 / 약 49% redundant.

### 1.2 조회 경로 — 카운트가 이미 손안에 있음
- `src/lib/results/runArtifacts.ts:23-44` — `loadRunArtifacts(runId)`는 **그 run의 전체 Artifact row를 `findMany`(orderBy desc + take 1000)로 가져온 뒤** `selectLatestArtifacts(rows)`로 `(kind,path)`별 최신 1개로 dedupe해 metadata(`id/kind/path/bytes/createdAt`)만 반환. **즉 raw `rows`에 그룹별 전체 버전이 이미 들어 있어, 같은 함수 안에서 추가 쿼리 없이 버전 수를 계산할 수 있다.**
- `src/lib/results/artifactList.ts` — 순수 `selectLatestArtifacts(rows)`(최신 1개), `groupArtifactHistory(rows)`(`{latest, versions[]}`, 입력 미변경). 본 Phase는 이들을 변경하지 않고 재사용/참조.
- `ArtifactMeta`는 **두 곳에 각각 정의**: `runArtifacts.ts:15-21`(로더 반환 타입)과 `RunExportsPane.tsx`(컴포넌트 prop 타입). 둘은 구조만 일치하는 별개 인터페이스 → 필드 추가 시 **둘 다** 갱신 필요.

### 1.3 데이터 흐름 (신규 endpoint 불필요 근거)
- `app/api/runs/[runId]/state/route.ts:53,88` — `loadRunArtifacts(runId)` 결과를 `artifacts`로 **그대로** 응답(필드 매핑/제한 없음).
- `src/components/run/RunStream.tsx:13,57,646` — `ArtifactMeta`를 `RunExportsPane`에서 import해 `artifacts: ArtifactMeta[]` state로 보관하고 `<RunExportsPane artifacts={state.artifacts} …>`로 전달.
- 결론: **`loadRunArtifacts` 반환 metadata에 optional 필드를 추가하면** state route / RunStream / page를 **수정하지 않아도** 컴포넌트까지 흐른다(타입은 양쪽 `ArtifactMeta`에만 추가).

### 1.4 UI 현황
- `src/components/run/RunExportsPane.tsx` — Run outputs / Team files 섹션, per-row download(버튼+fetch)/copy-path/history toggle/preview, 헤더 `Exports (N)`. history toggle은 lazy로 한 `(kind,path)`의 versions를 가져옴(per-row 카운트를 **미리** 보여주려면 metadata에 버전 수가 필요 → 1.2/1.3 경로 사용). `formatBytes` 등 표시 헬퍼 존재.

---

## 2. 포함 범위 / 제외 범위

### 2.1 포함 (In scope)
- 순수 helper `artifactStats.ts`(+test): 그룹별 버전 수/redundant(+선택적 sha256 same-content 분해), run-level 요약.
- `loadRunArtifacts`가 **이미 조회한 rows**로부터 per-latest `versions`(+선택적 `sameContentDup`)를 계산해 metadata에 additive로 부착(추가 쿼리/endpoint 없음).
- `RunExportsPane`: per-row `N versions` / `N redundant (metadata only)` 표시 + run-level redundancy summary(예: 헤더/섹션 상단 한 줄).
- 순수 helper 단위 테스트, provider-free smoke.

### 2.2 제외 (Out of scope → Phase 19+)
- cleanup / dedupe / 파괴적 삭제 / `@@unique([runId,kind,path])` / 생성부 upsert 전환.
- dry-run cleanup planner(무엇이 지워질지 미리보기).
- cross-run / admin artifact dashboard.
- `report.md` / `exportReports` 통합.
- zip/bundle 다운로드, markdown renderer, stream observability.
- 신규 서버 endpoint.

### 2.3 절대 미변경 (invariant)
- `prisma/schema.prisma`, migrations, lockfile, 4개 artifact 생성부, `PHASE_LOG.md`, `PHASE17_PLAN.md`.
- `selectLatestArtifacts` / `groupArtifactHistory`(읽기 전용 재사용), history route, download/preview route, state route, RunStream/page(데이터 흐름 그대로).

---

## 3. lib / UI 변경 계획

### 3.1 신규 순수 helper — `src/lib/results/artifactStats.ts`
- prisma-free, I/O 없음. 두 함수:
  - `countVersionsByGroup(rows)` — `(kind,path)`로 그룹핑해 `Map<key, { versions: number; sameContentDup?: number }>` 반환. `versions = group size`; `sameContentDup`(선택) = 같은 sha256가 2개 이상인 경우의 중복 수(내용 동일 여부 구분; sha256 null이면 미계산). 입력 미변경.
  - `summarizeRedundancy(metas)` — 버전 수가 부착된 metadata 배열을 받아 run-level 요약 `{ groups, totalVersions, redundant, redundancyPct, byKind: { [kind]: { groups, versions, redundant } } }` 반환. `redundant = Σ max(0, versions−1)`.
- 키는 `kind` + 구분자 + `path`로 구성.

### 3.2 `src/lib/results/runArtifacts.ts`
- `ArtifactMeta`(15-21)에 additive 필드 추가: `versions: number`(그룹 버전 수), 선택적 `sameContentDup?: number`.
- `loadRunArtifacts`(23-44): **이미 가진 `rows`**에 `countVersionsByGroup` 적용 → `selectLatestArtifacts` 결과 각 항목에 `versions`(+`sameContentDup`) 부착해 반환. **신규 쿼리/endpoint 없음.** `loadArtifactHistory`는 변경하지 않음.
- 비고: 버전 수는 `take: RUN_ARTIFACTS_MAX(1000)` 상한 안에서 계산(현 그룹 최대 7 ≪ 1000; 상한 초과 시 과소집계 가능 — §8 리스크에 명시).

### 3.3 `src/components/run/RunExportsPane.tsx`
- 로컬 `ArtifactMeta`에 optional `versions?: number`(+ `sameContentDup?: number`) 추가(additive, 구 데이터엔 없을 수 있으므로 옵셔널).
- **per-row 표시**: 각 행에 `versions > 1`일 때 `N versions · N redundant (metadata only)` 라벨(기존 history toggle은 유지; 이 라벨은 toggle 없이도 보임). sha 보조표시가 있으면 `(M same content)` 정도로 덧붙임.
- **run-level summary**: 섹션 상단 또는 `Exports (N)` 헤더 옆에 `summarizeRedundancy(artifacts)` 결과 한 줄(예: `38 files · 75 versions · 37 redundant (49%)`). 순수 계산, 클라이언트에서 1회.
- preview/history/copy-path/download 동작 무변경.

### 3.4 `apps/web/package.json`
- `test` 스크립트에 `src/lib/results/artifactStats.test.ts`만 additive 등록. **dependencies/devDependencies 불변.**

---

## 4. schema / dependency 영향: **0 / 0**
- Prisma migration 0(스키마 무변경) — 구현 후 `prisma migrate status` 4 migrations up-to-date 재확인.
- 신규 dependency 0(package.json은 test 스크립트만). 신규 서버 endpoint 0(라우트 수 불변).

## 5. 테스트 계획
- `artifactStats.test.ts`(prisma-free, 결정적):
  - `countVersionsByGroup`: 빈 입력; 단일 버전 그룹(`versions=1`); 다버전 그룹(`versions=k`); 복수 그룹 혼합; sha256 동일 2개 → `sameContentDup`; sha256 null → 보조값 미산출.
  - `summarizeRedundancy`: 전부 단일(`redundant=0, %=0`); 일부 중복(`redundant=Σ(versions−1)`, `redundancyPct` 반올림 규칙); `byKind` 집계; 빈 입력(0/0, 0%).
- package.json test 등록 후 회귀: `corepack pnpm typecheck`(0), `corepack pnpm test`(기존 247 + 신규 전부 pass), `corepack pnpm exec next build`(라우트 수 불변).

## 6. provider-free smoke 계획 (`apps/web/smoke-p18.mts`)
- 작성 → 실행 → 삭제(미커밋). Phase 16/17 패턴(동적 import + CJS 언래핑, 정적 named import 금지).
- 실제 dev.db에 임시 Run 참조로 임시 Artifact row 생성: 한 `(kind,path)`에 3버전(sha 2개 동일 + 1개 상이), 다른 그룹은 단일 버전 → `finally`에서 row 정리(파일은 불필요/생성 시 정리), 잔여 0 확인.
- 검증: `loadRunArtifacts(runId)`가 해당 그룹에 `versions=3`(+`sameContentDup` 보조값), 단일 그룹 `versions=1`; `summarizeRedundancy`가 `redundant`/`redundancyPct`를 정확히 산출; 기존 latest-선택/다운로드/미리보기 무회귀(스폿 체크).
- `corepack pnpm exec tsx apps/web/smoke-p18.mts` 실행 → 전건 pass 후 스크립트 삭제.

## 7. (구현 후) code-review 포커스
- scope: 변경이 §2.1 4개 파일(+신규 helper/test)에 한정되고 schema/migration/lockfile/생성부/`PHASE_LOG`/`PHASE17_PLAN` 무변경인지.
- 비파괴 확인: 어떤 경로도 Artifact row를 **삭제/수정**하지 않고 **read-only**인지(이번 Phase의 핵심 불변).
- additive 타입: 두 `ArtifactMeta`에 옵셔널 필드만 추가, 구 클라이언트/구 데이터에서 crash 없음.

## 8. 리스크 & Deferred
- **리스크**
  - (a) `ArtifactMeta`가 lib/컴포넌트 2곳 정의 → 두 곳 동기화(옵셔널 additive로 회귀 방지).
  - (b) 버전 수는 `RUN_ARTIFACTS_MAX(1000)` 상한 내 집계 — 그룹이 1000 초과 시 과소집계(현 최대 7, 실질 영향 없음; 문서화).
  - (c) sha256 보조 표시는 **순수·저비용일 때만** 포함; scope 커지면 row count만으로 제한(Q6).
  - (d) 표시 추가가 기존 RunExportsPane 레이아웃을 흩뜨리지 않도록 최소 마크업(기존 라벨 스타일 재사용).
- **Deferred → Phase 19+**: cleanup/dedupe/`@@unique`/upsert(사전 backup + RunEvent 링크 audit + dedup-후-migration; history와 충돌 명시), dry-run cleanup planner, cross-run/admin dashboard, report.md 통합, zip/bundle, markdown renderer, stream observability.

## 9. 구현 순서 초안 (승인·구현 단계에서만)
1. 순수 `artifactStats.ts`(`countVersionsByGroup` + `summarizeRedundancy`) + 테스트 작성, **package.json test 등록** → `corepack pnpm test`.
2. `runArtifacts.ts`: `ArtifactMeta`에 `versions`(+선택 `sameContentDup`) 추가, `loadRunArtifacts`가 보유 rows로 부착 → typecheck.
3. `RunExportsPane.tsx`: 옵셔널 필드 + per-row 버전/redundant 라벨 + run-level summary → typecheck / build.
4. 검증: typecheck / test(247+신규) / `next build`(라우트 수 불변) / `prisma migrate status`(0 added).
5. provider-free smoke(`smoke-p18.mts`): loadRunArtifacts 그룹 카운트/summary 정확성 + 무회귀 → 실행 → 삭제 → dev.db 잔여 0 확인.
6. code-review(비파괴/scope) → 보고 후 커밋/PR(별도 승인).

> 각 단계는 surgical edit + 즉시 검증. 본 문서 작성 단계에서는 코드·스키마·`PHASE_LOG.md`·`PHASE17_PLAN.md`·브랜치를 일절 변경하지 않는다. **이번 Phase의 핵심 불변: Artifact row를 읽기만 하고 삭제/수정하지 않는다.**
