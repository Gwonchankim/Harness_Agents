# Phase 12 Plan — Attempt UI 고도화 + 대형 resultText 안전장치

> 상태: **계획 검토 단계 (코드 미수정)**. 산출물 확정 후 사용자 지시에 따라 구현. `PHASE_LOG.md`는 구현/검증 후 별도 갱신.
> 방향(확정): **Attempt 탐색 UX 고도화** + **메타/전문 분리 API(lazy)** 로 대형 resultText payload 완화. **schema 0, dependency 0.**

---

## 승인 후 확정 결정사항 (Confirmed — 2026-05-25)

**주 테마** = Attempt UI 고도화 + 대형 resultText 안전장치. (Run activity timeline → Phase 13, report 연결 → Phase 13/14 보류.)

1. **detail endpoint** = `GET /api/runs/[runId]/tasks/[taskId]/attempts/[attemptId]` **서브라우트** 방식.
2. **preview 임계** = **문자수 2,000자**.
   - 목록 API에는 `resultText`를 **절대 포함하지 않음**.
   - detail API는 **전문(full text)** 반환.
   - **UI에서만** 2,000자 preview + "Show full text"로 처리.
3. **필터 위치** = **클라이언트 필터**. 목록 API는 메타데이터 전체 반환, source/status 필터는 AttemptHistory 컴포넌트에서 처리.
4. **임의 비교 컨트롤** = **attemptNumber 드롭다운 2개**. 기본값 = 최신 attempt vs 바로 이전 attempt.
5. **목록 cap** = Phase 12에선 **cap 없이 metadata-only 전체 반환**. 대량 attempt pagination/`take N`은 Phase 13+ 리스크/후속 과제로 문서화.

**추가 원칙(확정):**
- schema migration **0** · dependency **0**.
- `TaskAttempt.resultText`는 계속 **source of truth**.
- detail API는 **run/task/attempt 소속 검증 필수**.
- diff는 선택된 두 attempt 전문만 **lazy fetch** 후 기존 `diffLines` 재사용.
- historical run은 "attempt 기록 없음"으로 **graceful degrade**.
- Run activity timeline·report 연결은 **Phase 13/14 보류**.

> 목록 API 메타 필드(확정): `id, attemptNumber, status, source, resultBytes, hasResult(=resultBytes!=null), startedAt, completedAt, durationMs, error`. (전문 미read·미반환.)

---

## Context — 왜

Phase 11이 `TaskAttempt`(attempt history의 source of truth)를 도입했다. 다음 단계는 이 데이터를 **안전하고 유용하게 탐색**하는 UX다. 현재 두 가지 한계:
- **대형 payload 리스크**: `GET /api/runs/[runId]/tasks/[taskId]/attempts`가 모든 attempt의 `resultText` 전문을 인라인 반환 → 재시도 많거나 출력 큰 task에서 응답 비대(Phase 11에서 미룬 알려진 리스크).
- **탐색 UX 부족**: AttemptHistory가 최신↔직전 diff만 표시. 임의 두 attempt 비교/전문 보기/필터 없음.

Phase 12는 **메타/전문 분리(lazy)** 로 payload를 묶고, attempt 탐색 UX를 끌어올린다. DB(=source of truth)·md/json(=export/cache) 경계, Phase 8~11 흐름은 불변.

---

## 현재 코드 기준 사실 정리 (검증됨)

| 항목 | 사실 | 위치 |
| --- | --- | --- |
| attempts API | 모든 attempt를 `attemptNumber asc`로, **`resultText` 전문 포함** 반환. pagination/limit/truncation 없음. 소속 검증 있음. | `app/api/runs/[runId]/tasks/[taskId]/attempts/route.ts` |
| TaskAttempt 필드 | `resultBytes`는 성공(done) 시에만 set, 실패/취소는 null → `hasResult = resultBytes != null`로 전문 없이 판정 가능. | `prisma/schema.prisma` (TaskAttempt) · `taskAttemptStore.ts` closeAttempt |
| AttemptHistory | 펼침 시 attempts fetch → 타임라인 + 최신↔직전 `selectComparison` diff. **전문 fetch하지만 개별 표시 없음**, 필터/임의비교 없음. diff 패널 `max-h-28rem overflow-auto`. | `src/components/run/AttemptHistory.tsx` |
| 비교 선택 | `selectComparison(attempts)` → done/failed 중 최신 2개 `{latest, previous}` 또는 null. running/cancelled 제외. 순수, 테스트됨. | `src/lib/runs/attemptCompare.ts` |
| diff | `diffLines(before, after): DiffLine[]`('add'|'del'|'ctx') + `countDiff`. 의존성 0. 렌더 패턴은 `RevisionDiff` 참고. | `src/lib/feedback/diff.ts`, `components/feedback/RevisionDiff.tsx` |
| DagGraph 연결 | `runId && status!=='pending'&&!=='blocked'`일 때 `<AttemptHistory>` 렌더. | `src/components/run/DagGraph.tsx` |
| schema | TaskAttempt 이미 존재(Phase 11). 변경 불필요. | `prisma/migrations/20260525051452_phase11_task_attempt` |
| 재사용 | `STATUS_STYLE`(DagGraph), `diffLines`/`countDiff`, `selectComparison`, redactor 4KiB truncation 패턴. | 각 파일 |

---

## 포함 범위 (In Scope)

1. **메타 목록 API 변경** — `attempts` 목록에서 `resultText` 제거, 메타(+`hasResult`,`durationMs`)만 반환.
2. **전문 detail API 신규** — `GET .../attempts/[attemptId]` 단일 attempt `resultText`(+error) lazy 반환, 소속 검증.
3. **순수 헬퍼** — `resolveComparePair`(임의/기본 두 attempt 선택), `truncateForPreview`(대형 텍스트 미리보기). 단위 테스트.
4. **AttemptHistory UI 고도화** — source/status 필터 · 임의 두 attempt 비교(기본 최신vs직전) · attempt별 전문 open-on-demand + preview/접기 · diff는 선택 두 attempt 전문만 lazy fetch 후 `diffLines`.
5. **historical degrade 유지** — attempt 0행 시 "기록 없음 / 이전 버전 run".

## 제외 범위 (Out of Scope) — Phase 13+

- Run activity timeline(retry/backoff/reset/resumed/autoresume/cancel 이벤트 요약) → Phase 13.
- result.md / report.md / agent-reports ↔ TaskAttempt 연결 → Phase 13/14.
- TaskAttempt **schema 변경**(컬럼/테이블/인덱스) — 0.
- 서버측 diff 계산, 새 diff/virtualization dependency.
- branch cleanup(별도 운영 작업).
- attempt 전문의 영구 truncation(원본은 DB에 전문 유지; UI 표시만 preview).

---

## TaskAttempt 기반 UI/UX 개선안

**AttemptHistory (재작성, 범위 내):**
- 펼침 시 **메타 목록**만 fetch → 타임라인 렌더(기존 행 정보 + `hasResult`).
- **필터 바**: source(initial/resume/rerun_from_task/auto_resume) + status(done/failed/cancelled/running) 다중 토글. **로드된 메타에 대한 클라이언트 필터**(추가 fetch 없음).
- **attempt 행 전문 보기**: `hasResult`인 행에 "view output" 토글 → 해당 attempt 전문 **lazy fetch(detail API)** → `truncateForPreview`로 미리보기(앞 N자) + "show full"/접기. 큰 텍스트는 `max-h` 스크롤 박스.
- **비교 패널**: 두 attempt 선택(드롭다운, 기본은 `resolveComparePair`=최신vs직전). 선택/열 때 **두 전문만 detail API로 fetch** → `diffLines` 렌더(RevisionDiff add/del/ctx 스타일 재사용). 방향은 낮은 attemptNumber→높은 번호.
- **fetch 캐시**: 한 번 가져온 attempt 전문은 컴포넌트 state에 메모해 재요청 안 함.
- 0행 → degrade 문구 유지.

---

## API / UI / lib 변경 계획

### API
- **변경 `GET .../attempts/route.ts`** — `select`에서 `resultText` 제거. 응답 `attempts: [{ id, attemptNumber, status, source, resultBytes, hasResult: resultBytes!=null, startedAt, completedAt, durationMs, error }]`. (전문 read 없음 → DB도 큰 텍스트 안 읽음.)
- **신규 `GET .../attempts/[attemptId]/route.ts`** — `ensureRecovered()` → task가 run 소속 검증 → attempt가 task 소속 검증 → `{ id, attemptNumber, status, resultText, error }` 반환. 단건만(전문 1개).

### lib (신규/소폭, 순수)
- **`attemptCompare.ts`** — `selectComparison`(유지) + `resolveComparePair(attempts, aNum?, bNum?)`: 두 번호가 모두 유효하면 `{previous, latest}`(번호 오름차순 정렬), 아니면 `selectComparison` 기본값, 없으면 null.
- **`attemptView.ts`(신규, 순수)** — `truncateForPreview(text, maxChars)` → `{ preview, truncated, totalChars }`. 단위 테스트.

### UI
- **`AttemptHistory.tsx`** — 위 개선안대로 메타 fetch + 필터 + 전문 lazy + 비교 선택 + diff. 기존 `diffLines`/`STATUS_STYLE` 재사용. 새 dependency 0.
- **`DagGraph.tsx`** — 연결 조건 그대로(무변경 예상).

> RunStream/스트리밍/Phase 8~11 resume·rerun·auto-resume·attempt write 경로 불변. executor/recovery/schema **무변경**.

---

## schema 변경 필요 여부

**없음 (0 migration).** `hasResult`는 `resultBytes != null`로 파생(전문 미read), `durationMs`는 `completedAt-startedAt` 파생. 신규 컬럼/인덱스/테이블 0. `TaskAttempt.resultText`는 전문 그대로 유지(source of truth).

---

## 성능 / 대용량 resultText 리스크

- **완화**: 목록은 메타만(전문 미포함·미read) → 응답 크기 attempt 수에 선형이지만 **행당 수십 바이트**. 전문은 attempt 1건씩 on-demand. diff는 2건만. UI preview/truncation으로 DOM 렌더 상한.
- **잔여 리스크**: 단일 attempt 전문이 매우 큰 경우(예: 수 MB) 열 때 그 1건은 전송됨 → preview(앞 N자) 기본 + "show full" 명시 동작으로 완화. 전송 자체는 1건이라 목록 일괄 전송보다 안전.
- **list cap**: 메타-only라 보통 불필요(결정 질문). 극단적 attempt 폭증 대비 `take` 상한은 선택.
- redactor: 전문은 `Task.result`와 동일 신뢰 경계(미로깅) 유지.

---

## 테스트 계획 (순수 단위 + DB/UI는 수동 smoke)

- **신규 순수 테스트**: `attemptCompare.test.ts`에 `resolveComparePair`(두 번호 유효/일부 무효/없음→기본/0~1건→null) 추가. `attemptView.test.ts`(`truncateForPreview`: 짧음 그대로/긴 것 잘림+totalChars/경계).
- 기존 `selectComparison`/`diff` 테스트 회귀.
- 전체 `typecheck` + `test`(현재 178 + 신규) + `next build`(라우트 +1: attempts/[attemptId]) + `prisma migrate status`(**4 migrations 그대로**, 0 added).

---

## 수동 smoke 시나리오 (provider 호출 없음 — 기존 attempt 데이터 활용)

> Phase 11 smoke로 `cmpk0uedb…`의 `resume-smoke-worker`에 attempt 3개 존재(필요 시 1회 rerun으로 추가).

1. **메타 목록**: 목록 API가 `resultText` **미포함**, `hasResult`/`durationMs`/`resultBytes` 정확 반환 확인(전문 미전송).
2. **전문 lazy**: detail API가 단일 attempt `resultText` 반환, 소속 검증(다른 run/task의 attemptId → 404).
3. **UI 전문 보기**: 행 "view output" → lazy fetch → preview(앞 N자)+show full/접기.
4. **임의 비교**: 두 attempt 선택 → 두 전문만 fetch → diff 표시. 기본은 최신vs직전.
5. **필터**: source/status 토글이 로드된 메타를 클라이언트 필터(재fetch 없음).
6. **degrade**: attempt 0행 task(resume-smoke-seed) → "기록 없음".
7. (회귀) rerun/resume/auto-resume 흐름 정상, AttemptHistory가 새 attempt 반영.

---

## 리스크 (결정 질문은 위 Confirmed decisions에서 해소)

- R1 단일 대형 전문 전송 → 완화: detail API 1건씩 + UI 2,000자 preview 기본 + 명시적 "Show full text".
- R2 detail API가 전문 반환 → 신뢰 경계: 미로깅 + run/task/attempt 소속 검증 필수.
- R3 UI 상태 복잡도 증가(필터+드롭다운 2선택+전문 캐시) — 컴포넌트 비대. 완화: 순수 헬퍼 분리(resolveComparePair/truncateForPreview).
- R4 클라이언트 필터는 로드된 메타 한정(서버 필터 아님) — 메타 전체 로드 전제(Phase 12 cap 없음). 대량 attempt 시 메타 목록 자체가 커질 수 있음 → **pagination/`take N`은 Phase 13+ 후속 과제로 문서화**(확정 #5).

---

## 검증(Verification) 요약
```
corepack pnpm --filter web typecheck                   # 0 errors
corepack pnpm --filter web test                        # 178 + 신규 순수 케이스
corepack pnpm --filter web exec next build             # PASS, 라우트 +1 (attempts/[attemptId])
corepack pnpm --filter web exec prisma migrate status  # 4 migrations, 0 added (schema 무변경)
```
+ 수동 smoke 1(메타-only)·2(전문 lazy+소속검증)·4(임의 비교)·6(degrade) 통과. Phase 8~11 경로 무영향 확인.
