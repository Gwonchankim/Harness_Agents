# Phase 16 Plan — Artifact Download UX & Artifact History Visibility

> 상태: **계획 검토 단계 (코드 미수정)**. 산출물은 본 `PHASE16_PLAN.md`. `PHASE_LOG.md` 미수정.
> 추천 방향: Phase 15(RunExportsPane + lazy preview) 위에 **(A) 다운로드 UX** + **(B) artifact history 가시성**을 얹는다. **schema 0 / dependency 0**를 기본안으로, 다운로드 endpoint 1개만 추가 허용. **DB cleanup / upsert / unique index**와 **markdown renderer**는 위험·비용이 커서 본 Phase에서는 **비교·문서화만** 하고 적용은 보류(결정 질문).

---

## 0. 확정 결정 (Confirmed decisions)

> 아래 5개 결정은 사용자 승인 완료. 본 Phase 구현은 이 결정을 contract로 따른다. (근거는 3·4·5·6·11절 참조.)

1. **Artifact 정책 = append-only 유지.** cleanup / dedupe 삭제 / `(runId,kind,path)` unique index / 생성처 upsert 전환을 **모두 하지 않음**. **schema migration 0** 유지. 중복 row는 "생성 이력"으로 표시 계층에서 다룸. unique/upsert/cleanup은 **Phase 17+ 보류**.
2. **Markdown renderer 미도입.** `react-markdown`/`rehype-sanitize` 등 **신규 dependency 0**. preview는 현행 `<pre>` plain text(= markdown source) 유지. **JSON artifact(team_json)도 동일하게 plain text preview**.
3. **Download = 별도 라우트 + 스트리밍 + 실제 파일명.** `GET /api/runs/[runId]/artifacts/[artifactId]/download`, `fs.createReadStream`으로 스트리밍(5MB+ 메모리 안전), 다운로드 파일명은 **디스크 실제 파일명**(`result.md`/`report.md`/`{agentId}.md`/`team.json` 등) 유지(친화명 매핑 안 함). `Content-Type = artifact.mimeType`(json 분기, 누락 시 `application/octet-stream`), `Content-Disposition: attachment` + RFC5987 안전 처리(헤더 인젝션 방지), 파일 없음/안전치 못한 경로 → **404 `artifact_file_missing`**.
4. **History 가시성 = metadata-only lazy.** `(kind,path)`별 artifact **history 토글** 추가. 표시 필드: `createdAt`, `bytes`, `sha256`(있으면), `id`, **latest 여부**. **content 전문 fetch 안 함**(metadata만). history용 **lazy metadata endpoint 추가 허용**. 같은 path 덮어쓰기로 **과거 콘텐츠 복원 불가**임을 UI에 명시(과거 버전 preview/download는 최신 디스크 파일과 동일).
5. **Team files 섹션 분리.** RunExportsPane에서 **Run outputs**(`result_md`/`report_md`/`agent_report_md`)와 **Team files**(`team_md`/`team_json`)를 **별도 섹션**으로 분리 표시.

→ 종합: **schema 0 / dependency 0 / route +2**(download, history metadata). 아래 본문의 "기본안"이 본 확정 결정과 일치(결정 질문 1·2=권장안 채택, 3·4=스트리밍+실제 파일명, 5=history 포함+team 별도 섹션, 6=route +2).

---

## 1. 현재 코드 기준 사실 정리 (검증됨)

### 1.1 Artifact 모델 (`prisma/schema.prisma:334-352`)

```prisma
model Artifact {
  id        String   @id @default(cuid())
  runId     String
  taskId    String?
  kind      String
  path      String
  mimeType  String   @default("text/markdown")
  bytes     Int      @default(0)
  sha256    String?
  createdAt DateTime @default(now())
  run    Run        @relation(fields: [runId], references: [id], onDelete: Cascade)
  task   Task?      @relation(fields: [taskId], references: [id])
  events RunEvent[]
  @@index([runId]) @@index([taskId]) @@index([kind])
}
```

- **unique 제약 없음** → 같은 `(runId, kind, path)`에 row 다수 가능(append-only).
- `mimeType` 기본값 `text/markdown`, `bytes`/`sha256` 보유.
- `events RunEvent[]` 역관계 존재 → **Artifact를 지우면 그 artifact를 참조하는 RunEvent.artifactId가 영향**(아래 1.5 cleanup 영향 참조).

### 1.2 생성처 5곳 (전부 `prisma.artifact.create` = append)

| kind | 생성 위치 | path 패턴 | mimeType |
| --- | --- | --- | --- |
| `result_md` | `dag/executor.ts:531` (`exportFinalResult`) + `result.created` 이벤트에 `artifactId` 연결 | `{slug}/runs/{runId}/result.md` | text/markdown |
| `report_md` | `results/exportReports.ts:113` (`writeArtifact`) | `{slug}/runs/{runId}/report.md` | text/markdown |
| `agent_report_md` | `results/exportReports.ts:148` (`writeArtifact`) | `{slug}/runs/{runId}/agent-reports/{agentId}.md` | text/markdown |
| `team_md` | `app/api/teams/route.ts:204`, `revision/approve.ts:169` (`exportTeamFiles`) | `{slug}/teams/{teamId}/AGENTS.md` (대략) | text/markdown |
| `team_json` | 동상 | `{slug}/teams/{teamId}/team.json` | **application/json** |

- 모든 writer는 **best-effort**(try/catch + `console.error`); DB가 canonical, 파일은 export/cache.
- `result_md`만 `result.created` RunEvent에 `artifactId`로 연결됨. 나머지(report/agent/team)는 RunEvent 연결 없음.

### 1.3 디스크 쓰기 헬퍼

- `lib/workspace/writeWorkspaceFile.ts` — report/agent/team이 사용. `MAX_WORKSPACE_FILE_BYTES = 5 * 1024 * 1024`(5MB) 상한, tmp→rename atomic, `path`는 forward-slash 상대경로 반환, `sha256` 계산.
- `lib/results/finalResult.ts:103` — result.md 전용 사본(동일 패턴, `MAX_RESULT_BYTES = 5MB`).
- 즉 **쓰기 시점 상한은 5MB**(writer 경유분에 한함). 읽기 경로엔 상한 없음(아래 1.4).

### 1.4 Phase 15 조회/표시 경로

- `lib/results/artifactList.ts` — 순수 `selectLatestArtifacts(rows)`: `(kind,path)`별 최신 1개(`createdAt` lexicographic desc, 동률 시 `id` 비교), 표시 정렬(result→report→agent→기타, then path). **kind 필터 없음**.
- `lib/results/runArtifacts.ts` — `loadRunArtifacts(runId)`: 전체 row 조회 → 위 helper로 dedupe → **metadata만**(`id,kind,path,bytes,createdAt`) 반환. content/sha256/taskId 미노출.
- `app/api/runs/[runId]/artifacts/[artifactId]/route.ts` (preview endpoint):
  - ownership: `findFirst({ where: { id: artifactId, runId } })`.
  - `safeJoin(workspaceRoot(), artifact.path)` 읽기, `readFile(..., 'utf8')`.
  - `MAX_PREVIEW_CHARS = 200_000` cap(`truncateForPreview`) → `{ content, truncated, totalChars }`.
  - 파일 없음/안전치 못한 경로 → catch → `{ missing: true }` (HTTP 200).
  - **주의**: 전체 파일을 메모리로 읽은 뒤 잘라냄(읽기 자체엔 size guard 없음; 단 writer 경유분은 ≤5MB).
- state/page는 `loadRunArtifacts`로 **metadata만** 전달. content는 lazy endpoint로만.

### 1.5 UI/UX 현황 (`components/run/RunExportsPane.tsx`)

- collapsible "Exports (N)", row = `[kind 라벨][파일명][bytes][시각] … [copy path][view]`, 펼치면 lazy preview `<pre>`(plain text), truncation 안내, missing 안내.
- agent-reports는 `{agentId}.md` → `agents` prop으로 **이름 매핑**(실패 시 filename fallback).
- **다운로드 버튼 없음**, **markdown 렌더링 없음**(plain `<pre>`), **history(중복/이전 버전) 가시성 없음**(latest만).
- `KIND_LABELS`는 result/report/agent만 매핑 → **team_md/team_json은 raw kind 라벨로 그대로 노출됨**(패널이 doc 3종으로 필터되어 있지 않음).

### 1.6 dev.db 실측 (현황 근거)

- 총 75 rows → **38 distinct `(runId,kind,path)` groups**, **11 groups 중복**, **최대 7중복**, **redundant rows 37(~49%)**.
- kind 분포: `team_md` 12, `team_json` 12, `result_md` 12, `report_md` 12, `agent_report_md` 27.
- mimeType: `text/markdown` 63, `application/json` 12(=team_json).
- 시사점: (a) 중복 누적이 실재(절반)함 → cleanup의 동기는 있음. (b) 패널에 team_*가 섞여 표시됨. (c) json artifact는 markdown 아님 → download content-type 분기 필요, markdown 렌더 대상에서 제외돼야 함.

### 1.7 의존성/엔진

- `apps/web/package.json` deps: `@ai-sdk/*`, `@prisma/client`, `ai`, `next`, `react`, `react-dom`, `zod`. **markdown 라이브러리·sanitizer 없음**.
- `next.config.ts`: `reactStrictMode: true`(개발 시 effect/updater 2회 호출).
- 마이그레이션 4개, drift 0.

---

## 2. 포함 범위 / 제외 범위

### 2.1 In Scope (기본안 = 추천)

1. **다운로드 UX** — exported artifact 원본 파일을 브라우저로 내려받기. RunExportsPane 각 row에 "Download" 추가.
2. **Artifact history 가시성** — latest만이 아니라 `(kind,path)`별 **이전 export 버전 목록**(createdAt/bytes/sha256, read-only)을 보여주는 펼침 영역. metadata-only.
3. **team_* 표시 정리(소)** — 패널에서 team_md/team_json을 (a)그대로 두되 라벨/그룹만 정리하거나 (b)별도 섹션/필터. (결정 질문 5)

### 2.2 Out of Scope (Phase 17+ 후보, 본 Phase는 비교/문서화만)

- **DB cleanup job / `(runId,kind,path)` upsert / unique index** — 비교·리스크 분석만(3절). 실제 적용은 결정 질문 1에서 승인 시에만.
- **Markdown renderer** — dependency + HTML sanitization 리스크. 기본 plain text 유지(5절). 적용은 결정 질문 2에서 승인 시에만.
- **Artifact 삭제/보존정책(retention) UI**, 다중 run artifact 전역 audit 대시보드, zip 일괄 다운로드, 외부 스토리지(S3 등) 이전.
- 기존 `result.md`/`FinalResultPane`/`finalResult.ts`/executor export 로직 변경.

---

## 3. Artifact cleanup 정책 비교 (적용은 보류, 비교만)

| 옵션 | 내용 | schema/migration | 기존 데이터 영향 | 리스크 | 권장 |
| --- | --- | --- | --- | --- | --- |
| **A. append 유지 + UI latest만 (현행)** | 그대로. 표시·다운로드·history 모두 표시 계층에서 처리 | **0** | 없음 | 없음(누적은 계속 쌓임) | ✅ 기본안 |
| **B. DB cleanup job** | 주기/수동으로 `(runId,kind,path)`별 최신만 남기고 과거 row 삭제 | 0 (스크립트) | **파괴적**: 37 redundant rows 삭제. Artifact를 참조하는 RunEvent(현재 `result_md`만 `result.created`에 연결)와의 정합성 점검 필요 | 중(되돌릴 수 없음, history도 사라짐 — 2번 가시성과 상충) | 보류 |
| **C. `(runId,kind,path)` unique + upsert** | 5개 생성처를 upsert로 바꾸고 unique index 추가 | **migration 필요** | unique index 생성은 **기존 중복 존재 시 실패** → 사전 dedupe(=B) 선행 필수. 생성처 5곳 동시 수정 | 중~상(생성 경로 광범위 수정 + 마이그레이션 운영) | 보류 |
| **D. B+C 결합** | dedupe 후 unique+upsert로 재발 방지 | migration 필요 | B의 파괴성 + C의 표면적 | 상 | 보류 |

**결론**: 본 Phase 목표(다운로드/가시성)는 **A(현행 append + 표시계층)**로 100% 달성 가능. cleanup은 history 가시성과 **상충**(과거 row를 지우면 history가 사라짐)하고 RunEvent 정합성·마이그레이션 리스크가 있어 **본 Phase 적용 안 함**. 필요성이 충분(스토리지 압박 등)해질 때 별도 Phase에서 B 또는 C를 데이터 백업 후 적용 권장. (결정 질문 1에서 재확인.)

### 3.1 unique index가 필요해질 경우의 사전조건(문서화)

1. 백업(dev.db / 운영 DB) 후 dedupe 스크립트로 `(runId,kind,path)`별 최신만 남김(37 rows 삭제 예상).
2. 삭제 대상이 RunEvent.artifactId로 참조되는지 확인(현재 `result_md`만 연결; 최신 result_md를 남기되 `result.created`가 가리키는 id가 남는 row인지 검증).
3. `@@unique([runId, kind, path])` 추가 마이그레이션 → 생성처 5곳을 `upsert`로 전환.
4. Windows 개발환경 `prisma generate` EPERM 회피 위해 dev server 중지 후 마이그레이션.

---

## 4. Download UX 설계

### 4.1 필요성
- 현재는 preview(앞 200k자, plain text)만 가능 + "copy path"로 디스크 경로 안내. 전체 파일을 손에 넣으려면 OS 파일 탐색이 필요 → **브라우저 다운로드가 실질적 가치**.

### 4.2 endpoint 설계: 기존 preview 확장 vs 별도 endpoint

| 안 | 형태 | 장점 | 단점 |
| --- | --- | --- | --- |
| **4.2-a 별도 라우트(권장)** | `GET /api/runs/[runId]/artifacts/[artifactId]/download` → 원본 바이트 + 헤더 | 응답 계약 분리(JSON preview vs binary download)가 깔끔, 캐시/헤더 제어 명확 | 라우트 +1 |
| 4.2-b 기존 라우트 + `?download=1` | 같은 핸들러에서 분기 | 라우트 0 추가 | 한 핸들러가 JSON/바이너리 2계약 — 가독성·테스트 복잡 |

**권장**: 4.2-a(별도 라우트). 라우트 +1(허용 범위, Phase 15에서도 +1 한 전례).

### 4.3 응답 처리
- ownership 동일(`findFirst id+runId`), `safeJoin(workspaceRoot(), path)`로 검증.
- **Content-Type**: `artifact.mimeType` 사용(team_json=application/json, 나머지 text/markdown). 누락 시 `application/octet-stream` fallback.
- **Content-Disposition**: `attachment; filename="..."`. filename은 `basename(path)`를 **ASCII sanitize** + `filename*`(RFC 5987 UTF-8)로 비ASCII(에이전트 이름 등) 안전 처리. agent-report는 path가 `{agentId}.md`라 download 파일명은 `{agentId}.md`가 자연스러움(또는 agent 이름 매핑은 표시용에 한정, 다운로드는 실제 파일명 유지 — 결정 질문 3).
- **스트리밍 & 크기**: 가능하면 `fs.createReadStream` → `Response`(Web stream)로 스트리밍해 5MB+ 대형 파일에서도 메모리 적재 최소화. (대안: `readFile` 후 반환 — 단순하나 메모리. Phase 15 preview의 read 패턴과 동일한 한계.) — 결정 질문 4.
- **missing/stale**: 파일 없음/안전치 못한 경로 → **404 `artifact_file_missing`**(다운로드는 JSON `{missing:true}` 대신 명확한 404가 적절). stale(파일이 DB bytes와 다름)은 그대로 현재 디스크 파일을 내려줌(파일이 source of cache이므로). sha256 불일치 검출은 선택(과한 비용 — 제외).
- **Content-Length**: 스트리밍 시 디스크 `stat().size`로 설정(권장), 아니면 생략.

### 4.4 UI
- RunExportsPane row의 액션에 **"Download"** 추가(`<a href={downloadUrl} download>` 또는 버튼). preview/copy path와 공존.
- team_json 등 비-markdown도 동일하게 다운로드 가능(content-type만 분기).

---

## 5. Markdown preview 설계

### 5.1 옵션 비교

| 옵션 | 내용 | dependency | 보안 | 권장 |
| --- | --- | --- | --- | --- |
| **A. plain text 유지 (현행)** | `<pre>` 그대로 | 0 | 안전(텍스트만, HTML 렌더 없음) | ✅ 기본안 |
| B. 직접 미니 렌더러 | heading/bold/list/code만 정규식 변환 | 0 | **`dangerouslySetInnerHTML` 쓰면 XSS 위험**; 안 쓰고 React 엘리먼트로 변환하면 복잡·불완전 | 보류 |
| C. 라이브러리(react-markdown 등) | 표준 렌더 | **+N deps** (react-markdown + remark + rehype-sanitize 등) | sanitization 필수(rehype-sanitize), 번들 증가 | 보류 |

### 5.2 결론
- **기본안: plain text 유지(dependency 0).** artifact 내용은 신뢰경계 밖 텍스트(agent 출력 포함)이므로, HTML로 렌더하면 sanitization을 반드시 동반해야 함. 비용·리스크 대비 가치가 낮아 본 Phase에서는 **도입하지 않음**.
- 만약 도입한다면(결정 질문 2 승인 시): **C + rehype-sanitize**를 권장(직접 구현 B는 sanitization 누락 위험이 더 큼). team_json은 렌더 대상에서 제외(코드블록/plain).

---

## 6. Deeper artifact audit UI (history 가시성)

### 6.1 목표
- append-only로 쌓인 **이전 export 버전**을 read-only로 보이게 해 "언제/몇 번/얼마 크기로 재생성됐는지" 확인 가능하게.

### 6.2 데이터 소스
- 현재 `loadRunArtifacts`는 **latest만** 반환 → history엔 부족. 두 가지 방법:
  - **6.2-a (권장)** 신규 lazy 목록 endpoint `GET /api/runs/[runId]/artifacts?kind=&path=`(또는 history 전용)로 특정 `(kind,path)`의 **전체 row metadata**(id, createdAt, bytes, sha256) 반환. 펼칠 때만 호출(metadata-only 유지).
  - 6.2-b 초기 state에 전체 history metadata 동봉 — payload 증가(중복 다수 run에서 비효율). 비권장.
- 순수 헬퍼 추가: `groupArtifactHistory(rows)` → `(kind,path)`별 `{ latest, versions: [...desc] }`(테스트 가능, prisma-free). `selectLatestArtifacts`와 한 모듈에 공존 가능.

### 6.3 UI
- RunExportsPane row에 "history (k)" 토글 → 펼치면 버전 목록(createdAt, bytes, sha256 short, 각 버전 preview/download 링크). 기본 접힘.
- **주의**: 과거 버전의 **파일은 디스크에 없을 수 있음**(writer가 같은 path로 덮어씀 → 과거 버전 파일은 사실상 미존재, 최신만 디스크에 있음). 따라서 history의 과거 row는 **metadata만 의미 있음**(preview/download는 최신 path와 동일 파일을 가리키므로 과거 "내용"은 복원 불가). → history는 **"생성 이력(언제/크기/sha)"** 표시에 한정하고, 과거 버전 preview/download는 **현재 디스크 파일과 동일**함을 UI에 명확히 표기하거나 비활성화. (결정 질문 5)
- 이 한계는 cleanup(3절)과도 연결: 과거 row는 "감사 로그"일 뿐 콘텐츠 복원 불가.

---

## 7. schema / dependency 변경 여부

| 항목 | 기본안 | 비고 |
| --- | --- | --- |
| schema migration | **0** | cleanup/unique index 미적용(3절). history는 기존 row 재조회로 충족. |
| dependency | **0** | markdown 라이브러리 미도입(5절). |
| 신규 route | **+1~+2** | download 라우트(4.2-a), history 목록 라우트(6.2-a). 둘 다 read-only·metadata 또는 파일 스트림. |

→ **기본 제안: schema 0 / dependency 0 / route +1(download) [+1 optional(history)]**. unique index·markdown lib는 결정 질문에서 승인 시에만.

---

## 8. API / lib / UI 변경 계획 (기본안)

### lib (신규/소폭)
- `lib/results/artifactList.ts` — `groupArtifactHistory(rows)` 순수 헬퍼 추가(+테스트). 기존 `selectLatestArtifacts` 무변경.
- `lib/results/runArtifacts.ts` — history endpoint용 로더(`loadArtifactHistory(runId, kind, path)` 또는 `loadRunArtifactHistory(runId)`) 추가. metadata-only.
- 다운로드용 안전 파일 접근은 기존 `safeJoin`/`workspaceRoot` 재사용. filename sanitize 순수 헬퍼(`contentDisposition` 빌더) 분리(+테스트).

### API (신규 read-only)
- `app/api/runs/[runId]/artifacts/[artifactId]/download/route.ts` — ownership + safeJoin + mimeType 헤더 + Content-Disposition + (스트리밍) 파일 반환; missing → 404.
- (optional) `app/api/runs/[runId]/artifacts/route.ts` 또는 `.../[artifactId]/history` — `(kind,path)` history metadata 목록.

### UI
- `components/run/RunExportsPane.tsx` — row 액션에 **Download**(`<a download>`), **history 토글**(lazy fetch). preview/copy-path 유지. team_* 라벨/필터 처리(결정 질문 5).
- 기존 preview endpoint·state API·page·FinalResultPane·finalResult·executor·schema **무변경**.

> 생성 경로(executor/exportReports/teams/approve)는 **불변**(append 유지). Phase 16은 **조회/표시/다운로드** 가산만.

---

## 9. 테스트 계획 (레포 관례: 순수 함수 단위 + DB/provider는 수동 smoke)

- **신규 순수 테스트**
  - `artifactList.test.ts`에 `groupArtifactHistory` 케이스 추가: 단일/다중 버전, 정렬(desc), `(kind,path)` 분리, 빈 입력.
  - `contentDisposition`(파일명 sanitize/RFC5987) 단위 테스트: ASCII/비ASCII/따옴표·개행 제거/확장자 유지.
- 기존 `artifactList.test.ts`(selectLatestArtifacts) 회귀.
- 전체 `corepack pnpm --filter web typecheck` + `test`(현재 218 + 신규 케이스) + `next build`(route +1~+2 확인) + `prisma migrate status`(**4 migrations, 0 added**, drift 0).
- 다운로드 라우트는 핸들러 직접 호출 smoke로 검증(9·10 참조). 라우트 핸들러는 단위 테스트 목록에 포함하지 않는 기존 관례 유지.

## 10. 수동 smoke 시나리오 (provider-free, tsx, 종료 후 스크립트 삭제)

> 디스크 경로: `projects/{slug}/runs/{runId}/result.md|report.md|agent-reports/*.md`, `projects/{slug}/teams/{teamId}/AGENTS.md|team.json`. dev.db에 실제 artifact 존재.

1. **download 성공(markdown)**: 실제 result_md/report_md/agent_report_md artifact → download 핸들러 호출 → 200, `Content-Type: text/markdown`, `Content-Disposition: attachment; filename="..."`, body가 디스크 파일과 동일(sha256 일치).
2. **download 성공(json)**: team_json artifact → `Content-Type: application/json` 분기 확인.
3. **download 404**: 알 수 없는 artifactId → 404; **cross-run** id(다른 run의 artifact + 이 runId) → 404(ownership).
4. **download missing-on-disk**: DB row 있으나 파일 없는 artifact → 404 `artifact_file_missing`(graceful, no 500).
5. **filename sanitize**: 비ASCII/특수문자 path에 대해 `Content-Disposition`이 안전(헤더 인젝션·개행 없음, `filename*` 포함).
6. **history 가시성**: 중복이 있는 `(runId,kind,path)`(dev.db에 11개 그룹) → history 목록이 전체 버전 metadata를 createdAt desc로 반환, latest 일치; 과거 버전은 "현재 디스크 파일과 동일" 한계 표기/비활성 동작 확인.
7. **대형 파일(스트리밍 채택 시)**: 250k+ 임시 파일+임시 row → download가 전량 반환(메모리 과적재 없이), 종료 후 row/파일 정리.
8. **team_* 표시**: 패널에 team_md/team_json이 의도대로(필터/별도 섹션/그대로) 표시되는지 확인(결정 5 결과 반영).

## 11. 리스크와 결정 질문

### 리스크
- **R1 다운로드 메모리**: `readFile` 단순 반환은 5MB+에서 메모리 적재. 스트리밍 채택 시 해소(구현 난이도 소폭↑). (결정 4)
- **R2 history 콘텐츠 오해**: 과거 버전 파일은 디스크에 없음(덮어씀) → "과거 내용"을 볼 수 있다고 오해 소지. UI 문구/비활성으로 방지. (결정 5)
- **R3 헤더 인젝션**: `Content-Disposition` filename에 개행/따옴표 유입 시 위험 → sanitize 필수(테스트).
- **R4 cleanup 유혹**: 49% 중복이 보이면 cleanup을 하고 싶지만, history 가시성·RunEvent 정합성·마이그레이션과 충돌. 본 Phase는 비적용 권장. (결정 1)
- **R5 team_* 혼입**: 패널이 doc 3종으로 필터돼 있지 않아 team_md/team_json도 노출 중. download/렌더에서 json 분기 필요. (결정 5)

### 결정 질문
1. **Cleanup 범위**: 본 Phase는 **append 유지(현행, 적용 안 함)**로 가고 cleanup/unique/upsert는 별도 Phase로 보류(권장)? 아니면 본 Phase에서 dedupe+unique index까지 진행(migration 허용)?
2. **Markdown 렌더링**: **plain text 유지(dependency 0, 권장)**? 아니면 `react-markdown + rehype-sanitize` 도입(dependency 허용)?
3. **다운로드 파일명**: 실제 디스크 파일명(`{agentId}.md` 등) 유지(권장, 단순/안정)? 아니면 표시용 agent 이름 기반 친화적 파일명(`{agentName}.md`)으로 매핑?
4. **다운로드 구현**: `fs.createReadStream` 스트리밍(권장, 대형 안전)? 아니면 `readFile` 단순 반환(간단, 5MB 한계)?
5. **history & team_***: (a) history 토글을 이번에 포함? (b) 패널에서 team_md/team_json을 그대로 둘지 / 별도 "Team files" 섹션으로 분리할지 / 숨길지?
6. **route 개수**: download 라우트(+1)만? history 목록 라우트(+1)도 함께(총 +2)?

---

## 검증(Verification) 요약 (기본안 기준 예정값)

```
corepack pnpm --filter web typecheck                  # 0 errors
corepack pnpm --filter web test                       # 218 + 신규 순수 케이스
corepack pnpm --filter web exec next build            # PASS, route +1(download)[+1 history]
corepack pnpm --filter web exec prisma migrate status # 4 migrations, 0 added, drift 0 (기본안)
```
+ 위 수동 smoke 1·3·4(다운로드 성공/404/missing)·5(filename)·6(history) 통과. 기존 Phase 15 preview/state·result.md/FinalResult·생성 경로 무영향 확인.
