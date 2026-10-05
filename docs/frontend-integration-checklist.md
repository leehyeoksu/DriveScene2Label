# 실제 데이터·프론트 연동 개선 구현 체크리스트

기준: [개선 기획서 v1.0](frontend-integration-plan.md), [근거 분석](frontend-integration-review.md). 작성일 2026-10-05. 기존 M1~M6 구현 기록은 [이전 체크리스트](frontend-implementation-checklist.md)에 유지한다.

실제 착수·재개는 [Claude Code 업데이트 프롬프트](claude-code-integration-prompt.md)를 사용한다.

**현재 상태: 기획·설계 완료, 개선 구현 미착수.** 아래 빈 체크는 아직 구현/검증하지 않은 작업이다. 기존 타입 검사·fixture 통과나 이전 작업자의 보고로 새 항목을 완료 처리하지 않는다.

## 1. 준비 입력

| ID | 준비할 정보 | 현재 상태 | 미확보 시 영향 |
|---|---|---|---|
| D-01 | 실제 nuScenes root/version/원본 파일 접근 | 확인 필요 | I3 실제 데이터 완료 판정 불가 |
| D-02 | Spring·exporter를 실행할 호스트/DB/port/volume | 결정 필요 | 환경 구성 확정 필요; I1/I2 코드 작업 가능 |
| D-03 | local 실행 환경 또는 Seraph 계정·접속/원격 script·모델 | 확인 필요 | I4 신규 실제 추론 검증 불가 |
| D-04 | model/preprocess에 맞는 embedding·기존 완료 job 제공 여부 | 확인 필요 | 실제 검색/예측 성공 검증 대기 |
| D-05 | 기준 실기기·회선·성능 목표 | I3 측정 후 확정 | I5 성능 판정 보류 |

키·비밀번호·전체 원본 경로는 공개 문서/스크린샷에 넣지 않는다. 준비 입력이 들어오면 사실과 제공 출처를 기록한다. 입력 부재가 I0~I2 전체를 막는 것은 아니다.

## 2. I0 — 기존 작업 보존과 최신 main 통합

- [ ] I0-01 현재 branch/HEAD/status, 변경 주체와 diff를 확인하고 복원 가능한 체크포인트로 보존한다.
- [ ] I0-02 원격 main ref를 다시 확인하고 codex/frontend-implementation에 통합한다. 기준 분석 시 ref는 8b0c88c다.
- [ ] I0-03 .env.example·Dockerfile·main.py의 recording/SSH 변경을 모두 유지하고 자동 병합된 문서도 검수한다.
- [ ] I0-04 SDK 0.38.1 exporter/web, VESPA venv 0.21.0과 기존 CLIP/REST/idempotency를 보존한다.
- [ ] I0-05 frontend 정적 검사·관련 Spring·AI local/SSH/recording 테스트를 실제로 실행하고 IT-01을 기록한다.

진입 조건: 통합 기준 commit/ref와 검증 결과가 기록되어 있고 양쪽 기능이 유지된다. 이번 문서 작성에서 실제 merge 또는 checkpoint commit은 수행하지 않았다.

## 3. I1 — 데이터 출처·준비 상태·오류 안내

- [ ] I1-01 안정적인 DB instanceId와 dataset_provenance를 새 migration으로 추가한다. 기존 데이터는 UNKNOWN으로 다룬다.
- [ ] I1-02 Spring GET /api/system/status와 내부 AI /capabilities, 이전 /health adapter를 구현한다.
- [ ] I1-03 READY/CONFIGURED/UNAVAILABLE/UNKNOWN, canExecute, reasonCode, freshness와 dataset 문맥을 검증한다.
- [ ] I1-04 환경 refresh는 읽기 검사만 수행한다. sbatch/추론/import/embedding POST가 없는지 확인한다.
- [ ] I1-05 backend 시작과 통합 AI 기능 초기화를 분리해 CLIP 실패 중에도 catalog/exporter가 사용 가능하도록 한다.
- [ ] I1-06 테스트/출처 미확인 배지, 기능별 버튼 제어, 다시 확인과 필요한 조치를 목록/작업대에 표시한다.
- [ ] I1-07 새 job/recording POST의 서버 측 준비 검증을 추가한다. 기존 동일 key 재조회는 AI 장애 중에도 보존한다.
- [ ] I1-08 job/recording errorCode를 추가하고 HTTP 오류·작업 실패·상태 조회 실패를 구분한다.
- [ ] I1-09 IT-02~IT-05 및 IT-07을 통과시키고 README_API에 구현된 계약만 반영한다.

진입 조건: recording-harness 환경에서 VESPA 작업을 만들지 않고, AI 장애 중에도 씬 목록과 준비된 센서를 확인할 수 있다.

## 4. I2 — 요청 문맥·실행 병행·복구

- [ ] I2-01 request snapshot과 UI generation, 컴포넌트 밖 receipt 기록 수명을 구현한다.
- [ ] I2-02 job 성공 callback은 요청 당시 씬으로 이력을 저장하고 다른 pane/scene/generation에 연결하지 않는다.
- [ ] I2-03 recording 요청도 원래 scene/job의 캐시·선택만 갱신한다.
- [ ] I2-04 instanceId별 receipt 분리와 이전 receipt 검증/전환, 서버 교체 시 query/UI 정리를 구현한다.
- [ ] I2-05 VESPA와 recording 전용 worker를 분리하고 각 실행 수·claim/token·AI lock을 유지한다.
- [ ] I2-06 READY content/Viewer 실패에 같은 recording 다시 열기를 제공하고 fetch/channel/Viewer/event 자원을 정리한다.
- [ ] I2-07 서버의 유실 파일 판정·조건부 상태 정정·recording 재생성을 구현한다. 일시적 접근 실패는 유실로 단정하지 않는다.
- [ ] I2-08 GT/예측 토글을 카메라 범위로 명시하고 전체 3D 연동은 후속 미완료로 기록한다.
- [ ] I2-09 IT-06~IT-10을 통과시키고 관련 프론트·Spring 회귀 테스트를 완료한다.

진입 조건: 지연 응답·씬 전환·동일 key 재시도·작업 병행·뷰어 복구가 실제 모델 없이 검증된다.

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
- [ ] I5-05 RUNNING 중단/SSH 접촉 상실/유실 파일의 운영 복구 절차와 늦은 executionToken 방어를 검증한다.
- [ ] I5-06 IT-17/IT-18, 관련 자동 검사, git diff --check를 완료한다.
- [ ] I5-07 README/API/체크리스트/검증 기록을 실제 구현·실행 결과와 일치시킨다.
- [ ] I5-08 **C: 사용 검수 완료**와 후속 미완료(전체 3D 토글·양방향 선택·자동 lease 등)를 함께 보고한다.

## 8. 검증 시나리오

현재 모든 시나리오는 **미실행**이다. 각 하위 조건의 결과를 남기며 일부 통과를 행 전체 통과로 쓰지 않는다.

| ID | 대상 요구 | 시나리오·통과 조건 | 환경 |
|---|---|---|---|
| IT-01 | IN-01 | main 통합 후 local/SSH/recording/CLIP 계약과 pin 보존, 관련 테스트 통과 | 코드·fake AI |
| IT-02 | IN-03 | 네 상태·누락 필드·만료·refresh 실패; 환경 확인에 추론/작업 생성 없음 | API·브라우저 fixture |
| IT-03 | IN-04 | CLIP 초기화 실패 중 catalog·카메라·GT-only exporter 사용, readiness 정확 | Spring/DB·통합 AI |
| IT-04 | IN-02,06 | SYNTHETIC/UNKNOWN/NUSCENES, 다른 DB 같은 jobId, 이전 receipt가 자동 연결되지 않음 | 실제 DB 계약+fixture |
| IT-05 | IN-05 | upstream 404·연결 거부·timeout·검증/저장 실패 원인 구분, 상태 GET 오류는 job 실패 아님 | fake AI·UI |
| IT-06 | IN-06 | 지연 POST 중 A→B·A→B→A·활성 pane 전환·언마운트; 원래 이력만 저장 | UI fixture |
| IT-07 | IN-03,06 | 응답 유실 재시도는 동일 key, 서버의 기존 job 재조회는 AI 중단 중에도 성공 | Spring/DB·UI |
| IT-08 | IN-07 | VESPA latch 대기 중 recording READY, 각 작업 동시 실행 상한·claim/token 보존 | Spring/DB·fake AI |
| IT-09 | IN-08 | 첫 content GET/Viewer 시작 실패 후 재열기; 새 exporter/VESPA POST 0회 | 실제 SDK recording+UI |
| IT-10 | IN-09 | 카메라 라벨 토글 설명·표시 일치, 다른 pane 레이어 독립, 3D 미완료 안내 | UI fixture·실제 recording |
| IT-11 | IN-10,15 | 원본 여러 sample의 6카메라 ready/GT/시간 이동; 오류 종료만으로 통과 안 함 | 실제 mini |
| IT-12 | IN-12 | 동일 sample/camera/GT devkit 비교, 회전·앞/옆/뒤·경계·확대·resize 증거 | 실제 mini+devkit |
| IT-13 | IN-08,10,12 | I3의 실제 점군·GT-only 정합/READY/시간·선택·resize/unmount, I4의 예측 ID/sample 정합을 구분하여 판정 | 실제 mini, 예측 부분은 완료 job 추가 |
| IT-14 | IN-11 | 준비된 embedding으로 정의한 query 성공, model/preprocess·scene/sample 일치 | 실제 CLIP/DB |
| IT-15 | IN-11,15 | 실제 VESPA 완료 결과 coverage/class/좌표 및 UI 연결; 신규 실행과 기존 결과 사용 구분 | local 또는 SSH VESPA |
| IT-16 | IN-06,10 | 같은 씬 다른 프레임/다른 씬, 독립·상대 동기화, 활성 작업 대상 일치 | 실제 mini |
| IT-17 | IN-14,15 | Safari/Chromium·해상도·접근성·실제 데이터 로딩/메모리/자원 측정 | 실제 브라우저·기준 기기 |
| IT-18 | IN-08,13 | worker 중단·원격 job 잔존·READY 파일 유실 복구; 중복 추론/늦은 결과 오염 없음 | 통합+통제된 fake 실행 |

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

## 10. 현재 계획 문서 기록

| ID | 작업 | 결과 |
|---|---|---|
| PLAN-01 | 개선 기획서·요구/계약/단계 정리 | 문서 작성. 제품 코드 미수정 |
| PLAN-02 | 구현 체크리스트·18개 검증 시나리오 작성 | 문서 작성. 개선 구현/실제 환경 검증 미실행 |

문서의 링크·요구 ID·검증 매핑·JSON 예시·git diff 검사를 수행한 결과는 이번 대화의 최종 보고에 기록한다. 준비 입력 및 성능 예산은 확인 후 확정한다.
