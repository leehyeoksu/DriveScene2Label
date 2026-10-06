# Claude Code I1/I2 보완·후속 검증 프롬프트

작성일: 2026-10-06. I0~I2 구현 이후 검토에서 발견한 두 문제를 수정하고, 실제 원본 없이 가능한 검증을 이어가기 위한 프롬프트다. 이 문서 작성은 제품 코드 수정이나 실제 추론 실행이 아니다.

> FU-01~08 실행 보고 이후의 추가 검토는 [후속 검토](frontend-integration-followup-audit-2026-10-06.md)에 있다. 현재 남은 두 보완을 요청할 때는 [만료 타이머·DB 포트 보완 프롬프트](claude-code-expiry-dbport-prompt.md)를 사용한다. 아래 과거 작업 범위를 처음부터 반복하지 않는다.

기준: [2026-10-06 검토](frontend-integration-audit-2026-10-06.md), [개선 기획서](frontend-integration-plan.md), [개선 체크리스트](frontend-integration-checklist.md). 기존 [전체 시작 프롬프트](claude-code-integration-prompt.md)는 과거 구현 범위 참고로 사용한다.

## 바로 전달할 프롬프트

아래 코드 블록 전체를 Claude Code에 전달한다.

```text
DriveScene2Label의 I1/I2 보완과 후속 검증을 실제로 진행해줘.

현재 I0 main 병합과 I1/I2 기본 구현은 끝났고, Codex 검토에서 두 가지 추가 문제가 재현됐다. 계획 설명에서 끝내지 말고 문제 재현 → 수정 → 회귀 검증 → 문서 갱신까지 수행해줘. 실제 데이터/접속 정보가 없어도 진행할 수 있는 작업은 계속해줘.

1. 작업 위치와 현재 상태

- 실제 코드 저장소는 /Users/jeonwoojin/Documents/ChatGPT/캡스톤/DriveScene2Label이다. 상위 캡스톤 폴더는 별도 Git 저장소다. pwd, git rev-parse --show-toplevel, branch/HEAD/status부터 확인한다.
- 기대 브랜치는 codex/frontend-implementation이다. 검토 기준 HEAD는 273b8e6이며 이후 변경이 있으면 현재 코드와 변경 내역을 우선 확인한다.
- 기존 checkpoint 17128ea와 main merge 1b7c19b는 완료된 이력이다. 이번 보완만을 위해 다시 main을 병합하거나 작업 브랜치를 새로 만들지 않는다.
- 검토 문서 등 미커밋 변경을 보존한다. git reset --hard, git clean, 강제 checkout, 기존 DB/volume 삭제를 하지 않는다. 실행 중인 다른 세션의 서버도 임의로 중단하지 않는다.
- 이번 요청에 원격 push, PR 생성, 신규 원격 GPU 추론은 포함하지 않는다. 코드 수정에 필요한 일반적인 구현 선택은 근거를 기록하고 진행한다.

2. 기준 문서와 코드 읽기

먼저 다음을 읽는다.
- CLAUDE.md
- docs/frontend-integration-audit-2026-10-06.md
- docs/frontend-integration-plan.md
- docs/frontend-integration-checklist.md
- docs/operations-recovery.md
- README_API.md, frontend/README.md, docs/rerun-recording.md
- ai-server/README.md, ai-server/VESPA_Seraph.md, compose.yml 및 사용 중인 overlay

관련 시작점은 다음과 같다. 파일 위치와 실제 호출 흐름을 다시 확인한다.
- frontend/src/features/system/useSystemStatus.ts
- frontend/src/api/system.ts
- frontend/src/features/system/InstanceWatcher.tsx
- frontend/src/lib/jobs/receipts.ts
- frontend/src/lib/jobs/submissions.ts
- frontend/src/features/labeling/JobPanel.tsx
- frontend/src/features/viewer/RecordingPanel.tsx 및 RerunViewer.tsx
- frontend/tests/e2e/integration.spec.ts, frontend/tests/live/actual-mini.spec.ts
- Spring SystemStatusService, AutoLabelService, RecordingService 및 관련 테스트

기존 React/TypeScript/Vite/Router/Query/Zustand/Tailwind/shadcn 구성과 디자인, 6카메라·분할·A/B·Rerun 기능을 유지한다. 브라우저는 Spring /api/*만 호출한다. exporter/web SDK는 0.38.1, VESPA venv는 0.21.0을 유지한다.

3. FU-01 — 상태 조회 실패/만료 뒤 이전 READY 사용 수정 (최우선)

검토에서 재현한 문제:
- useSystemStatus.capability()는 q.data를 q.isError보다 먼저 반환한다.
- TanStack Query는 재조회 실패 시 이전 성공 데이터를 보존하므로 READY 응답 뒤 상태 API가 실패해도 READY/canExecute=true가 남을 수 있다.
- 현재 훅은 capability의 expiresAt을 판정하지 않는다.

해야 할 작업:
- 조회 실패 시 이전 READY가 현재 실행 가능 판정에 사용되지 않게 한다. UNKNOWN/확인 불가와 실행 불가 상태를 명확히 반환한다.
- expiresAt과 응답 신선도를 확인한다. 만료된 READY로 새 검색·새 job·새 recording을 계속 허용하지 않는다. 마지막 성공 정보를 표시하더라도 현재 판정과 구분한다.
- capability별 유효기간과 query 재조회 간격을 함께 검토한다. 일반 상태 GET 재확인으로 복구되게 하되 무한 재조회·불필요한 SSH 검사·반복적인 버튼 깜박임을 피한다. 명시적 refresh만 무거운 환경 재검사를 요청하는 기존 정책을 유지한다.
- 수동 refresh와 뒤따르는 GET까지 실패해도 이전 READY가 복원되지 않게 한다. 정상 응답이 돌아오면 최신 상태로 복구한다.
- 기존 완료 결과/READY recording 열기, 작업 상태 GET, 이미 접수된 동일 Idempotency-Key 요청 확인은 새 실행 준비 상태와 구분해 보존한다. status GET 오류를 job FAILED로 바꾸지 않는다.
- Query의 실제 실패 후 캐시 보존 동작을 사용하는 회귀 검증을 추가한다. READY→연결 실패/HTTP 500, 만료, refresh+GET 실패, 정상 복구를 확인한다. 이 과정에서 새 job/recording POST가 발생하지 않아야 한다.

관련 요구/기록: IN-03, I1-03/I1-06, IT-02, FU-01.

4. FU-02 — 구버전 receipt의 잘못된 DB 귀속 방지 (최우선)

검토에서 재현한 문제:
- v1 receipt에는 원래 DB의 instanceId가 없다.
- migrateLegacyReceipts는 jobId 조회 결과의 datasetId/sceneToken만 일치하면 현재 instanceId를 붙여 v2에 저장한다.
- 같은 nuScenes를 새 DB에 import하고 새 작업을 생성하면 datasetId/sceneToken/jobId가 모두 같아도 서로 다른 요청일 수 있다.

해야 할 작업:
- 기본 수정은 원래 출처를 입증할 수 없는 v1 기록을 미확인 이력으로 보존하고 새 DB에 자동 귀속하지 않는 방식으로 한다. 기존 v1 데이터를 삭제하거나 v2 이력을 덮어쓰지 않는다.
- 단순 dataset checksum·scene·classMode 일치도 같은 요청의 증거로 사용하지 않는다. 이번 문제만 해결하기 위해 불필요한 API/migration을 추가하지 않는다.
- 현재 v2 receipt의 instance 분리, 서버 교체 시 Query/UI 정리와 새 요청 receipt 저장을 보존한다.
- InstanceWatcher의 자동 이전 호출과 UI의 이력 복원/선택 흐름도 함께 확인한다. 미확인 이력이 현재 서버의 확정된 작업으로 표시되지 않게 한다.
- 과거 로직이 이미 잘못 귀속시켰을 수 있는 paneId='legacy' v2 기록도 검토한다. 요청 동일성 입증이 안 되면 해당 기록만 미확인으로 다루고 정상 신규 v2 기록은 유지한다.
- 서로 다른 DB에 같은 datasetId/sceneToken/jobId가 있지만 요청이 다른 경우를 회귀 검증한다. 이전 v1과 기존 legacy v2, 정상 v2, 서버 조회 실패/404, 반복 초기화를 함께 확인한다.

관련 요구/기록: IN-06, I2-04, IT-04, FU-02.

5. FU-03 — 지연 recording 응답 검증 보완

- submissions의 recording 요청도 job처럼 원래 요청 문맥을 유지하는지 실제 지연 응답 테스트로 확인한다. 기존 체크리스트에는 전용 recording e2e가 없다고 기록돼 있다.
- 씬 A→B, A→B→A에서 새 사용자 선택 발생, 비교 활성 패널 변경, 컴포넌트 언마운트, instance 교체 중 응답을 늦춘다.
- 원래 recording의 서버 생성/조회 사실은 보존하되 다른 씬·패널·instance·generation의 선택을 덮어쓰지 않아야 한다.
- 원래 씬으로 복귀했을 때 recording을 조회/선택할 수 있어야 한다. 복구/환경 확인을 이유로 VESPA를 생성하거나 exporter를 불필요하게 다시 호출하지 않는다.
- 실패가 발견되면 관련 문맥/캐시 처리만 수정하고 같은 key/같은 recording의 재사용 계약을 유지한다.

관련 요구/기록: IN-06/08, I2-03, IT-06/09, FU-03.

6. 실제 원본 없이 가능한 나머지 검증

FU-01~03을 먼저 마친 뒤 실행 조건이 갖춰진 항목을 이어간다. 필요한 원본/원격 접속 때문에 막힌 검증과 로컬 도구·빌드 조건 때문에 미실행인 검증을 구분한다.

- FU-04: Docker AI 이미지 build 및 실제 컨테이너에서 CLIP 로딩 실패 중 exporter/capabilities/catalog 사용 가능 여부를 확인한다. 실제 모델 다운로드를 대신하는 통제된 실패 주입을 사용할 수 있으나 실패 주입임을 기록하고 recording-only 하네스를 제품 AI 컨테이너 검증으로 대신하지 않는다. 이 검증에 실제 GPU 추론이나 대규모 원본 다운로드는 필요하지 않다.
- FU-05: 별도의 테스트 project/DB와 fake AI/합성 데이터에서 worker 중단·재시작·늦은 응답·수동 복구를 확인한다. 기존 token 조건, 결과/실패 덮어쓰기 방지, recording 재생성을 검증한다. 실제 Seraph 잔존 job 실험은 접속 정보 확보 후 수행한다.
- FU-06: 합성 화면에서 keyboard/focus/reduced-motion 및 상태 안내의 기본 접근성을 확인한다. headless WebKit 검증과 실제 Safari 앱 검수를 구분한다. 실제 이미지·점군의 시각 품질/성능 완료는 별도다.
- 일괄 의존성 업그레이드나 관련 없는 리팩터링은 하지 않는다. 환경이 부족하면 구체적인 제약을 기록하고 나머지 가능한 항목을 계속한다. 단계마다 일반적인 수정 승인을 다시 묻지 않는다.

7. FU-07 — 실제 데이터 준비 확인과 I3/I4 재개

- 2026-10-06 검토 당시 로컬 dataset은 SYNTHETIC/PARTIAL, 검색은 CLIP_NOT_DEPLOYED, VESPA는 SYNTHETIC_DATASET, recording은 READY였다. 현재 API를 다시 확인하고 이 과거 상태를 현재 사실로 복사하지 않는다.
- 이미 제공된 로컬 설정·mount·문서를 먼저 확인하고, 없는 경로·접속 권한·jobId를 만들거나 데이터 이름/version으로 원본 여부를 추정하지 않는다. secret이나 .env 전체를 출력하지 않는다.
- 미제공 입력은 한 번에 정리한다: D-01 mini 원본 root/version, D-02 실행 호스트, D-03 local/Seraph 실행 환경, D-04 CLIP embedding 및 기존 COMPLETED job. 입력 대기 중에도 FU-01~06의 독립 작업을 계속한다.
- 실제 원본이 확보되면 I3의 6카메라·여러 프레임·GT 투영·LiDAR·GT-only recording부터 확인한다. 이 단계는 GPU 추론 없이 진행할 수 있다. devkit 대조와 실제 정상 결과 suite까지 확인한 범위에서 A를 판정한다.
- 테스트 환경과 다른 Compose project/DB/volume/port를 사용한다. compose.yml의 DB host port는 현재 55433으로 고정돼 있으므로 APP_PORT나 project 이름만 바꿔 포트가 모두 분리됐다고 가정하지 않는다. 필요한 port 설정/overlay를 코드와 문서에 맞게 준비하고 충돌을 검증한다.
- backend의 AI depends_on 및 선택 overlay도 확인한다. db/backend만 지정한 명령이 어떤 AI 서비스를 시작하는지 확인하고, recording-only와 제품 AI/SSH 구성을 의도한 단계에 맞게 사용한다. Compose 검사 결과에 secret을 출력하지 않는다.
- 실제 정상 결과 suite는 frontend에서 DS2L_ACTUAL=1 DS2L_API=<실제 Spring URL> npx playwright test -c playwright.live.config.ts tests/live/actual-mini.spec.ts로 실행한다. recording 생성까지 검증할 때 DS2L_LIVE_ALLOW_POST=1의 범위를 확인한다. 합성/UNKNOWN 데이터는 실패해야 하며 이를 통과하도록 기대값을 완화하지 않는다.
- CLIP/embedding과 제공된 완료 VESPA job이 준비되면 I4를 진행한다. 기존 결과 확인과 신규 GPU 추론은 별도로 보고하며, 이번 요청만으로 새 원격 추론을 시작하지 않는다.

8. FU-08 — 검증·문서·최종 보고

- 먼저 두 재현 문제의 실패를 확인하고 수정 후 통과하는 검증을 남긴다. 기존 테스트를 약화하거나 예외를 숨겨 통과시키지 않는다.
- frontend typecheck/test/build와 변경에 맞는 e2e를 실행한다. Spring/AI를 변경한 경우 관련 테스트도 실행한다. 통과 후 변경/실패가 없으면 같은 전체 검사를 불필요하게 반복하지 않는다.
- 이전의 50 unit/55 browser/32 Spring/48 AI 숫자를 이번 실행 결과로 복사하지 않는다. SSH 테스트의 macOS stat -c 차이는 이미 알려진 환경 제약이며 이번 회귀 실패와 구분한다.
- docs/frontend-integration-checklist.md에 FU-01~08, I1/I2 관련 검증의 현재 상태와 명령/결과/제약을 갱신한다. 2026-10-05 R-01~05와 2026-10-06 검토는 과거 기록으로 보존하고 새로운 날짜/기록을 추가한다. API/실행 방법을 바꾸면 README_API/README/예제 설정/복구 문서도 필요한 범위에서 갱신한다.
- fixture/fake AI, 실제 SDK의 합성 recording, 실제 제품 컨테이너, 실제 nuScenes/CLIP/VESPA 검증을 각각 표시한다. 미실행·skip·부분 통과를 완료로 쓰지 않는다.
- git diff --check 및 수정 파일/secret·생성물 혼입 여부를 확인한다. 이 요청만으로 commit/push하지 않는다.
- 최종 보고는 한국어로: branch/HEAD, 수정한 두 문제와 recording 문맥 검증, 실행한 검사와 데이터 종류, 남은 FU/I 항목, A/B/C 실제 완료 여부, 필요한 준비 입력, 다음 재개 명령을 적는다.

필수 완료 기준은 FU-01/FU-02 수정·회귀 검증과 FU-03 지연 recording 검증, FU-08 문서/보고다. FU-04~07은 현재 환경에서 실제 수행 가능한 범위까지 진행하고 남은 조건을 구체적으로 남긴다. 실제 데이터가 없으면 A/B/C를 미완료로 유지하되 독립적인 코드/검증 작업을 중단하지 않는다.
```

## 파일을 읽게 하는 짧은 실행 프롬프트

```text
작업 디렉터리는 /Users/jeonwoojin/Documents/ChatGPT/캡스톤/DriveScene2Label이야.
docs/claude-code-integration-followup-prompt.md를 읽고, 그 안의 "바로 전달할 프롬프트"에 따라 실제 수정과 검증을 진행해줘.
이미 끝난 main 병합을 반복하지 말고 현재 codex/frontend-implementation 브랜치에서 이어가줘.
FU-01/FU-02의 두 문제를 먼저 재현·수정하고 FU-03 recording 지연 응답 검증, 가능한 후속 검증, 체크리스트 갱신까지 완료해줘.
실제 데이터가 필요한 A/B/C 검증과 합성 데이터 테스트를 구분해서 한국어로 결과를 보고해줘.
```
