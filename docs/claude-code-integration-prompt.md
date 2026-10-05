# Claude Code 실제 데이터·프론트 연동 업데이트 프롬프트

작성일: 2026-10-05. 기존 React·Spring·AI 구현을 개선 기획서에 따라 업데이트하는 실행용 프롬프트다. 최초 구축용 프롬프트와 구분한다.

대상 저장소: /Users/jeonwoojin/Documents/ChatGPT/캡스톤/DriveScene2Label. 상위 캡스톤 폴더도 별도 Git 저장소이므로 실제 코드 저장소 루트를 확인한다.

기준 문서: [개선 기획서](frontend-integration-plan.md), [개선 체크리스트](frontend-integration-checklist.md), [근거 분석](frontend-integration-review.md). 아래 프롬프트를 Claude Code에 전달하면 문서 준비 다음 단계인 실제 구현을 요청하는 것으로 사용한다. 이 파일 작성 자체로 앱 수정·merge·실제 추론이 수행된 것은 아니다.

## 전체 시작 프롬프트

아래 코드 블록 전체를 첫 메시지로 전달한다.

```text
DriveScene2Label의 실제 데이터·프론트 연동 개선을 구현해줘.

이미 React 프론트, GT category, job 문맥, Rerun recording 생성/제공 코드가 구현되어 있다. 기존 구현을 보존하며 후속 기획서에 따라 업데이트한다. 이번 요청은 기획 정립 다음 단계의 구현 착수다.

0. 저장소와 현재 변경 확인

- 작업 디렉터리는 /Users/jeonwoojin/Documents/ChatGPT/캡스톤/DriveScene2Label이다. pwd와 git rev-parse --show-toplevel을 확인한다. 상위 캡스톤의 main 표시와 내부 코드 저장소의 branch를 혼동하지 않는다.
- git status, 현재 branch/HEAD, 변경 목록, 기존 앱/문서를 먼저 확인한다. 기대 작업 브랜치는 codex/frontend-implementation이며 실제 상태가 우선이다.
- 이미 이 브랜치면 이어간다. 다른 브랜치라면 변경·이력부터 확인하며 사용자 변경을 덮어쓰는 강제 checkout을 하지 않는다.
- 기존 미커밋 구현과 문서를 검토하고, secret·원본·모델·생성물을 제외한 정확한 파일 목록으로 복원 가능한 로컬 체크포인트를 보존한 뒤 main을 통합한다. 로컬 체크포인트 커밋을 사용할 수 있다. 모든 파일을 무조건 git add 하지 않는다.
- git reset --hard, git clean으로 작업을 지우거나 기존 volume을 삭제하지 않는다. 다른 실행 세션의 작업/서버를 임의로 중단하지 않는다. 원격 push/PR 생성은 이번 요청에 포함하지 않는다.

1. 기준 문서 읽기

다음 문서를 읽고 실제 Controller/DTO/Service/AI/frontend 코드와 대조한다.
  1) CLAUDE.md
  2) docs/frontend-integration-plan.md
  3) docs/frontend-integration-checklist.md
  4) docs/frontend-integration-review.md
  5) docs/frontend-product-plan.md
  6) README_API.md, docs/rerun-recording.md
  7) README.md, frontend/README.md, docs/docker-integration.md
  8) 실제 존재하는 ai-server/VESPA.md 및 최신 main의 ai-server/VESPA_Seraph.md

- 개선 기획서의 IN-01~IN-15, I0~I5와 IT-01~IT-18을 추적한다.
- 기존 M1~M6/V-01~V-10은 이전 구현·검증 기록이다. 새 개선 통과로 복사하지 않는다.
- 기획서에서 신규 제안으로 표시한 API·DB·테스트는 아직 구현됐다고 가정하지 않는다. 실제 코드를 확인하고 구현할 계약으로 다룬다.
- 기존 frontend/·recording을 새로 만들거나 이전 최초 구축 프롬프트를 다시 실행하지 않는다. 개선 범위의 결정은 후속 기획서를 우선하고 실제 계약과 불일치하면 근거를 기록한다.

2. I0 — 최신 main 통합

- origin/main을 갱신하고 실제 ref·변경 목록을 확인한다. 분석 당시 main은 8b0c88c, PR #3은 VESPA SSH executor였지만 오래된 ref를 고정하지 않는다.
- 현재 미커밋 변경을 먼저 보존한 후 작업 브랜치에 최신 main을 통합한다.
- .env.example, ai-server/Dockerfile, ai-server/main.py는 분석 당시 텍스트 충돌이 예상됐다. recording과 SSH 기능을 모두 보존해 해결하고 자동 병합된 README도 의미를 검수한다.
- exporter/web Rerun 0.38.1, VESPA venv 0.21.0, 기존 local 실행·CLIP·REST·idempotency를 유지한다. 이번 개선만을 위해 의존성을 일괄 업그레이드하지 않는다.
- 통합 후 관련 frontend/Spring/AI local·SSH·recording 검사를 수행하고 기준을 기록한다.

3. I1 — 데이터 출처, 기능 준비 상태, 정확한 오류

- 기획서대로 안정적인 DB instanceId, checksum에 대응하는 dataset_provenance, job/recording errorCode를 새 migration으로 추가한다. 기존 migration을 수정하지 않는다.
- 기존 데이터의 출처가 불명확하면 UNKNOWN으로 둔다. nuScenes라는 이름, v1.0-mini 문자열, sample 개수로 합성/실제 여부를 추정하지 않는다.
- Spring GET /api/system/status와 내부 AI GET /capabilities를 구현한다. 이전 AI /health adapter, schemaVersion, dataset 문맥, checkedAt/expiry와 refresh 정책을 포함한다.
- READY/CONFIGURED/UNAVAILABLE/UNKNOWN과 canExecute를 구분한다. configured를 검증 완료로 승격하지 않는다.
- 환경 상태 확인은 가벼운 읽기 검사다. refresh/poll로 VESPA 추론·sbatch·embedding 생성·dataset import를 시작하지 않는다. SSH 검사는 중복 실행/시간 상한/캐시를 둔다.
- VESPA/recording의 지원·설정·선택 데이터 일치와 필요한 준비 검사를 확인한다. 검색은 CLIP model/preprocess와 선택 dataset embedding을 대조한다.
- backend catalog를 AI 전체 health와 분리하고, 통합 AI에서 CLIP 초기화 실패가 준비된 exporter까지 종료시키지 않도록 한다. 기존 cleanup/lock/오류 동작을 보존한다.
- 프론트 목록/작업대에 테스트/출처 미확인 상태와 기능별 이유를 표시한다. 실제 VESPA 미지원이면 실행을 막으며 기존 완료 결과와 센서 탐색은 유지한다.
- 새 POST에서도 서버가 준비 조건을 확인한다. 동일 Idempotency-Key의 기존 job 반환은 AI 중단 중에도 가능하게 하고 외부 검사 중 DB transaction을 유지하지 않는다.
- upstream 404, 연결 실패, timeout, 설정/데이터 누락, 실행 실패, 결과 검증/저장 실패를 errorCode로 구분한다. HTTP 502 자체를 AI 모델 오류로 단정하지 않는다.
- 상태 GET 실패는 job FAILED가 아니다. 기존 message만 있는 오류를 추측해서 새 원인으로 바꾸지 않는다.

4. I2 — 비동기 문맥, worker 병행, 3D 복구

- RunIntent/snapshot에 instanceId, datasetId/checksum, sceneId/token/name, paneId, classMode, requestedAt, idempotencyKey, UI generation을 저장한다.
- receipt는 응답 시점의 scene prop가 아니라 요청 snapshot으로 기록한다. pane/scene/generation이 달라졌으면 원래 이력만 남기고 새 화면에 job을 연결하지 않는다.
- A→B→A, 활성 pane 전환, 언마운트에도 오래된 응답이 새 사용자 선택을 덮어쓰지 않게 한다. 접수 이력 수명을 컴포넌트 밖에서 관리한다.
- recording 요청도 원래 scene/job의 캐시와 선택만 갱신한다. instanceId별 receipt와 query/UI 상태를 분리하고 이전 receipt는 서버 문맥 확인 없이 새 DB에 복원하지 않는다.
- VESPA와 recording의 실행 계통을 분리해 긴 라벨 HTTP 중에도 GT-only recording이 실행되게 한다. 각각 실행 상한 1을 기본으로 DB claim/SKIP LOCKED/executionToken과 AI lock을 유지한다.
- exporter 생성 실패, READY 파일 다운로드 실패, WASM/Viewer 시작 실패를 구분한다. 같은 READY recording 다시 열기는 새 exporter/VESPA POST를 만들지 않는다.
- 재시도/언마운트 시 fetch·Viewer·channel·listener 자원을 정리한다. 실제 파일 유실은 서버가 조건부로 상태를 정정하고 recording만 다시 생성한다. 일시적인 파일 접근 실패를 유실로 단정하지 않는다.
- GT/예측 토글은 이번 전달에서 카메라 라벨 범위를 명확히 표시한다. 전체 3D 토글·목록→3D 선택 강조는 기획서대로 기술 검증 후 후속 미완료로 기록한다.

5. I3 — 실제 mini 센서 탐색

- 준비된 로컬 환경 파일·dataset mount·문서를 먼저 확인한다. 비밀번호·개인 키·환경 파일 전체를 출력하지 않는다. 실제 데이터 위치나 접속 권한을 추측하지 않는다.
- 원본 위치/실행 호스트 등 필요한 정보가 없으면 핵심 질문을 한 번에 요청하고, 답을 기다리는 동안 I1/I2 및 독립적인 검증/문서를 계속 진행한다.
- 실제 dataset 검증은 테스트 DB와 분리된 환경에서 수행한다. 현재 importer는 동일 name/version에 다른 checksum의 재import를 거부하므로 root만 바꾸어 기존 fixture를 덮어쓰지 않는다.
- 실제 root/version/checksum과 미디어 파일 읽기, Spring/AI 데이터 문맥 일치를 확인한다. SSH는 센서 원본을 자동 다운로드하는 기능이 아니다.
- 실제 여러 sample에서 6카메라·GT·timestamp 재생·확대·분할·A/B를 검증한다. 오류 종료나 합성 이미지 표시로 성공 처리하지 않는다.
- 실제 LiDAR/GT-only recording과 devkit 기준 투영을 확인한다. IT-13의 예측 포함 부분은 I4에서 별도로 검증한다. 이 단계에 새 VESPA 추론을 전제로 추가하지 않는다.

6. I4 — 실제 검색과 VESPA 연결

- CLIP model/preprocess/dimension 및 embedding 대상 범위를 확인한 뒤 정의한 query로 검색 성공을 검증한다.
- 사용할 local 또는 Seraph SSH 실행 환경을 확인한다. SSH 접속·원격 script/config/데이터·모델이 준비됐다고 가정하지 않는다.
- 제공된 기존 COMPLETED job으로 scene/classMode/sample coverage/카메라 예측/recording을 먼저 검증할 수 있다. 기존 결과 조회와 신규 추론 성공은 별도로 보고한다.
- 대규모 원본/모델 다운로드, 신규 원격 GPU 추론은 준비 조건·자원과 사용자 요청 범위를 확인한 뒤 진행한다. 필요한 경우 현재 설정·실행 대상·비용/규모를 구체화한 상태로 질문한다.
- SSH queue/계산 단계를 알려주는 실제 정보가 없으면 RUNNING만 정확히 표시한다. 가짜 진행률/종료 시간을 만들지 않는다.

7. I5 — 실제 사용 검수와 문서

- 실제 데이터에서 Safari/Chromium, 분할·확대·재생·A/B·복구·화면 복귀를 확인한다. Chromium fixture 통과를 Safari 실사용 완료로 쓰지 않는다.
- 기획서의 해상도·keyboard/focus/reduced-motion/screen-reader 안내를 확인한다. 센서 면적·3D 첫 시점·진단 정보는 실제 화면으로 검수한다.
- 최초/반복 로딩, 실제 recording/점 수, 프레임 준비, A/B 메모리와 자원 해제를 측정하고 기준 기기/회선에 맞는 예산을 기록한다. 미측정 성능 수치를 만들지 않는다.
- 중단 RUNNING 작업, 원격 job 잔존, READY 파일 유실의 운영 복구와 executionToken 방어를 문서화/검증한다. 단순 timeout만으로 새 GPU 작업을 반복 제출하지 않는다.
- 자동 lease/취소/전체 3D 상호작용 등 후속 범위를 이번 필수 범위의 완료로 표시하지 않는다.

8. 검증·진행·최종 보고

- docs/frontend-integration-checklist.md의 I0~I5/IT-01~IT-18을 구현·실행 결과에 맞춰 갱신한다. 관련 단계와 의미 있는 회귀 테스트를 실행한다.
- fixture 실패/복구 테스트와 실제 데이터 정상 성공 검증을 분리한다. 실제 데이터 suite가 missing/error/FAILED로 끝났다는 이유만으로 통과하지 않게 한다.
- 실제 확인한 commit/ref, dataset/checksum, scene/sample/job/recording, executor, browser/viewport, 명령/결과/증거/제약을 남긴다. 이전 48/43/22/27/35개 보고 숫자를 현재 결과로 복사·합산하지 않는다.
- typecheck/build/관련 unit·e2e·Spring·AI 검사와 git diff --check를 수행한다. 실행 불가능한 검사는 환경과 미실행 사유를 기록한다.
- README_API, README, frontend README, 관련 recording/AI 문서를 실제 구현과 일치시킨다. 신규 제안과 제공 중인 계약을 구분한다.
- 단계마다 일상적인 구현 선택을 승인받으려고 멈추지 않는다. 짧은 진행 상황을 공유하고 가능한 필수 작업을 끝까지 진행한다. 환경에 의존하는 단계만 준비 대기로 남기고 독립적인 코드/검증은 계속한다.
- 최종 보고는 다음을 포함한다:
  1) 현재 branch/commit·main 통합 여부와 코드 변경
  2) 실행한 검사·결과·데이터 종류
  3) A 센서 탐색 / B 검색·라벨 / C 사용 검수의 실제 완료 여부
  4) 환경 대기·미검증·후속 항목과 해결에 필요한 입력
  5) 정확한 실행/재개 명령과 다음 미완료 체크리스트 ID

I0부터 시작하여 준비된 환경에서 I5까지 가능한 필수 작업을 진행해줘. 계획만 다시 설명하고 끝내지 말고 코드 수정·검증·문서 갱신을 수행해줘. 원본·서버 권한이 없으면 그 사실을 명확히 남기고 실제 연동 전체를 완료했다고 보고하지 마.
```

## 중단 후 재개 프롬프트

```text
DriveScene2Label 실제 데이터·프론트 연동 개선 작업을 이어서 진행해줘.

먼저 실제 저장소 루트, branch/HEAD/status와 기존 변경을 확인하고 아래 문서를 읽어줘.
- CLAUDE.md
- docs/frontend-integration-plan.md
- docs/frontend-integration-checklist.md
- docs/claude-code-integration-prompt.md
- README_API.md와 실제 Controller/DTO/Service/AI 코드

개선 체크리스트와 이전 검증 기록에서 다음 미완료 ID를 찾아 이어가줘. 완료한 통합이나 구현을 처음부터 다시 하지 말고 새 변경/오류/미검증에 맞는 검사를 수행해줘.

기존 코드·문서·테스트 DB/volume을 보존하고 전체 시작 프롬프트의 계약·재시도·실제 데이터 판정 기준을 그대로 유지해줘. 환경 대기 항목은 필요한 입력을 정리하고 가능한 독립 작업을 계속해줘.

최종 보고에 현재 단계, 이번 검사, 실제 A/B/C 완료 여부, 남은 환경 입력과 다음 미완료 ID를 남겨줘.
```
