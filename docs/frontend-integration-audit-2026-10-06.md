# I0~I2 구현 보고 검토

검토일: 2026-10-06. 대상: `codex/frontend-implementation`, HEAD `273b8e6`.

## 판정

main 통합, 준비 상태 API, 요청 snapshot, worker 분리, recording 복구 구현은 확인했다. 실제 데이터가 없어 A/B/C 완료를 선언하지 않은 보고 방식도 타당하다. 다만 아래 두 문제를 보완하기 전에는 I1/I2의 해당 검증 항목을 완전히 종료한 것으로 보지 않는다.

이번 검토에서는 제품 코드를 변경하지 않았다. 검토 시작 시 Git 작업 트리는 깨끗했으며, 이 검토 문서만 추가한다. 커밋/푸시는 수행하지 않는다.

## 직접 확인한 범위

| 확인 | 결과 | 증거 범위 |
|---|---|---|
| Git 이력 | checkpoint `17128ea`, main merge `1b7c19b`, 후속 구현 HEAD `273b8e6` 확인 | 로컬 Git 이력. 원격 최신 상태나 push 여부를 별도로 조회하지 않음 |
| 프론트 정적 검사 | `npm run typecheck`, `npm run build` 통과 | 현재 작업 트리 |
| 프론트 단위 테스트 | `npm test`: 50개 통과 | 기존 테스트 4개 파일 |
| AI 준비 상태 테스트 | `.venv-recording-full/bin/python -m pytest tests/test_capabilities.py -q`: 9개 통과 | macOS Python 3.13, 가짜 VESPA/SSH 및 TestClient. 실제 AI Docker 이미지 검증 아님 |
| 요청 문맥 고정 | scene/pane/generation/instance 조건과 컴포넌트 밖 receipt 저장 확인 | 소스 검토. 전체 브라우저 테스트는 이번 검토에서 다시 실행하지 않음 |
| worker 분리 | VESPA/recording 전용 scheduler, 각각 pool size 1 확인 | 소스 검토. Spring 32개 테스트 결과는 이번에 재실행하지 않음 |
| 현재 서버 상태 | 실제 로컬 Spring `GET /api/system/status?datasetId=1` 조회 | 2026-10-06 10:42 KST 응답 |

## 현재 화면의 데이터 상태

| 항목 | 실제 로컬 응답 |
|---|---|
| dataset | `v1.0-mini`, `origin=SYNTHETIC`, `mediaValidation=PARTIAL` |
| catalog | `READY`, 조회 가능 |
| media | `CONFIGURED`, `MEDIA_NOT_FULLY_VALIDATED`, 조회 가능 |
| search | `UNAVAILABLE`, `CLIP_NOT_DEPLOYED` |
| VESPA | `UNAVAILABLE`, `SYNTHETIC_DATASET` |
| recording | `READY`, 생성 가능 |

실제 nuScenes 영상과 점군을 연결한 상태는 아니다. recording READY도 합성 데이터의 recording을 생성할 수 있다는 뜻이다. 데이터셋 version 문자열만 보고 원본 mini가 준비됐다고 판단해서는 안 된다.

## 보완 1: 상태 조회 실패 뒤 이전 READY 사용

- 위치: `frontend/src/features/system/useSystemStatus.ts:26`.
- 연결 요구: IN-03, I1-03/I1-06, IT-02.
- 현재 `capability()`는 `q.data`를 `q.isError`보다 먼저 확인한다.
- TanStack Query는 재조회 실패 시 이전 성공 데이터를 보존한다. 따라서 준비 상태가 READY였던 뒤 `/api/system/status`가 실패해도 반환 capability가 `READY/canExecute=true`일 수 있다. 이 훅은 capability의 `expiresAt`도 판정하지 않는다.
- 재현: 설치된 `QueryClient/QueryObserver`로 첫 조회 READY, 다음 조회 예외를 발생시켰다. 결과는 `isError=true`, 이전 data 보존, 현재 훅과 같은 분기의 반환값은 `READY/canExecute=true`였다. 실제 페이지의 클릭 흐름까지 실행한 재현은 아니다.
- 영향: 상태를 확인할 수 없는 동안 검색/새 작업/새 recording 버튼과 안내가 이전 준비 상태를 계속 사용할 수 있다. 서버 측 새 요청 검증은 별도로 남아 있으므로, 이 결과만으로 실제 VESPA가 실행됐다고 판단하지 않는다.
- 수정 방향: 조회 오류를 우선 반영하고, 만료된 capability는 재확인 전 UNKNOWN 또는 실행 불가로 다룬다. 이전 데이터는 마지막 확인 정보로 보존할 수 있지만 현재 실행 가능 판정에는 사용하지 않는다. 기존 작업 상태/READY 파일 재조회는 계속 제공한다.
- 추가 검증: READY → 상태 API 연결 실패/500, 성공 응답의 만료, 수동 refresh와 후속 GET 모두 실패, 정상 재확인으로 복구. 새 작업 POST 0회와 기존 결과 조회 가능을 함께 확인한다.

## 보완 2: 구버전 receipt의 DB 귀속 확인 부족

- 위치: `frontend/src/lib/jobs/receipts.ts:109`, 호출부 `frontend/src/features/system/InstanceWatcher.tsx`.
- 연결 요구: IN-06, I2-04, IT-04.
- v1 receipt는 원래 DB의 instanceId가 없다. 현재 migration은 같은 `jobId`에 대해 `datasetId`와 `sceneToken`만 같으면 새 instanceId를 붙여 v2로 저장한다.
- 같은 nuScenes를 새 DB에 다시 import하면 datasetId/sceneToken이 동일할 수 있고, 서로 다른 요청에 jobId도 다시 배정될 수 있다. 이 조건만으로 같은 요청임을 증명할 수 없다.
- 재현: 실제 receipt 모듈을 Vite SSR로 로드하고 메모리 localStorage에 v1 기록을 넣었다. 새 DB lookup이 같은 datasetId/sceneToken만 반환하자 `moved=1`, 새 instanceId로 저장됐고 원래의 `old-db-request-key`와 요청 시간이 그대로 남았다. 실제 DB를 교체한 브라우저 재현은 아니다.
- 영향: 이전 DB의 요청 이력이 새 DB의 다른 작업 이력으로 표시될 수 있다. 신규 v2 receipt의 instance 분리 구현과는 별개의 구버전 이전 경로 문제다.
- 수정 방향: 출처를 입증할 수 없는 v1 기록은 미확인 이력으로 보존하고 자동 귀속하지 않는다. 자동 이전이 필요하면 서버에서 동일 요청을 확인할 수 있는 계약을 먼저 마련하고 Idempotency-Key 등 요청 식별자를 대조한다. dataset checksum/클래스가 같은 것만으로 같은 요청을 증명할 수는 없다.
- 추가 검증: 다른 DB + 같은 datasetId/sceneToken/jobId + 다른 요청, 일치 입증 가능한 요청, 조회 실패/404, 재시도. 미확인 이력은 새로운 scoped 이력을 덮어쓰지 않아야 한다.

## 데이터 확보와 별개로 진행할 검증

- 위 두 문제의 수정과 회귀 검증.
- 지연 recording 응답 중 씬/패널/서버 변경 검증. 기존 보고는 코드·타입 확인이며 전용 e2e는 없다고 명시한다.
- Docker AI 이미지 build 및 실제 컨테이너의 CLIP 초기화 실패 중 exporter 생존 확인. 실제 mini 없이 수행 가능하지만 이미지 다운로드/빌드 자원과 모델 로딩 설정을 고려해야 한다.
- 가짜 AI 또는 합성 데이터에서 worker 중단, 늦은 응답, 수동 복구 절차 검증. 원격 Slurm 잔존 job 실험은 실제 서버 접속이 필요하다.
- 합성 화면의 키보드/focus/reduced-motion 기본 검수. 실제 이미지·점군의 시각 검수와 성능 완료 판정은 실제 데이터로 진행한다.

## 실제 연동 재개 순서

1. I1/I2 두 보완점과 회귀 검증을 정리한다.
2. D-01/D-02: nuScenes mini 원본 root/version과 실행 머신을 확인한다. Spring과 exporter가 동일 원본 파일을 읽게 하고, 테스트 DB와 다른 Compose project/volume/port로 준비한다.
3. I3: 6카메라, 여러 프레임, GT 투영, LiDAR와 GT-only recording을 확인한다. 이 단계는 GPU 추론 없이 진행할 수 있다. 실제 데이터를 사용한 정상 결과 테스트와 devkit 대조로 A 완료를 판정한다.
4. D-03/D-04: CLIP 모델/embedding 및 VESPA local 또는 Seraph 실행 환경을 확인한다. 기존 COMPLETED job이 있다면 먼저 결과 연결과 표시를 검증하고 신규 추론 검증과 구분한다.
5. I4/I5: 실제 검색/예측과 Safari·접근성·성능·운영 복구를 검증한 범위에서 B/C 완료를 판정한다.

현재 API에 실제 모델과 데이터가 없다는 환경 문제와 위 두 클라이언트 보완점을 구분해서 진행한다. main 병합만 되돌리거나 프론트를 전면 재작성할 근거는 이번 검토에서 확인되지 않았다.
