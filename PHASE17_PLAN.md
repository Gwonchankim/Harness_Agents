# Phase 17 Plan — Exports 견고성 & 열화경로 하드닝 (C1)

> 상태: **계획 검토 단계 (코드 미수정)**. 산출물은 본 `PHASE17_PLAN.md` 1개. `PHASE_LOG.md` 미수정, 브랜치 미생성, 구현 미시작.
> 방향: Phase 16(다운로드 + 히스토리) 위에 **읽기/다운로드 경로의 견고성**만 더한다. Phase 16이 남긴 latent 이슈 2건(preview 무제한 `readFile`, download `stat`↔`stream` TOCTOU)을 닫고, 조회 상한과 열화경로 로깅을 추가한다. **schema 0 / dependency 0**. lifecycle 가시성·cleanup·unique·upsert·zip·markdown은 전부 **Phase 18+ 이월**.

---

## 0. 확정 결정 (Confirmed decisions)

> 아래 결정은 사용자 승인 완료. 본 Phase 구현은 이 결정을 contract로 따른다.

1. **주제 = C1 only.** Exports 견고성 & 열화경로 하드닝. **schema migration 0 / 신규 dependency 0 / 로컬 route+lib+UI 하드닝**. lifecycle visibility / cleanup / dedupe / `@@unique` / upsert / zip / markdown 렌더러는 **이번 Phase 미포함 → Phase 18+**.
2. **preview 대용량 가드.** 전체 `readFile` 금지. `bytes`(이미 조회됨) 기반으로 판단하고, 바이트 예산(`PREVIEW_BYTE_BUDGET`)만큼만 **부분 read** 후 `MAX_PREVIEW_CHARS` char cap 적용. `truncated` + total metadata 유지.
3. **download TOCTOU 하드닝.** `open → fstat → 동일 fd stream` 방식으로 `Content-Length` 정합성 확보. stream error/abort는 **stable identifier 로그**만 남기고 응답 계약은 **opaque 유지**.
4. **lifecycle 가시성 미포함.** redundancy badge/count, dry-run cleanup, 파괴적 삭제, unique index, upsert는 전부 **Phase 18+**.
5. **logging = 신규 lib 없음.** 기존 `console.error`/`console.warn` 스타일에 **stable identifier + small context(runId / artifactId / err.code)**만 추가. **파일 내용·민감정보 로그 금지.**
6. **download 실패 UX = fetch 기반 inline row error 선호.** 404 JSON이 새 탭으로 열리지 않게 한다. 구현 복잡도가 과하면 대안을 본 문서에 비교·기록하고 구현 전 보고.

### 0.1 보강 결정 (사용자 추가 지시 — 반드시 반영)

- **(보강 1) download single-fd 수명 관리.**
  - `open → fstat → same-fd stream`은 확정.
  - **성공적으로 `Response`를 반환하는 경로에서는 `FileHandle`을 `finally`에서 닫지 않는다.** 성공 시 fd 수명은 stream의 **autoClose**에 위임한다.
  - `FileHandle` 직접 close는 **실패/throw 경로(스트림을 만들기 전 단계)에서만** 수행한다.
  - **이미 응답이 시작된 뒤** 발생한 stream error/abort는 **클라이언트 응답을 바꾸지 않고**, stable identifier로 **로그만** 남긴다.
- **(보강 2) preview partial read off-by-one 명확화.**
  - Node `createReadStream`의 `end` 옵션은 **inclusive**다.
  - 본 계획은 **truncation 감지를 위해 `PREVIEW_BYTE_BUDGET + 1` 바이트를 의도적으로 읽는다**: `start = 0`, **`end = PREVIEW_BYTE_BUDGET`** (inclusive이므로 `[0 … PREVIEW_BYTE_BUDGET]` = `PREVIEW_BYTE_BUDGET + 1` 바이트 수신).
  - **decode/preview 산출에는 앞쪽 `PREVIEW_BYTE_BUDGET` 바이트까지만** 사용한다(초과 1바이트는 "더 있음" 신호로만 사용).
  - (대안: 예산만 읽는 방식이면 `end = PREVIEW_BYTE_BUDGET - 1`. 본 계획은 truncation 정확 판정을 위해 `+1` 방식을 채택.)
  - 어느 방식이든 **전체 `readFile` 금지**.
- **(보강 3) 응답 호환성 = additive only.**
  - 기존 preview 응답 필드 **`totalChars`는 제거하지 않고 유지**한다(필드 삭제·시그니처 변경 없음).
  - `truncated === false`: 기존과 동일하게 **정확한 전체 char count**를 `totalChars`로 반환.
  - `truncated === true`: **전체 char count는 더 이상 알 수 없다**(부분 read만 수행하므로). 이때 `totalChars`는 **생략하거나, 포함하더라도 preview 범위의 best-effort 값일 뿐 전체 파일 char 수가 아님**을 명확히 한다.
  - **`totalBytes`(파일 총 바이트, 이미 조회된 `bytes`)를 권위값(authoritative)으로 추가**한다. **UI는 `totalBytes`를 우선 사용**하고, `totalChars`는 비-truncate 시의 정확 표기에만 사용한다.
  - 기존 클라이언트가 **crash하지 않도록 순수 additive 변경**(신규 필드 추가만, 기존 필드 시그니처/의미 유지).

---

## 1. 현재 코드 기준 사실 (검증됨, file:line)

### 1.1 preview 라우트 — `apps/web/app/api/runs/[runId]/artifacts/[artifactId]/route.ts`
- `MAX_PREVIEW_CHARS = 200_000` (line 16).
- 소유권 조회 `prisma.artifact.findFirst({ where:{ id, runId }, select:{ kind, path, bytes, createdAt } })` (line 34-37) — **`bytes`가 이미 select에 포함** → 파일 크기 가드에 별도 `stat` 불필요.
- **버그**: `raw = await readFile(safeJoin(workspaceRoot(), artifact.path), 'utf8')` (line 51) — **전체 파일을 메모리로 읽음**. 이후 `truncateForPreview(raw, MAX_PREVIEW_CHARS)` (line 58)로 자름. 읽기 경로엔 크기 상한 없음(쓰기 경로만 5MB) → **메모리 증폭 latent 버그**.
- 응답 계약: 정상 `{ artifact: meta, content: preview, truncated, totalChars }` (line 59), 파일 없음/unsafe `{ artifact: meta, missing: true }` (line 55, **404 아님 — 200 + missing**), params 누락 400 `params_required` (line 30), row 없음 404 `artifact_not_found` (line 39).

### 1.2 download 라우트 — `apps/web/app/api/runs/[runId]/artifacts/[artifactId]/download/route.ts`
- 소유권 조회 `select:{ path, mimeType }` (line 40).
- **버그(TOCTOU)**: `const st = await stat(absPath)` (line 50) → 이후 별도 `createReadStream(absPath)` (line 60). 두 syscall 사이 파일이 교체/절단되면 **`Content-Length`(= line 65, `st.size`)와 실제 스트림 바이트가 불일치**할 수 있음.
- 스트림 `error` 핸들러 **없음**.
- 헤더: `Content-Type`(mimeType, 공백 시 `application/octet-stream`, line 58-59), `Content-Length`(line 65), `Content-Disposition`(`attachmentContentDisposition(basename(path))`, line 66), `X-Content-Type-Options: nosniff`(line 69), `Cache-Control: no-store`(line 70).
- 파일 없음/unsafe → 404 `artifact_file_missing` (line 55), params 누락 400 (line 34), row 없음 404 (line 43).

### 1.3 DB 로더 — `apps/web/src/lib/results/runArtifacts.ts`
- `loadRunArtifacts(runId)`: `prisma.artifact.findMany({ where:{ runId }, select:{…} })` (line 24) — **`orderBy`/`take` 없음**. 결과는 `selectLatestArtifacts`로 in-memory 정렬·dedupe.
- `loadArtifactHistory(runId, kind, path)`: `prisma.artifact.findMany({ where:{ runId, kind, path }, select:{…} })` (line 63) — **`orderBy`/`take` 없음**. 결과는 `groupArtifactHistory`로 in-memory 그룹/정렬.
- 둘 다 정렬을 in-memory에 의존하므로 `take` 추가 시 **`orderBy: { createdAt: 'desc' }` 동반 필수**(최신 N 보존).

### 1.4 history 라우트 — `apps/web/app/api/runs/[runId]/artifacts/history/route.ts`
- kind/path 누락 시 400 `params_required` (line 24-26), 정상 시 `{ versions }` (line 29). `loadArtifactHistory` 위임.

### 1.5 UI — `apps/web/src/components/run/RunExportsPane.tsx`
- 다운로드 = 앵커 `<a href={`/api/runs/${runId}/artifacts/${a.id}/download`} download target="_blank" rel="noopener">` (line 219-229) → 파일 없음 시 **404 JSON이 빈 탭으로 열림**(보강 6 대상).
- `loadContent`(line 108-144) / `loadHistory`(line 160-183) — **fetch + per-row state 패턴 이미 존재** → 다운로드 fetch 핸들러에 동일 패턴 재사용.
- preview 표시: `c.truncated` 시 `c.totalChars`로 "(N chars total)" 문구 출력 (line 299-304) → 보강 3에 따라 `totalBytes` 분기 추가.

### 1.6 재사용 자산 (변경 없음)
- 순수 헬퍼 `truncateForPreview(text, maxChars)` — `apps/web/src/lib/runs/attemptView.ts:11`. 이미 메모리에 있는 문자열을 char 단위로 슬라이스(부분 read 후 char cap 단계에서 재사용 가능).
- 경로 안전 `safeJoin` / `workspaceRoot` / `isWithin` — `apps/web/src/lib/workspace/paths.ts`.
- `attachmentContentDisposition` — `apps/web/src/lib/results/contentDisposition.ts`.

### 1.7 테스트 러너 규약
- `apps/web/package.json`의 `"test": "tsx --test <파일 목록 나열>"` — **신규 `.test.ts`는 이 목록에 직접 추가**해야 실행됨(마지막 항목이 `src/lib/results/contentDisposition.test.ts`). 현재 통과 기준 **237 tests**.

---

## 2. 포함 범위 / 제외 범위

### 2.1 포함 (In scope)
- preview 라우트: 전체 `readFile` 제거 → 바이트 예산 부분 read 가드(보강 2) + additive 응답 필드(보강 3).
- download 라우트: single-fd `open → fstat → same-fd stream`(보강 1) + stream error/abort 로깅.
- 양 라우트: **EACCES vs ENOENT 구분 로깅**(응답은 기존대로 opaque).
- `runArtifacts.ts`: `loadRunArtifacts`/`loadArtifactHistory` 두 `findMany`에 `orderBy desc + take` 상한.
- UI: download 실패 inline row error(보강 6) + preview truncated 문구의 `totalBytes` 분기.
- 순수 헬퍼 추출 + 단위 테스트, provider-free smoke(`smoke-p17.mts`).

### 2.2 제외 (Out of scope → Phase 18+)
- redundancy badge/count, dry-run cleanup, 파괴적 artifact 삭제.
- `@@unique([runId, kind, path])`, 생성처 upsert 전환.
- run zip/bundle 다운로드(dependency 필요).
- markdown 렌더러(dependency + sanitizer 필요).

### 2.3 절대 미변경 (검증된 invariant)
- `prisma/schema.prisma`, 5개 artifact 생성처(`dag/executor.ts`, `results/exportReports.ts` ×2, `app/api/teams/route.ts`, `revision/approve.ts`), migrations, lockfile(`pnpm-lock.yaml`).
- Artifact **append-only** 정책, history 라우트의 외부 계약(`{ versions }`), `safeJoin`/`workspaceRoot` 동작.

---

## 3. API / lib / UI 변경 계획

### 3.1 preview 라우트 (`…/artifacts/[artifactId]/route.ts`)
- `readFile(...,'utf8')` 전체 읽기 **제거**.
- `PREVIEW_BYTE_BUDGET` 상수 도입 — `MAX_PREVIEW_CHARS` 기반의 보수적 바이트 예산(UTF-8 최악 4 byte/char를 감안하되 5MB 쓰기 상한보다 작은 메모리 바운드). 정확 값은 구현 시 확정하고 주석으로 근거 명시.
- 부분 read: `createReadStream(absPath, { start: 0, end: PREVIEW_BYTE_BUDGET })` — **`end`는 inclusive → `PREVIEW_BYTE_BUDGET + 1` 바이트 수신**(보강 2). 청크를 Buffer로 수집(메모리 바운드).
- truncation 판정:
  - 수신 바이트 길이 `> PREVIEW_BYTE_BUDGET` → 파일이 예산을 초과(byte-truncated 후보).
  - decode/슬라이스는 앞 `PREVIEW_BYTE_BUDGET` 바이트만 사용.
  - UTF-8 안전 디코드(말미 불완전 멀티바이트 시퀀스 처리) 후 `MAX_PREVIEW_CHARS`로 char cap.
  - 최종 `truncated = (byte 예산 초과) || (char cap 적용됨)`.
- 응답(보강 3, additive — 기존 필드 유지, 신규 필드만 추가):
  - `truncated === false` → `{ artifact, content, truncated:false, totalChars }`(기존과 동일, `totalChars` = 정확한 전체 char count).
  - `truncated === true` → `{ artifact, content, truncated:true, totalBytes, totalChars? }`. **`totalBytes`(= `artifact.bytes`)가 권위값이며 UI가 우선 사용**한다. `totalChars`는 **전체 char 수를 알 수 없으므로** 생략하거나, 포함하더라도 **preview 범위 best-effort 값**으로만 취급(전체 파일 char 수 아님).
- `missing`/unsafe(`safeJoin` throw, ENOENT) 경로는 **기존대로 `{ artifact: meta, missing: true }` 200 유지**(보강: EACCES/ENOENT 구분 로깅만 추가).

### 3.2 download 라우트 (`…/download/route.ts`)
- `stat` + `createReadStream(path)` 조합 제거 → `fs/promises`의 `open` 사용:
  1. `const fh = await open(absPath, 'r')`
  2. `const st = await fh.stat()`; `if (!st.isFile()) throw …`
  3. `const nodeStream = fh.createReadStream()` (autoClose 기본 true) → `Readable.toWeb(nodeStream)`
- `Content-Length = st.size` — **동일 fd의 fstat 결과**라 스트림 바이트와 정합(TOCTOU 제거).
- **fd 수명(보강 1)**:
  - **성공(Response 반환) 경로에서는 `FileHandle`을 `finally`로 닫지 않는다.** fd는 stream **autoClose**가 회수.
  - `open`/`fstat`/`isFile` 단계에서 **throw가 나면(스트림 생성 전) 그 경로에서만 `fh.close()`** 후 404 `artifact_file_missing`.
  - 스트림 생성 이후, **응답이 이미 시작된 뒤** 발생한 `error`/`abort`는 클라이언트 응답을 변경하지 않고 **stable identifier 로그만**(`nodeStream.on('error', …)`).
- 기존 헤더(nosniff / Content-Disposition / Cache-Control) 유지. 외부 계약(성공 바이트, 실패 404) 불변.

### 3.3 EACCES vs ENOENT 구분 로깅 (양 라우트)
- catch에서 `err.code` 분기:
  - `ENOENT`(흔한 누락/열화) → `console.warn`.
  - `EACCES`/기타 예기치 못한 오류 → `console.error`.
- 로그 컨텐츠 = **stable identifier + small context**(예: `[artifacts:download] file open failed` + `{ runId, artifactId, code }`). **파일 경로 전문·내용·민감정보 미포함**.
- **클라이언트 응답은 기존과 동일하게 opaque 유지**(preview `{missing:true}`/200, download 404 `artifact_file_missing`). `SafePathError`(경로 탈출 시도)도 동일 opaque + 로깅.

### 3.4 lib 조회 상한 (`runArtifacts.ts`)
- `loadRunArtifacts` `findMany`: `orderBy: { createdAt: 'desc' }, take: RUN_ARTIFACTS_MAX`(예: 500–1000) 추가. desc+take로 최신 N 보존 → `selectLatestArtifacts`의 latest-per-group 결과 불변(상한 미만일 때 동작 동일).
- `loadArtifactHistory` `findMany`: `orderBy: { createdAt: 'desc' }, take: HISTORY_MAX`(예: 200) 추가.
- 상한 값은 상수로 두고 근거 주석. 상한 초과 시 매우 오래된 버전 누락 가능성은 §7 리스크에 명시.

### 3.5 UI (`RunExportsPane.tsx`)
- 다운로드 앵커 → **버튼 + `onClick` fetch 핸들러**(보강 6):
  - `fetch(downloadUrl)` → `!res.ok`면 행에 `downloadState.error`(inline) 표시(404 JSON이 탭으로 열리지 않음).
  - `res.ok`면 `await res.blob()` → `URL.createObjectURL(blob)` → 임시 `<a download={filename}>` 클릭 → `URL.revokeObjectURL`.
  - 행별 `downloadState`(loading/error) 추가(기존 `contents`/`histories` 패턴과 동일 구조).
  - 메모리: blob 전체 적재이나 **쓰기 상한 5MB로 바운드**(문서 명시). 복잡도가 과하면 대안(현행 `<a>` 유지 / `HEAD` 선검사 후 앵커)을 비교해 구현 전 보고.
- preview truncated 문구: **`totalBytes`를 우선 사용**해 바이트 기준 표기(`truncated=true`). `totalBytes`가 없을 때만 기존 `totalChars` 문구로 폴백(보강 3) — additive 분기라 기존 클라이언트 crash 없음.

---

## 4. schema / dependency 영향: **0 / 0**
- Prisma migration **0건**(스키마 무변경). 구현 후 `prisma migrate status` = 기존 **4 migrations up-to-date** 재확인.
- 신규 npm dependency **0건**(`package.json` dependencies/devDependencies 불변; `test` 스크립트에 신규 테스트 파일만 additive로 추가 — dependency 아님).

---

## 5. 테스트 계획
- **순수 헬퍼 추출 + 단위 테스트**(prisma-free, 결정적):
  - 신규 헬퍼(예: `apps/web/src/lib/results/artifactPreview.ts`): `(buf: Buffer, hadMore: boolean, maxChars: number) → { preview, truncated }` — 예산 바이트 Buffer + "더 있음" 플래그를 받아 **UTF-8 안전 디코드 + char cap**.
  - 테스트(`artifactPreview.test.ts`): ① ASCII cap 미만(truncated=false) ② ASCII cap 초과(truncated=true) ③ **UTF-8 멀티바이트 경계 절단(말미 불완전 바이트 → 깨진 문자 없음)** ④ 빈 입력 ⑤ `hadMore=true`만으로 truncated=true ⑥ char cap·byte 초과 동시.
- **package.json `test` 스크립트에 신규 파일 등록**(미등록 시 미실행).
- 회귀: `corepack pnpm typecheck`(0 errors), `corepack pnpm test`(기존 237 + 신규 전부 pass), `corepack pnpm exec next build`(양 라우트 등록 유지).

## 6. provider-free smoke 계획 (`apps/web/smoke-p17.mts`)
- 작성 → 실행 → **삭제**(커밋 안 함). Phase 16 패턴 답습.
- 로드: **동적 `import()` + CJS 언래핑**(정적 `import { GET }`은 tsx에서 실패 — 검증된 제약). 정적 named import 금지.
- 데이터: 실제 dev.db에 **임시 Artifact row + 임시 파일** 생성, `finally`에서 row·파일 정리(잔여 0 확인).
- 검증 항목:
  - preview 소형(전체 반환, `truncated=false`, `totalChars` 정확).
  - preview 대형(부분 read, `truncated=true`, 페이로드가 `PREVIEW_BYTE_BUDGET` 바운드, `totalBytes` 정확).
  - preview 멀티바이트 파일(경계에서 깨진 문자 없음).
  - download(`Content-Length` = 실제 스트림 바이트 일치, body 일치, `nosniff` 존재).
  - download missing-on-disk → 404 `artifact_file_missing`.
  - 교차 run 소유권 → 404.
  - history `take` 상한(상한+α row 생성 시 정확히 상한 개수, 최신순).
  - history empty(200, `[]`), params 누락(400).
- 실행: `corepack pnpm exec tsx apps/web/smoke-p17.mts` → 전건 pass 후 스크립트 삭제.

## 7. 리스크 & deferred
- **리스크**
  - (a) **응답 의미 변경 최소화**: `totalChars` 유지 + `totalBytes` 추가는 additive지만 UI 문구 분기 필요(보강 3) — UI 텍스트 변경 1곳.
  - (b) **EACCES 재현 난해**(특히 Windows smoke): 코드 경로/분기 리뷰로 갈음하고 smoke는 ENOENT(missing) 중심 — 문서에 명시.
  - (c) **`take` 상한**이 매우 오래된 버전을 이론상 누락(현 dev.db 최대 그룹 7버전 < 상한, 실질 영향 없음 — 허용·문서화).
  - (d) **byte 예산 vs char cap 차이**: 멀티바이트 다수 파일은 노출 char 수가 cap보다 작을 수 있음(메모리 안전 측 — 의도된 동작).
  - (e) **fetch-blob 다운로드**는 streaming-to-disk를 잃고 메모리 적재(5MB 상한으로 수용). 복잡 시 대안 비교 후 보고(보강 6).
  - (f) **fd 누수 방지**(보강 1): 성공 경로 미close / 실패 경로만 close 규칙을 구현·리뷰에서 명시적으로 점검.
- **deferred → Phase 18+**: lifecycle 가시성·redundancy·dry-run·파괴적 cleanup·`@@unique`·upsert·zip·markdown.

## 8. 구현 순서 초안 (승인·구현 단계에서만)
1. 순수 preview 디코드 헬퍼 + 테스트 작성, **package.json `test` 등록** → `corepack pnpm test`.
2. preview 라우트 부분 read 가드 + additive 응답 필드(보강 2·3) → typecheck / build.
3. download 라우트 single-fd + fd 수명 규칙 + stream error 로깅(보강 1) → typecheck / build.
4. 양 라우트 EACCES/ENOENT 구분 로깅(응답 opaque 유지).
5. `runArtifacts.ts` 두 `findMany`에 `orderBy desc + take` 상한.
6. `RunExportsPane.tsx` fetch 기반 다운로드 실패 UX + preview `totalBytes` 문구.
7. 검증: typecheck / test(237+신규) / `next build` / `prisma migrate status`(0 added) / `smoke-p17.mts` 전건 pass / smoke 삭제 / dev.db 잔여 row·파일 0 확인.

---

## 9. 구현 후 code-review 필수 포커스 — download single-fd 수명 (보강 1)

Phase 17 구현 완료 후 code-review에서 **아래 체크리스트를 필수 포커스 영역으로 검증**한다(누락 시 fd 누수 / 응답 계약 위반 위험):

- [ ] **성공(Response 반환) 경로에서 `FileHandle`을 직접 close하지 않는다.** fd 수명은 stream `autoClose`에 위임 — `finally`에서의 close나 조기 close로 스트림이 중단되지 않는지 확인.
- [ ] **스트림 생성 전 실패/throw 경로(`open`/`fstat`/`isFile` 실패)에서는 `FileHandle`을 반드시 close**한다(fd 누수 방지). 직접 close는 **이 경로에서만** 일어나는지 확인.
- [ ] **스트림 생성 후 `error`/`abort`는 stable identifier로 로그만** 남기고, **이미 시작된 클라이언트 응답은 변경하지 않는다**(opaque 계약 유지).
- [ ] `Content-Length`가 **동일 fd의 `fstat` 결과**에서 도출되어 스트림 바이트와 정합인지(stat↔stream TOCTOU 제거 확인).
- [ ] EACCES/ENOENT 분기 로깅이 **파일 내용·경로 전문·민감정보를 남기지 않는지**, 클라이언트 응답이 기존대로 opaque(404 `artifact_file_missing`)인지.
- [ ] 이중 close / use-after-close / 미해제 fd가 없는지(성공·실패·중도취소 3경로 각각 점검).

> 위 체크리스트는 구현 PR의 code-review에서 **download 라우트 변경분을 가장 먼저 검토**하는 기준으로 사용한다.

---

> 각 단계는 surgical edit + 즉시 검증. 구현은 **별도 승인 후** 별도 단계에서 진행하며, 본 문서 작성 단계에서는 코드·스키마·`PHASE_LOG.md`·브랜치를 일절 변경하지 않는다.
