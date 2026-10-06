# 실제 데이터·프론트 연동 개선 구현 체크리스트

기준: [개선 기획서 v1.0](frontend-integration-plan.md), [근거 분석](frontend-integration-review.md). 작성일 2026-10-05. 기존 M1~M6 구현 기록은 [이전 체크리스트](frontend-implementation-checklist.md)에 유지한다.

실제 착수·재개는 [Claude Code 업데이트 프롬프트](claude-code-integration-prompt.md)를 사용한다.

**현재 상태 (2026-10-06 후속 실행 후): I0 통합과 I1/I2 기본 구현 완료, 검토 보완 FU-01/FU-02 수정·회귀 검증 완료, FU-03/05/06/07(가능 범위) 검증 기록. FU-04는 아래 11장 기록 참조. 후속 검토의 만료 타이머·embed DB 포트 보완은 12장. I3/I4는 실제 데이터·접속 정보 대기(2026-10-06 재확인), I5는 문서/방어 일부만 진행.** [2026-10-06 검토](frontend-integration-audit-2026-10-06.md)와 [현재 후속 실행 프롬프트](claude-code-integration-followup-prompt.md)를 기준으로 FU-01/FU-02부터 재개한다. 아래 기존 I0~I2 체크와 R-01~05는 2026-10-05 구현·검증 기록이며 이번 보완의 통과를 뜻하지 않는다. fixture·합성 데이터·fake AI 통과는 실제 연동 완료가 아니며 A/B/C 단계 완료로 표시하지 않았다.

| 완료 단계 | 판정 |
|---|---|
| A: 센서 탐색 | **미완료** — 실제 nuScenes 원본 없음(D-01) |
| B: 검색·라벨 연동 | **미완료** — CLIP/embedding·VESPA 실행 환경 없음(D-03/D-04) |
| C: 사용 검수 | **미완료** — A/B 이후 실제 데이터 필요 |

## 1. 준비 입력

| ID | 준비할 정보 | 현재 상태 | 미확보 시 영향 |
|---|---|---|---|
| D-01 | 실제 nuScenes root/version/원본 파일 접근 | **없음** (2026-10-05 이 Mac에서 검색: 원본·압축본 없음. 2026-10-06 재확인: `.env`의 `NUSCENES_HOST_PATH`는 합성 `.local/nuscenes`, origin SYNTHETIC) | I3 실제 데이터 완료 판정 불가 |
| D-02 | Spring·exporter를 실행할 호스트/DB/port/volume | 미결정. 현재 로컬은 합성 fixture 스택(`.local/`) | 실제 데이터용 별도 Compose project/DB 필요 |
| D-03 | local 실행 환경 또는 Seraph 계정·접속/원격 script·모델 | **없음** (`.env`에 VESPA_EXECUTOR/SSH 설정 없음, `secrets/` 없음, GPU 없음. 2026-10-06 재확인 동일) | I4 신규 실제 추론 검증 불가 |
| D-04 | model/preprocess에 맞는 embedding·기존 완료 job 제공 여부 | **없음** (2026-10-06 로컬 `GET /api/datasets/1/embeddings` = `[]`, 제공된 완료 jobId 없음) | 실제 검색/예측 성공 검증 대기 |
| D-05 | 기준 실기기·회선·성능 목표 | I3 측정 후 확정 | I5 성능 판정 보류 |

키·비밀번호·전체 원본 경로는 공개 문서/스크린샷에 넣지 않는다. 준비 입력이 들어오면 사실과 제공 출처를 기록한다. 입력 부재가 I0~I2 전체를 막는 것은 아니다.

## 2. I0 — 기존 작업 보존과 최신 main 통합

- [x] I0-01 현재 branch/HEAD/status, 변경 주체와 diff를 확인하고 복원 가능한 체크포인트로 보존한다. → `17128ea` (명시 파일 128개, secret·생성물 제외 확인)
- [x] I0-02 원격 main ref를 다시 확인하고 codex/frontend-implementation에 통합한다. 기준 분석 시 ref는 8b0c88c다. → fetch 결과도 `8b0c88c`, merge commit `1b7c19b`
- [x] I0-03 .env.example·Dockerfile·main.py의 recording/SSH 변경을 모두 유지하고 자동 병합된 문서도 검수한다. (`/health`에 vespa_executor+recording, Dockerfile openssh-client+rerun 버전 assert, README/AI README 의미 검수)
- [x] I0-04 SDK 0.38.1 exporter/web, VESPA venv 0.21.0과 기존 CLIP/REST/idempotency를 보존한다. (requirements·lockfile 변경 없음)
- [x] I0-05 frontend 정적 검사·관련 Spring·AI local/SSH/recording 테스트를 실제로 실행하고 IT-01을 기록한다. (R-01; SSH 6건은 macOS BSD `stat` 환경 차이로 실패, Linux 컨테이너에서 통과 — 순수 origin/main에서도 동일)

진입 조건: 통합 기준 commit/ref와 검증 결과가 기록되어 있고 양쪽 기능이 유지된다. → 충족 (R-01).

## 3. I1 — 데이터 출처·준비 상태·오류 안내

- [x] I1-01 안정적인 DB instanceId와 dataset_provenance를 새 migration으로 추가한다. 기존 데이터는 UNKNOWN으로 다룬다. → V6, 출처는 `NUSCENES_DATA_ORIGIN`(기본 UNKNOWN)+import checksum
- [x] I1-02 Spring GET /api/system/status와 내부 AI /capabilities, 이전 /health adapter를 구현한다.
- [x] I1-03 READY/CONFIGURED/UNAVAILABLE/UNKNOWN, canExecute, reasonCode, freshness와 dataset 문맥을 검증한다. (SystemStatusTests, test_capabilities)
- [x] I1-04 환경 refresh는 읽기 검사만 수행한다. sbatch/추론/import/embedding POST가 없는지 확인한다. (가짜 AI 비허용 경로 호출 0, SSH probe 명령 검사, run 폴더 미생성, e2e job POST 0)
- [x] I1-05 backend 시작과 통합 AI 기능 초기화를 분리해 CLIP 실패 중에도 catalog/exporter가 사용 가능하도록 한다. (compose `service_started`, AI 비치명 CLIP 로딩 + `AI_REQUIRE_CLIP`; **Docker AI 이미지 빌드는 미실행**)
- [x] I1-06 테스트/출처 미확인 배지, 기능별 버튼 제어, 다시 확인과 필요한 조치를 목록/작업대에 표시한다.
- [x] I1-07 새 job/recording POST의 서버 측 준비 검증을 추가한다. 기존 동일 key 재조회는 AI 장애 중에도 보존한다.
- [x] I1-08 job/recording errorCode를 추가하고 HTTP 오류·작업 실패·상태 조회 실패를 구분한다.
- [x] I1-09 IT-02~IT-05 및 IT-07을 통과시키고 README_API에 구현된 계약만 반영한다. (IT-03은 부분 통과: 아래 표)

진입 조건: recording-harness 환경에서 VESPA 작업을 만들지 않고, AI 장애 중에도 씬 목록과 준비된 센서를 확인할 수 있다. → 충족 (R-05: 실제 Spring+하네스에서 VESPA `SYNTHETIC_DATASET` 차단, 검색 `CLIP_NOT_DEPLOYED`, 카메라·GT·recording 사용).

## 4. I2 — 요청 문맥·실행 병행·복구

- [x] I2-01 request snapshot과 UI generation, 컴포넌트 밖 receipt 기록 수명을 구현한다.
- [x] I2-02 job 성공 callback은 요청 당시 씬으로 이력을 저장하고 다른 pane/scene/generation에 연결하지 않는다.
- [x] I2-03 recording 요청도 원래 scene/job의 캐시·선택만 갱신한다. (코드·타입 검사; recording 지연 응답 전용 e2e는 없음)
- [x] I2-04 instanceId별 receipt 분리와 이전 receipt 검증/전환, 서버 교체 시 query/UI 정리를 구현한다.
- [x] I2-05 VESPA와 recording 전용 worker를 분리하고 각 실행 수·claim/token·AI lock을 유지한다.
- [x] I2-06 READY content/Viewer 실패에 같은 recording 다시 열기를 제공하고 fetch/channel/Viewer/event 자원을 정리한다.
- [x] I2-07 서버의 유실 파일 판정·조건부 상태 정정·recording 재생성을 구현한다. 일시적 접근 실패는 유실로 단정하지 않는다.
- [x] I2-08 GT/예측 토글을 카메라 범위로 명시하고 전체 3D 연동은 후속 미완료로 기록한다.
- [x] I2-09 IT-06~IT-10을 통과시키고 관련 프론트·Spring 회귀 테스트를 완료한다. (IT-10은 UI 부분 통과)

진입 조건: 지연 응답·씬 전환·동일 key 재시도·작업 병행·뷰어 복구가 실제 모델 없이 검증된다. → 충족 (R-02~R-04).

## 5. I3 — 실제 mini 센서·GT·LiDAR

- [ ] I3-01 D-01/D-02를 확인하고 테스트 DB와 분리된 실제 데이터 환경을 구성한다. 기존 volume을 삭제하지 않는다.
- [ ] I3-02 root/version/checksum, samples/sweeps/maps 및 카메라·점군 파일의 읽기를 확인하고 출처 기록을 남긴다.
- [ ] I3-03 Spring/AI의 dataset 문맥·원본 일치와 실제 미디어 전달을 확인한다.
- [ ] I3-04 서로 다른 실제 프레임의 6카메라·GT·재생/확대/분할을 확인한다.
- [ ] I3-05 실제 점군과 GT-only recording을 생성해 sample mapping·점 수·SDK pin·resize/unmount를 확인한다.
- [ ] I3-06 devkit 참고 렌더와 같은 camera/sample/GT를 대조하고 오차 기준·증거를 기록한다.
- [ ] I3-07 실제 동일 씬의 다른 프레임 및 서로 다른 씬의 A/B 독립/상대 동기화를 확인한다.
- [ ] I3-08 IT-11/IT-12, IT-13의 GT-only 부분, IT-16을 통과시키고 **A: 실제 센서 탐색 완료**만 표시한다. IT-13 예측 포함 부분은 I4에서 별도 판정한다.

진입 조건: 합성 fixture 없이 정상 미디어·정합 증거가 존재한다. CLIP/VESPA 준비를 A 완료의 전제 조건으로 추가하지 않는다.

## 6. I4 — 실제 CLIP·VESPA

- [ ] I4-01 CLIP model/preprocess/dimension과 선택 dataset embedding 수·대상 범위를 확인한다.
- [ ] I4-02 사전에 정한 검색 query/기대 결과로 실제 검색 성공을 확인한다.
- [ ] I4-03 local/SSH 실행 방식과 데이터/version 일치를 확인한다. SSH에서는 접속·command·script·config·원격 데이터 준비를 검증한다.
- [ ] I4-04 제공된 기존 COMPLETED job으로 결과의 씬·클래스·sample coverage·geometry를 확인한다.
- [ ] I4-05 신규 실제 추론 검증이 필요하면 환경/자원과 요청 범위를 확인한 뒤 별도 실행하고 상태/로그를 기록한다.
- [ ] I4-06 완료 예측을 카메라에 표시하고 같은 job의 GT/예측 recording 및 IT-13 예측 포함 부분을 검증한다.
- [ ] I4-07 IT-14/IT-15를 기록하고 기존 결과 조회만 확인한 경우 신규 추론 검증과 구분한다.
- [ ] I4-08 **B: 검색·라벨 연동 완료**는 실제 정상 결과가 확인된 범위에서만 표시한다.

## 7. I5 — 사용 검수·운영·최종 인계

- [ ] I5-01 실제 Safari와 Chromium에서 프레임·3D·분할·A/B·확대·복구·복귀를 확인한다.
- [ ] I5-02 1440/1280/1024 및 768/375, keyboard/focus/reduced-motion/screen-reader 상태 안내를 검수한다.
- [ ] I5-03 실제 이미지 기준으로 카메라 면적·방향·3D 초기 시점·기술 정보 배치를 보완한다.
- [ ] I5-04 최초/반복 로딩·프레임 준비·recording 크기·A/B 메모리·자원 해제 측정 후 목표와 비교한다.
- [ ] I5-05 RUNNING 중단/SSH 접촉 상실/유실 파일의 운영 복구 절차와 늦은 executionToken 방어를 검증한다. — 진행: [운영 복구 절차](operations-recovery.md) 작성, 늦은 결과·늦은 실패 방어 Spring 테스트 통과, 유실 파일 정정 테스트 통과. 미완: 실제 worker 중단·원격 Slurm 잔존 job 통제 실험
- [ ] I5-06 IT-17/IT-18, 관련 자동 검사, git diff --check를 완료한다.
- [ ] I5-07 README/API/체크리스트/검증 기록을 실제 구현·실행 결과와 일치시킨다. — I0~I2 범위는 반영(README_API 7·9·9-1·11장, README, frontend/AI README, rerun-recording). 실제 데이터 단계 기록은 I3 이후
- [ ] I5-08 **C: 사용 검수 완료**와 후속 미완료(전체 3D 토글·양방향 선택·자동 lease 등)를 함께 보고한다.

## 8. 검증 시나리오

각 하위 조건의 결과를 남기며 일부 통과를 행 전체 통과로 쓰지 않는다. 결과 열은 2026-10-05 기준이다.

| ID | 대상 요구 | 시나리오·통과 조건 | 환경 | 결과 (2026-10-05) |
|---|---|---|---|---|
| IT-01 | IN-01 | main 통합 후 local/SSH/recording/CLIP 계약과 pin 보존, 관련 테스트 통과 | 코드·fake AI | 통과 (R-01). SSH 6건은 macOS에서만 실패, Linux 3.12 컨테이너 17/18 통과(남은 1건은 torch 필요, macOS torch 환경에서 통과) |
| IT-02 | IN-03 | 네 상태·누락 필드·만료·refresh 실패; 환경 확인에 추론/작업 생성 없음 | API·브라우저 fixture | 통과 (R-02 SystemStatusTests·test_capabilities·e2e, R-05 실제 Spring+하네스) |
| IT-03 | IN-04 | CLIP 초기화 실패 중 catalog·카메라·GT-only exporter 사용, readiness 정확 | Spring/DB·통합 AI | **부분** — 앱 단위(AI TestClient)와 실제 Spring+recording 하네스에서 CLIP 없이 catalog·카메라·GT-only exporter 사용 확인. 제품 AI Docker 이미지에서 CLIP 실패 상황은 미실행 |
| IT-04 | IN-02,06 | SYNTHETIC/UNKNOWN/NUSCENES, 다른 DB 같은 jobId, 이전 receipt가 자동 연결되지 않음 | 실제 DB 계약+fixture | 통과 (Spring provenance·checksum 결합, receipt instance 분리·v1 이전 단위, e2e instance 교체) |
| IT-05 | IN-05 | upstream 404·연결 거부·timeout·검증/저장 실패 원인 구분, 상태 GET 오류는 job 실패 아님 | fake AI·UI | 통과 (AiErrorsTests, AutoLabelTests 404·AI 코드, e2e 안내). 실제 AI timeout 상황은 단위 예외 매핑으로만 확인 |
| IT-06 | IN-06 | 지연 POST 중 A→B·A→B→A·활성 pane 전환·언마운트; 원래 이력만 저장 | UI fixture | 통과 (e2e: 지연 POST 중 A→B, A→B→A 사용자 선택 보존, 비교 활성 패널 전환) |
| IT-07 | IN-03,06 | 응답 유실 재시도는 동일 key, 서버의 기존 job 재조회는 AI 중단 중에도 성공 | Spring/DB·UI | 통과 (AutoLabelTests: AI 장애 중 동일 key 재조회; e2e: 유실 재시도 동일 key·새 실행 새 key) |
| IT-08 | IN-07 | VESPA latch 대기 중 recording READY, 각 작업 동시 실행 상한·claim/token 보존 | Spring/DB·fake AI | 통과 (WorkerConcurrencyTests: 실제 scheduler, VESPA latch 대기 중 recording READY, VESPA 동시 1) |
| IT-09 | IN-08 | 첫 content GET/Viewer 시작 실패 후 재열기; 새 exporter/VESPA POST 0회 | 실제 SDK recording+UI | 통과 (e2e viewer: 실제 SDK 0.38.1 합성 .rrd, 첫 content 500 후 재열기, content GET 2·생성 POST 0) |
| IT-10 | IN-09 | 카메라 라벨 토글 설명·표시 일치, 다른 pane 레이어 독립, 3D 미완료 안내 | UI fixture·실제 recording | **부분** — UI fixture 통과(카메라 라벨 범위 표시·패널 독립). 실제 nuScenes recording에서 미확인 |
| IT-11 | IN-10,15 | 원본 여러 sample의 6카메라 ready/GT/시간 이동; 오류 종료만으로 통과 안 함 | 실제 mini | 미실행 (D-01). `tests/live/actual-mini.spec.ts` 준비, 합성 데이터에서 의도대로 실패 확인 |
| IT-12 | IN-12 | 동일 sample/camera/GT devkit 비교, 회전·앞/옆/뒤·경계·확대·resize 증거 | 실제 mini+devkit | 미실행 (D-01, devkit 환경) |
| IT-13 | IN-08,10,12 | I3의 실제 점군·GT-only 정합/READY/시간·선택·resize/unmount, I4의 예측 ID/sample 정합을 구분하여 판정 | 실제 mini, 예측 부분은 완료 job 추가 | 미실행 (D-01; GT-only 부분 테스트 준비됨) |
| IT-14 | IN-11 | 준비된 embedding으로 정의한 query 성공, model/preprocess·scene/sample 일치 | 실제 CLIP/DB | 미실행 (D-04) |
| IT-15 | IN-11,15 | 실제 VESPA 완료 결과 coverage/class/좌표 및 UI 연결; 신규 실행과 기존 결과 사용 구분 | local 또는 SSH VESPA | 미실행 (D-03/D-04) |
| IT-16 | IN-06,10 | 같은 씬 다른 프레임/다른 씬, 독립·상대 동기화, 활성 작업 대상 일치 | 실제 mini | 미실행 (D-01; actual-mini에 준비됨) |
| IT-17 | IN-14,15 | Safari/Chromium·해상도·접근성·실제 데이터 로딩/메모리/자원 측정 | 실제 브라우저·기준 기기 | 미실행 |
| IT-18 | IN-08,13 | worker 중단·원격 job 잔존·READY 파일 유실 복구; 중복 추론/늦은 결과 오염 없음 | 통합+통제된 fake 실행 | **부분** — 운영자 FAILED 후 늦은 결과·늦은 실패 방어, 유실 READY 파일 정정 통과. worker 강제 중단·원격 잔존 job 실험 미실행 |

## 9. 검증 기록 양식

~~~text
기록 ID / 날짜 / 수행자:
대상 요구 IN-xx / 검증 IT-xx:
branch / commit / working-tree 변경:
데이터 종류·출처 / datasetId / version / metadata checksum:
scene / sample / job / recording (없으면 해당 없음):
AI executor / model-preprocess / SDK-Web version:
browser / viewport / 기준 기기·회선:
명령 또는 사용자 조작:
기대 결과:
실제 결과 / 성공·실패·미실행 판정:
증거 경로(큰 원본·.rrd·secret은 Git 제외):
남은 문제·검증 범위:
~~~

## 9-1. 이번 검증 기록 (2026-10-05)

공통: branch `codex/frontend-implementation`, 수행 Claude Code, macOS(Apple M4) + Docker Desktop 29.2, Node 24.15, Playwright 1.63(Chromium headless), Spring 테스트는 `scripts/docker-test.sh`(temurin 21 + pgvector pg16, Gradle 9.7.1).

| 기록 | 대상 | commit / 작업 트리 | 데이터 | 명령·조작 | 결과 | 남은 범위 |
|---|---|---|---|---|---|---|
| R-01 | IT-01 / I0 | merge `1b7c19b` | 테스트 fixture, fake AI | frontend `typecheck`·`test`(48)·`build`; `docker-test.sh`(22, merge가 Spring 파일을 바꾸지 않아 Gradle up-to-date); AI `pytest tests`(macOS torch 2.10/Py3.13: 39 통과·SSH 6 실패); 같은 6건을 순수 origin/main worktree에서 재현; Linux `python:3.12-slim`에서 `test_vespa_ssh.py` 17 통과·1 torch 필요 | 병합 회귀 없음. SSH 실패는 원격 명령 `stat -c %Y`(GNU)가 macOS BSD stat에서 동작하지 않는 테스트 환경 차이 | Docker 이미지 빌드 미실행 |
| R-02 | IT-02~05,07,08,18(부분) / I1·I2 백엔드 | `4adf57b` + 이후 테스트 추가 | 테스트 fixture, fake AI(`FakeAi`) | `docker-test.sh --rerun-tasks` | Spring 32 통과 0 실패: AiErrors 1, AutoLabel 7, DatasetFiles 1, Demo 6, Recording 6, SceneSearch 7, SystemStatus 3, WorkerConcurrency 1. 로그에서 `vespa-worker-1` 대기 중 `recording-worker-1` READY 확인 | 실제 AI 미사용 |
| R-03 | IT-02,03(부분) / AI | 작업 트리 | 합성 fixture, 가짜 VESPA repo/ssh | `ai-server/.venv-recording-full`(macOS Py3.13, torch 2.10): `pytest tests` → 48 통과, 6 실패(R-01과 같은 SSH macOS 건); SSH 제외 36 통과. 신규 `test_capabilities` 9 통과(Spring checksum `1c6245…`과 동일 계산 확인) | 통과 | Docker Py3.12/torch 2.14.1 미실행 |
| R-04 | IT-02,04~07,09,10(UI) / I1·I2 프론트 | `aa4adb7` + 이후 수정 | e2e route fixture(DTO 형식), 실제 SDK 0.38.1 **합성** .rrd(`DS2L_RRD`) | `typecheck`, `npm test`(50), `build`, `test:e2e` | e2e 55 통과(1440: explore 10·jobs 11·layout 4·integration 11·viewer 3, 1280/1024/768/375 layout 각 4). integration 11건 3회 반복 33 통과 | 실제 서버·데이터 아님 |
| R-05 | IT-02, IT-03(부분) / 실제 Spring | 백엔드 이미지 재빌드(`compose.yml`+`.local/compose.local.yml`), 기존 local DB volume에 V6만 추가 적용 | `.local/nuscenes` 합성 fixture(scene-0001, sample 1), 출처 `SYNTHETIC`, checksum `0e01d4b4…` | `GET /api/system/status?datasetId=1`; `DS2L_BASE_URL=http://127.0.0.1:5174 … live.spec.ts`; `DS2L_ACTUAL=1 … actual-mini.spec.ts` | status: origin SYNTHETIC·media CONFIGURED·search UNAVAILABLE(CLIP_NOT_DEPLOYED)·vespa UNAVAILABLE(SYNTHETIC_DATASET)·recording READY(SDK 0.38.1). live 스모크 통과(6채널 ready, GT 1, 검색 차단 안내, 기존 READY recording 재사용). actual-mini는 **의도대로 실패**(origin SYNTHETIC) | 실제 nuScenes·CLIP·VESPA 없음 |

## 10. 현재 계획 문서 기록

| ID | 작업 | 결과 |
|---|---|---|
| PLAN-01 | 개선 기획서·요구/계약/단계 정리 | 문서 작성. 제품 코드 미수정 |
| PLAN-02 | 구현 체크리스트·18개 검증 시나리오 작성 | 문서 작성. 개선 구현/실제 환경 검증 미실행 |
| IMPL-01 | I0~I2 구현 (2026-10-05) | commits `17128ea`, `1b7c19b`, `4adf57b`, `aa4adb7` 및 문서/후속 수정 commit. 검증 R-01~R-05 |

### 다음 재개 지점

- 우선 재개 ID: **FU-01/FU-02**(I1/I2 검토 보완), 다음 FU-03(지연 recording 검증). 독립적인 FU-04~06과 실제 환경이 필요한 FU-07/I3-01/I4-01/I4-03을 구분해 진행한다.
- I3 시작 명령(원본 확보 후, 테스트 DB와 분리): 별도 Compose project(예: `docker compose -p ds2l-real --env-file .env.real up -d db backend` + recording 가능한 AI), `.env.real`에 `NUSCENES_HOST_PATH=<원본 root>`, `NUSCENES_VERSION=v1.0-mini`, `NUSCENES_DATA_ORIGIN=NUSCENES`, `NUSCENES_IMPORT_ENABLED=true`, 다른 `APP_PORT`/DB 포트. 이후 `DS2L_ACTUAL=1 DS2L_API=http://127.0.0.1:<port> npx playwright test -c playwright.live.config.ts tests/live/actual-mini.spec.ts`.

문서의 링크·요구 ID·검증 매핑·JSON 예시·git diff 검사를 수행한 결과는 이번 대화의 최종 보고에 기록한다. 준비 입력 및 성능 예산은 확인 후 확정한다.

## 11. I1/I2 검토 보완·후속 검증 (2026-10-06)

기준: [검토 문서](frontend-integration-audit-2026-10-06.md), [Claude Code 후속 프롬프트](claude-code-integration-followup-prompt.md). 아래 목록은 요청 시점의 작업이며, 체크는 아래 "11-1 실행 기록"에 남긴 실제 실행 결과로만 표시했다. 기존 이력(R-01~05, 검토 문서)은 그대로 둔다.

- [x] FU-01 상태 조회 실패/만료 뒤 이전 READY 사용을 수정하고 READY→오류/만료→복구, 새 POST 차단 및 기존 결과 조회를 검증한다. → IN-03, I1-03/I1-06, IT-02 보완.
- [x] FU-02 v1 및 기존 legacy v2 이력의 잘못된 DB 귀속을 막고 정상 v2 분리·이력 보존을 검증한다. → IN-06, I2-04, IT-04 보완.
- [x] FU-03 recording 지연 응답 중 씬/패널/instance/generation 변경의 회귀 검증을 추가한다. → IN-06/08, I2-03, IT-06/09 보완.
- [x] FU-04 Docker AI 이미지 build와 실제 컨테이너의 CLIP 실패 중 exporter 생존을 검증한다(R-13: 제품 Dockerfile 그대로는 arm64에서 build 불가, 의존성 2곳만 바꾼 arm64 시험 이미지로 검증. 제품 대상 amd64 image의 재검증은 **미실행**). → I1-05, IT-03의 컨테이너 미검증 부분.
- [x] FU-05 별도 fake AI/합성 데이터 환경에서 worker 중단·재시작·늦은 응답·수동 복구를 검증한다(R-08). 원격 Slurm 실험은 따로 남긴다(**미실행**, D-02/D-03 없음). → I5-05, IT-18 부분.
- [x] FU-06 합성 화면의 keyboard/focus/reduced-motion/상태 안내 기본 검수를 진행하고 실제 Safari·원본 화면 검수와 구분한다(R-09, 실제 Safari 앱·스크린리더·원본 화면 검수는 **미실행**). → I5-01/I5-02, IT-17 부분.
- [x] FU-07 D-01~04의 확보 여부와 별도 DB/volume/API·DB port/AI 구성의 실제 분리를 확인하고 준비된 범위의 I3/I4를 진행한다(R-10: 포트 분리 수정·검증, D-01~04 모두 없음 → I3/I4 **미진행**). 미확보 입력과 실제 데이터 성공 검증 대기를 기록한다.
- [ ] FU-08 변경에 맞는 회귀 검사·문서/이력 갱신·git diff --check와 A/B/C 실제 완료 여부 보고를 마친다.

FU-01/FU-02 수정과 FU-03/FU-08 검증·보고는 실제 원본 없이 진행할 필수 범위다. 나머지는 실행 환경에 따른 수행/미실행 근거를 기록한다. FU 항목의 fixture 통과만으로 A/B/C를 완료 처리하지 않는다.

### 11-1. 실행 기록 (2026-10-06, Claude Code)

공통: branch `codex/frontend-implementation`, HEAD `273b8e6` + **미커밋 작업 트리**(commit/push 안 함). macOS 26(Apple Silicon, arm64) + Docker Desktop(Compose v5.0.2), Node 24, Playwright 1.63(Chromium headless, WebKit 26.6 = playwright webkit v2359). 데이터 종류를 각 행에 표시한다. 실제 nuScenes·CLIP·VESPA 검증은 이번에 **하나도 실행하지 않았다**.

| 기록 | 대상 | 데이터 종류 | 명령·조작 | 결과 | 남은 범위 |
|---|---|---|---|---|---|
| R-06 | FU-01 | Vitest(real QueryClient + fetch mock), e2e route fixture | **재현**: 신규 `useSystemStatus.test.tsx` 4건이 수정 전 코드에서 실패(이전 READY로 `canExecute=true`). **수정**: `api/system.ts`(`currentCapability`·브라우저 시계 기준 만료·`nextStatusPollMs`), `useSystemStatus.ts`(실패=UNKNOWN/`STATUS_UNREACHABLE`, 만료=`STATUS_EXPIRED`, `lastKnown`, `recheck`), `JobPanel`/`RecordingPanel`/`SceneSearchPage`. e2e `integration.spec.ts` "FU-01" 3건(HTTP 500·연결 끊김 각각 READY→차단→마지막 확인 표시→기존 COMPLETED 결과·박스 유지→가벼운 GET 재확인(`refresh=true` 없음)→복구, refresh+GET 동시 실패) | 수정 후 unit 7, e2e 3 통과 | 실제 서버의 상태 API 장애 주입은 미실행 |
| R-07 | FU-02 | Vitest, e2e route fixture(localStorage 주입) | **재현**: 기존 migration이 서버 job 문맥 일치만으로 v1을 v2로 옮겨 다른 DB job으로 복원(테스트 실패 확인). **수정**: `lib/jobs/receipts.ts` 자동 이전 제거, `paneId='legacy'` v2 제외, `unverifiedReceiptsForScene`; `InstanceWatcher` migration 호출 제거; `JobPanel` "확인되지 않은 이전 기록 N건". `logic.test.ts` 2건, e2e "FU-02" 2건(v1 미연결·새로고침 후에도 유지·저장 보존 / legacy v2 미연결·정상 v2 job #77 복원) | 통과 | — |
| R-08 | FU-03 | e2e route fixture(recording POST 1.5~2.5초 지연) | 신규 `recording-context.spec.ts` 5건: A→B 이동, A→B→A 후 다른 job 선택, 비교 화면 활성 패널 변경, 3D 언마운트, instance 교체. 모두 POST 1회·job POST 0 확인. 2회 반복 10/10 | 통과, 제품 수정 불필요 | 실제 exporter 지연은 미실행 |
| R-09 | FU-05 | **실제 Spring image** + 격리 DB(`ds2l-fu05`, DB 55533/API 18180) + **fake AI**(호스트 stdlib 서버) + 합성 1 scene(이 격리 DB만 origin UNKNOWN으로 import: 서버의 SYNTHETIC 차단 회피, VESPA·exporter·GPU 미실행) | 6개 시나리오: 운영자 FAILED 후 늦은 성공/실패(job·recording), 호출 중 `docker kill` 후 재시작, 같은 Idempotency-Key 재요청, recording만 재생성. 상세: [운영 복구](operations-recovery.md#중단재시작늦은-응답-검증-2026-10-06-fu-05) | 32/32 통과. 한계 확인: 재시작 후 RUNNING이 운영자 정리 전까지 남음(lease 없음), 늦은 recording 파일은 root에 고아 폴더로 남음 | Seraph 잔존 job 실험 미실행(D-02/D-03) |
| R-10 | FU-06 | e2e route fixture | 신규 `tests/e2e/a11y.spec.ts`(@a11y) 6건: 키보드만으로 씬 열기·←/→·Space, 입력 중 단축키 무시, 키보드로 연 확대 대화상자 focus trap·Esc 후 focus 복귀, Tab focus의 `:focus-visible` outline(≥2px), `prefers-reduced-motion`에서 animation/transition ≤0.01s, readiness `role=status`·toast `aria-live=polite`·FU-01 사유도 같은 status, 4개 화면 보이는 control 접근 가능한 이름. `playwright.config.ts`에 `webkit-1440`(@a11y만) 추가 | Chromium·WebKit 각 6건, 3회 반복 36/36 통과. WebKit은 Safari 기본값처럼 Tab이 링크·버튼을 건너뛰어 Option+Tab으로 이동(제품 결함 아님, 기본값 차이로 기록) | 실제 Safari 앱·VoiceOver·실제 원본 화면 검수 미실행 |
| R-11 | FU-07 | 실제 로컬 Spring(합성 fixture) | 현재 `GET /api/system/status?datasetId=1`(2026-10-06T02:22Z): instance `9878f9bb…`, origin SYNTHETIC, media CONFIGURED(MEDIA_NOT_FULLY_VALIDATED), search UNAVAILABLE(CLIP_NOT_DEPLOYED), vespa UNAVAILABLE(SYNTHETIC_DATASET), recording READY; stats scenes 1·samples 1; embeddings `[]`. Compose: `compose.yml` DB 포트를 `${DB_PORT:-55433}`로 변경, `scripts/embed.sh`도 `DB_PORT` 사용, `.env.example`·README·[Docker 통합](docker-integration.md#별도-compose-project-포트-분리-2026-10-06) 갱신. dry-run으로 `up -d db backend`가 제품 ai-server도 build·시작함을 확인, override+`--no-deps`는 db·backend만. 기존 project 실행 중 `ds2l-fu05`(55533/18180) 동시 healthy, 55433 재bind 충돌 재현 | D-01~D-04 모두 없음. 실제 데이터 project 구성 방법만 준비 | I3/I4 전체, actual-mini suite 실제 데이터 실행 |
| R-12 | FU-08 회귀 | unit·e2e fixture, 합성 SDK .rrd | `npm run typecheck`; `npm test` 5 files 57; `npm run build`; `DS2L_RRD=<합성 .rrd> npm run test:e2e` 77 통과(`--list` 기준 desktop-1440 55 = explore 10·jobs 11·integration 16·recording-context 5·a11y 6·viewer 3·layout 4, layout 1280/1024/768/375 각 4, webkit-1440 a11y 6) | 통과 | Spring·AI 코드는 이번에 변경하지 않아 Spring/pytest 재실행 안 함 |

| R-13 | FU-04 | **제품 AI 이미지(arm64 시험 변형)** + **통제된 CLIP 실패 주입** + 격리 Spring(`ds2l-fu05` DB) + 합성 `.local/nuscenes` | ① 제품 `ai-server/Dockerfile` 그대로 build: 1차는 PyPI read timeout(약 2.3GB CUDA wheel 내려받던 중), 2차(`PIP_DEFAULT_TIMEOUT=300`만 추가)는 base CLIP/torch 계층 성공 후 VESPA venv에서 `open3d==0.19.0` 설치 불가: **linux/aarch64 cp312 wheel 없음**(pip가 찾은 버전 0.20.0뿐). ② 시험 변형(scratch Dockerfile, 제품 파일 미수정): VESPA venv만 `open3d==0.20.0` + apt `libgfortran5 libegl1`(0.20.0 aarch64 wheel이 링크). 원본 VESPA import 검사·rerun 0.38.1(base)/0.21.0(venv) assert 통과, image 13.9GB. ③ 실행: `HF_HUB_OFFLINE=1`·`TRANSFORMERS_OFFLINE=1` + 빈 `/models` → CLIP 가중치 로딩 실패(실패 주입. 모델 다운로드 없음) | 12/12 통과: `/livez` 200, `/health` 503(`clip not_ready`), `/capabilities` clip `UNAVAILABLE/CLIP_LOAD_FAILED`·recording READY(SDK 0.38.1), 로그에 `OfflineModeIsEnabled`→"CLIP failed to load", `/embedding/text` 503 `CLIP_NOT_READY`. Spring `refresh=true` status: catalog READY·scene 목록 200, search `UNAVAILABLE/CLIP_LOAD_FAILED`, recording READY. Spring→제품 컨테이너 **실제 exporter**로 GT-only recording #8 READY(45,067B, 1 sample·LiDAR 2000점·GT 1), Spring content `RRF2` 헤더·size 일치, 컨테이너의 rerun 0.38.1 CLI로 `world/ego`·`world/gt`·`world/lidar` 확인 | 제품 대상 amd64 image build·실행 미실행. 이 변형의 VESPA READY(Spring 판정)는 open3d가 다르고 격리 DB origin을 UNKNOWN으로 둔 결과라 의미 없음, VESPA job 미실행. 실제 nuScenes 미사용 |

**환경 사건 (2026-10-06 03:36:13–16Z)**: R-13 이미지 export 직후, 실행 중이던 container 전부(사용자 로컬 `drivescene2label-db-1`·`-backend-1`, 다른 project `dadene-db`, 시험용 `ds2l-fu05-db-1`)가 3초 안에 함께 정지했다(DB exit 0, Spring exit 137, 모두 `restart=no`). Docker VM uptime 3.4일·Desktop 프로세스 재시작 없음·VM 디스크 6%·메모리 여유·dmesg OOM 기록 없음, daemon event 기록에는 정지 사건이 남지 않아 원인은 확인하지 못했다(대용량 build/export 중 Docker engine 재시작으로 추정, 미확정). 같은 container를 `docker start`로만 되살렸고(재생성·volume 변경 없음) 로컬 서버는 같은 instance `9878f9bb…`, 같은 status·stats로 복구됨을 확인했다. 큰 AI image build는 다른 서비스가 떠 있는 Docker Desktop에서 실행하지 않는 것을 권장한다.

시험 자원(삭제하지 않음): image `ds2l-ai:fu04-arm64`(13.9GB)와 build cache, 정지된 container `ds2l-fu04-ai`·`ds2l-fu05-*`, volume `ds2l-fu05_postgres_data`. 정리하려면 사용자가 확인 후 `docker rm ds2l-fu04-ai`, `docker compose -p ds2l-fu05 down`(volume 유지) 또는 `down -v`(이 시험 DB 삭제), `docker image rm ds2l-ai:fu04-arm64`.

#### 다음 재개 (2026-10-06 기준)

- 남은 FU: FU-04의 제품 대상 amd64 image 재검증(Linux/WSL2 x86), FU-05의 Seraph 잔존 job 실험(D-02/D-03 필요), FU-06의 실제 Safari 앱·VoiceOver 검수, I5-05 자동 lease/heartbeat(후속 설계).
- 실제 데이터 단계(A/B/C 모두 **미완료**): D-01 mini 원본 root/version → I3(6카메라·여러 프레임·GT 투영·LiDAR·GT-only recording, GPU 불필요) → D-04 embedding·기존 완료 jobId → I4(신규 GPU 추론은 별도 승인).
- 실제 데이터용 project 예: `COMPOSE_PROJECT_NAME=ds2l-actual APP_PORT=18080 AI_PORT=18001 DB_PORT=55434 NUSCENES_HOST_PATH=<제공 root> NUSCENES_DATA_ORIGIN=NUSCENES NUSCENES_IMPORT_ENABLED=true docker compose --env-file .env up -d db backend`(제품 ai-server 포함) 후 `cd frontend && DS2L_ACTUAL=1 DS2L_API=http://127.0.0.1:18080 [DS2L_LIVE_ALLOW_POST=1] npx playwright test -c playwright.live.config.ts tests/live/actual-mini.spec.ts`. 합성/UNKNOWN 데이터에서는 이 suite가 실패해야 한다.
- 회귀: `cd frontend && npm run typecheck && npm test && npm run build && DS2L_RRD=<합성 .rrd> npm run test:e2e`(WebKit project는 `npx playwright install webkit` 필요).

## 12. 만료 타이머·임베딩 DB 포트 보완 (2026-10-06)

기준: [후속 검토](frontend-integration-followup-audit-2026-10-06.md), [실행 프롬프트](claude-code-expiry-dbport-prompt.md). 11장 R-06~R-13과 검토 문서는 과거 기록으로 그대로 둔다. Spring·AI 코드와 Docker image는 바꾸지 않았고 Docker build·자원 삭제·commit/push는 하지 않았다. 실제 nuScenes·CLIP·VESPA 검증이 아니며 A/B/C는 **미완료** 그대로다.

- [x] EX-01 기능별 만료 시각이 다를 때 각 시각에 화면을 다시 평가한다(FU-01 보완, I1-03/I1-06, IT-02). → R-14
- [x] EX-02 `scripts/embed.sh`가 호출 환경의 `DB_PORT`를 env 파일 값으로 덮어쓰지 않는다(FU-07 보완, I4-01). → R-15

| 기록 | 대상 | 데이터 종류 | 명령·조작 | 결과 | 남은 범위 |
|---|---|---|---|---|---|
| R-14 | EX-01 | Vitest(실제 QueryClient + fetch mock + fake timers), e2e route fixture + Playwright `page.clock` | **원인**: `useSystemStatus`의 만료 effect가 `data`에만 의존해 첫 만료 timer 뒤 다음 기능의 deadline을 예약하지 않았다. **재현(수정 전 실패)**: ① `useSystemStatus.test.tsx` 신규 1건(media/search 15초·VESPA 60초·recording 90초, 이후 GET은 응답 없이 대기): 렌더 중 기록한 값과 실제 `<button disabled>`로 확인, 62초에 VESPA가 여전히 실행 가능해 실패. ② `integration.spec.ts` 신규 "기능별 만료 시점의 화면 갱신": 실제 JobPanel `run-job-single`이 62초에도 enabled라 실패. **수정**: 마지막 평가 시각(`max(now, dataUpdatedAt, errorUpdatedAt)`) 이후의 다음 deadline을 렌더에서 계산해 effect dependency로 사용 → 만료 re-render가 다음 deadline을 예약. 평가 시각에 이미 지난 deadline은 제외(0ms timer·GET 반복 없음). 만료 시 재조회는 `cancelRefetch: false`로 진행 중 GET을 공유(hook을 쓰는 JobPanel·RecordingPanel·DataOriginBadge가 각자 timer를 가져 수정 중 e2e에서 GET 11건 증폭을 발견해 함께 수정). mock에 `status.ttlMs`·`log.statusHang` 추가 | 수정 후 unit 8/8(3회 반복 동일), 신규 e2e: 16초 VESPA·recording 허용 → 62초 VESPA 차단(`STATUS_EXPIRED`, "마지막 확인 … 준비됨", 기존 COMPLETED 결과·VESPA 박스 유지)·recording 허용 → 92초 recording 차단 → 이후 60초 동안 추가 없음, 대기 중 status GET 2건(≤3 검사)·`refresh=true` 0, "상태 다시 확인" 후 둘 다 복구, job/recording POST 0. unmount 후 timer 0개. FU-01 묶음과 함께 3회 반복 12/12 | 서버 측 POST 준비 검사는 별도(변경 없음). 실제 서버 장애 주입 미실행 |
| R-15 | EX-02 | 실제 `scripts/embed.sh`의 byte 복사본 + 임시 project 디렉터리 + docker/python stub(DB·Docker·pip·모델 접속 없음) | **재현(수정 전)**: 신규 `scripts/tests/embed-db-port.sh`로 env 파일 `DB_PORT=55433` + 호출 `DB_PORT=55434` → Python에 전달된 `PGPORT=55433`(실패). **수정**: source 전에 호출 값을 보존하고 source 뒤 복원, 미지정 시 env 파일 값, 둘 다 없으면 55433. 1~65535 숫자 검사, 해석된 `DB_PORT`를 export해 Compose 준비 확인(stub이 받은 `DB_PORT`)과 Python `PGPORT`를 일치시킴. 자격 증명·다른 변수 처리 순서는 그대로 | `bash -n` 통과. 수정 후 5/5: 호출 55434 > 파일 55433, 파일 55435만, 둘 다 없음 55433, 호출 55436 + 파일 없음, `DB_PORT=abc`는 docker/python 실행 전 종료. 각 경우 Python stub에 인자 전달 확인 | 실제 DB에 대한 임베딩 실행 미실행(D-04) |

문서: [frontend README](../frontend/README.md) 준비 상태 절, [README](../README.md) 포트 절, [Docker 통합](docker-integration.md#별도-compose-project-포트-분리-2026-10-06)(전용 `ENV_FILE`로 Compose·embed가 같은 project/DB/원본을 쓰는 방법), [임베딩 문서](legacy-catalog-and-embedding.md).

회귀(2026-10-06 이번 실행): `npm run typecheck` 통과, `npm test` 5 files 58 통과, `npm run build` 통과, `DS2L_RRD=<합성 .rrd> npm run test:e2e` 78 통과(이번 신규 e2e 1건 포함), `bash scripts/tests/embed-db-port.sh` 5/5, `git diff --check` 통과.

다음 재개: D-01(mini 원본 root/version)·D-02(실행 호스트) 확보 후 I3의 실제 6카메라·GT 투영·LiDAR·GT-only recording 검증. 그 밖의 남은 항목은 11-1 "다음 재개"와 같다.
