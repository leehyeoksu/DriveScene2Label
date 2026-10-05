# DriveScene2Label 실제 데이터·프론트 연동 개선 기획서

| 항목 | 기준 |
|---|---|
| 버전·날짜 | v1.0 · 2026-10-05 (Asia/Seoul) |
| 목적 | 기존 React 구현을 실제 카메라·LiDAR·GT·검색·VESPA 환경에서 사용할 수 있도록 보완 |
| 작업 기준 | codex/frontend-implementation, HEAD 501da08 및 현재 미커밋 구현 |
| 통합 대상 | 확인된 origin/main 8b0c88c, VESPA SSH executor PR #3 |
| 제품·디자인 | [기존 제품 기획서](frontend-product-plan.md), [디자인 기준](frontend-design/README.md) 유지 |
| 근거 | [연동 개선 분석](frontend-integration-review.md) |
| 실행·검증 추적 | [개선 구현 체크리스트](frontend-integration-checklist.md) |
| 구현 실행·재개 | [Claude Code 업데이트 프롬프트](claude-code-integration-prompt.md) |
| 현재 계약 | [REST API](../README_API.md), [Rerun 계약](rerun-recording.md) |
| 이번 문서 작업의 범위 | 기획·설계·문서 정립. 실제 merge·코드 수정·데이터 import·모델 실행은 이후 구현 단계 |

이 기획서는 기존 기획서의 화면·기능 요구를 유지하면서 환경 연결, 준비 상태, 오류, 비동기 처리, 실제 성공 검증 기준을 보완한다. 이번 개선 범위에서 내용이 충돌하면 이 문서의 명시적 결정이 우선한다. 아래 신규 API·DB·환경변수·테스트는 **구현할 설계**이며 이미 존재하거나 검증된 기능으로 취급하지 않는다.

## 1. 목표와 완료 단계

목표 경험은 실제 장면을 열어 6개 카메라·GT·점군을 확인하고, 여러 프레임을 이동하며, 사용 가능한 검색/VESPA 기능으로 얻은 결과를 같은 sample에서 비교하는 것이다.

| 단계 | 사용자에게 제공할 경험 | 완료에 필요한 증거 |
|---|---|---|
| A: 센서 탐색 완료 | 실제 6카메라, 확대, 여러 프레임, GT, LiDAR, 두 씬 비교 | 실제 nuScenes 원본으로 카메라·점군 표시와 시간/좌표 정합 검증 |
| B: 검색·라벨 연동 완료 | 준비된 검색, 씬 전체 라벨 생성/기존 완료 결과, 예측 비교 | 실제 CLIP 검색 성공, 실제 VESPA 완료 결과, GT/예측 recording READY |
| C: 사용 검수 완료 | 오류 복구·작업 전환·Safari·접근성·성능 | 정상 기능 성공과 장애 복구를 구분한 검증 기록 |

A는 CLIP/VESPA가 없어도 완료할 수 있어야 한다. B가 남아 있으면 A만 완료했다고 보고한다. 합성 fixture, mock API, 실패 화면의 정상 표시를 실제 성공으로 기록하지 않는다.

### 유지할 구현

- React/TypeScript/Vite, React Router, TanStack Query, Zustand, Tailwind/shadcn, Rerun SDK/Viewer 0.38.1과 lockfile을 유지한다. 이번 개선을 위해 일괄 업그레이드하지 않는다.
- 씬 목록·작업대·A/B 비교, 다크 테마, GT/예측 구분, 카메라 방향, 분할/확대, 패널별 상태를 유지한다.
- WORLD 미터, size W/L/H, quaternion W/X/Y/Z, 카메라별 pose/calibration, timestampUs, 동일 실행의 Idempotency-Key를 유지한다.
- 브라우저는 Spring /api만 호출한다. SSH·FastAPI·DB 접근과 인증 정보는 프론트에 두지 않는다.

### 이번 필수 범위와 후속 범위

| 이번 필수 | 후속·별도 판정 |
|---|---|
| 최신 main 통합, 실제 데이터 환경 구분, 준비 상태 계약, 정확한 오류 | SSH/Slurm 상세 executionPhase와 진행 이벤트 |
| 요청 snapshot, 병행 worker, recording 다운로드/열기 재시도 | 클러스터의 실행별 output 및 다중 사용자 직렬화 개선 |
| 실제 mini 성공 경로·devkit 정합·Safari·접근성·성능 검수 | 자동 heartbeat/lease 복구, 작업 취소·수동 라벨 편집·평가 |
| 중단 작업과 유실 recording의 운영 복구 절차 | 3D GT/예측 전체 연동 토글·목록→3D 선택 강조의 기술 검증 후 구현 |

이번 전달에서 GT/예측 버튼은 **카메라 라벨 표시**로 명확히 제한한다. 기존 기획서의 전체 3D 상호작용 목표는 후속 미완료로 남긴다. 기술 검증 없이 기존 SDK에서 가능하다고 가정하거나 지원 범위가 바뀐 것을 숨기지 않는다.

## 2. 현재 사실과 준비 입력

현재 확인된 환경은 합성 씬 1개·프레임 1개, recording-harness의 CLIP not_loaded/VESPA not_configured다. 새 SSH PR은 2026-10-05 02:27 한국 시간에 병합되었으나 현재 작업 코드와 하네스에는 반영되지 않았다. 상세 증거와 재현 범위는 분석서를 따른다.

| 필요한 입력 | 현재 판정 | 없을 때 진행할 작업 |
|---|---|---|
| 실제 nuScenes 원본 위치·버전·파일 읽기 권한 | 확인 필요 | 준비 상태·오류·비동기·worker fixture 구현 |
| 원본을 제공할 Spring 호스트 | 결정 필요: 개발 PC 또는 팀 서버 | 주소를 변수로 두고 같은-origin proxy 계약 유지 |
| Seraph 접속 권한·접속 방식·원격 VESPA 준비 | 확인 필요 | local/ssh 공통 계약과 fake SSH 검증 |
| CLIP weights·선택 dataset의 embedding | 준비 확인 필요 | 목록 탐색 유지, 검색 미지원 상태 구현 |
| 기존 실제 COMPLETED job과 결과 | 제공 가능 여부 확인 필요 | fixture 성공/실패 검사; 실제 결과 완료 판정은 보류 |

사용자의 입력이 도착하면 이 표와 환경 체크리스트를 갱신한다. 실제 원본·접속 권한 부재 때문에 가능한 코드 보완 전체를 중단하지 않는다. 대규모 데이터/모델 다운로드나 신규 원격 GPU 추론은 준비 조건과 사용자 요청 범위를 별도로 확인한다.

## 3. 목표 구조와 실행 환경

~~~mermaid
flowchart LR
  UI[React] --> API[Spring /api]
  API --> DB[PostgreSQL]
  API --> MEDIA[nuScenes 원본 파일]
  API --> AI[통합 FastAPI]
  AI --> CLIP[CLIP]
  AI --> LOCAL[로컬 VESPA]
  AI --> SSH[SSH / Slurm VESPA]
  AI --> EXPORT[recording exporter]
  EXPORT --> MEDIA
  EXPORT --> RRD[공유 .rrd 저장소]
  API --> RRD
  API --> VIEW[React Rerun Viewer]
~~~

로컬/SSH VESPA는 선택 실행 방식이다. SSH는 결과 JSON을 가져오는 기능이며 카메라와 점군 원본을 공급하는 기능이 아니다. 센서 파일을 제공하는 Spring과 exporter는 선택 dataset의 동일 원본에 접근할 수 있어야 한다.

### 환경 구분

| 환경 | 데이터·AI | 허용·표시 |
|---|---|---|
| 테스트 | 합성 fixture·fake AI·recording 하네스 | 항상 테스트 배지. 실제 성공 판정 제외. 실제 VESPA 실행 금지 |
| 실제 센서 검증 | 실제 mini·Spring/DB·exporter | 원본 센서/GT 탐색. 검색/VESPA 준비되지 않으면 해당 기능만 차단 |
| 실제 추론 검증 | 위 환경 + CLIP/embedding + local 또는 SSH VESPA | 준비 검사 이후 실행, 실제 결과·로그 기록 |

- 실제 데이터 검증은 테스트 환경과 **별도 DB/volume 또는 별도 Compose project**를 사용한다. 포트와 recording/model/results volume도 충돌 여부를 확인한다.
- 현재 dataset은 UNIQUE(name,version)이며 importer는 checksum이 다른 동일 버전의 재import를 거부한다. 합성 v1.0-mini를 저장한 DB에 root만 바꾸어 실제 mini를 덮어쓰지 않는다.
- 기존 volume을 삭제하거나 기존 migration을 수정해서 문제를 해결하지 않는다. 신규 환경과 기존 기록을 보존한다.
- Spring은 DB가 준비되면 catalog를 제공한다. Compose의 backend 시작 조건이 AI 전체 health를 필수로 기다리지 않도록 수정한다.
- 통합 AI도 기능별 초기화/실패 상태를 분리한다. CLIP weights 로드 실패 때문에 준비된 exporter까지 종료되지 않게 한다. 기존 모델 정리·lock·실패 코드 규칙을 유지한다.
- 실제 실행에서 .local/compose.local.yml의 recording-only override를 제품 AI/Seraph 구성과 혼용하지 않는다.
- DB instanceId를 안정적으로 제공하고 receipt/query/UI 문맥을 구분한다. 서버 재시작에 따라 바뀌는 ID는 사용하지 않는다. 테스트 DB에서 만든 jobId=2와 실제 DB의 jobId=2를 동일 작업으로 복원하지 않는다.

## 4. 최신 main 통합 설계

구현 착수 첫 단계는 기존 미커밋 구현을 검토·검증 가능한 체크포인트로 보존한 뒤 작업 브랜치에 최신 origin/main을 통합하는 것이다. merge 시점의 실제 ref와 변경 목록을 다시 확인한다.

| 충돌 예상 파일 | 보존할 내용 |
|---|---|
| .env.example | recording 설정 + SSH 설정. 실제 값·키 없음 |
| ai-server/Dockerfile | exporter 의존성/복사 + openssh-client. VESPA venv pin 보존 |
| ai-server/main.py | recording router/service/handler/health + vespa_executor |
| README·AI README | 양쪽 기능과 실행 범위 검수; 텍스트 자동 병합을 완료 판정으로 쓰지 않음 |

통합 후 local VESPA·SSH VESPA·recording·CLIP 테스트를 함께 실행한다. 샘플 수·테스트 개수는 실제 발견/실행 결과로 기록하며 이전 보고 숫자를 합산하지 않는다. 원격 upstream VESPA를 임의 수정하지 않는다.

## 5. 요구사항

| ID | 요구사항 | 완료 조건 |
|---|---|---|
| IN-01 | upstream SSH 기능과 프론트/recording 통합 | 양쪽 기능·pin·REST 계약 유지, 관련 테스트 통과 |
| IN-02 | 실제/합성/출처 미확인 데이터 구분 | 버전/씬 개수로 추정하지 않으며 모든 주요 화면에 명확히 표시 |
| IN-03 | 기능별 준비 상태와 실행 제어 | catalog/media/search/VESPA/recording 상태 독립, 미지원 실행 차단 |
| IN-04 | 센서·exporter의 AI 독립성 | CLIP/VESPA 없이도 실제 카메라·GT·GT-only recording 사용 |
| IN-05 | 오류 원인 보존 | 404/연결 실패/timeout/설정/결과 검증·저장 오류 구분 |
| IN-06 | 비동기 요청 문맥 고정·서버 구분 | 원래 씬 receipt 보존, 바뀐 pane/DB에 다른 작업 연결 금지 |
| IN-07 | 작업 병행·자원 제한 | 긴 VESPA 동안 recording 실행, AI lock·DB claim 보존 |
| IN-08 | recording 생성/파일/뷰어 복구 구분 | 열린 READY 파일 재시도는 새 exporter/VESPA 실행 없음 |
| IN-09 | 라벨 토글·선택 범위 명확화 | 카메라 토글 설명과 동작 일치, 3D 연동 미완료 별도 표기 |
| IN-10 | 원본 미디어·프레임 정합 | 실제 서로 다른 sample의 이미지·GT·점군을 섞지 않음 |
| IN-11 | 실제 검색·라벨 성공 | CLIP/embedding 문맥 및 VESPA COMPLETED 결과 검증 |
| IN-12 | 투영·3D 기준 검증 | 동일 sample의 devkit 비교·축/회전/clipping 기록 |
| IN-13 | 중단·파일 유실 운영 복구 | 무조건 새 GPU 작업을 실행하지 않는 복구 절차와 늦은 결과 방어 |
| IN-14 | 사용성·성능·접근성 | Safari 포함 실제 데이터 검수, 키보드/포커스/상태 안내, 성능 측정 |
| IN-15 | 완료 판정·기록·문서 | 정상 성공/장애 복구/fixture/실제 데이터를 구분하여 기록 |

## 6. 화면·행동 설계

| 상황 | 씬 목록/작업대 표시 | 가능한 행동 |
|---|---|---|
| 합성 데이터 | 상단 테스트 데이터 배지 + 실제 주행 원본 아님 안내 | fixture 탐색; 실제 VESPA 버튼 차단 |
| 출처 미확인 | 데이터 출처 미확인 배지 | 목록·미디어 탐색 가능, 실제 데이터 완료 판정 제외 |
| 이미지 정상·CLIP 없음 | 카메라/GT 그대로, 검색 준비 안 됨 | 목록 탐색·프레임·확대·비교 |
| CLIP 정상·embedding 없음 | 이 데이터셋의 검색 인덱스 준비 안 됨 | 목록 탐색·환경 다시 확인 |
| VESPA 미지원/설정 누락 | 라벨 버튼 비활성 + 필요한 조치 | 기존 완료 결과 조회·센서 탐색 |
| VESPA 설정만 확인됨 | 실행 환경 확인 필요 + 환경 확인 버튼 | 가벼운 준비 검사; 자동 추론 시작하지 않음 |
| 준비 검사 통과 | 라벨 생성 활성, local/원격 실행 구분 | 명시적 사용자 실행으로 새 job 생성 |
| 상태 조회 실패 | 연결 확인 불가, 마지막 확인 시각 | 다시 확인; job FAILED로 바꾸지 않음 |
| 파일 누락·decode·calibration/pose 문제 | 해당 채널에 구체적 안내 | 다른 센서 계속 사용, 대상만 재조회 |
| recording 생성 실패 | 3D 데이터 생성 실패 | recording만 다시 생성 |
| READY 파일/Viewer 열기 실패 | 3D 보기를 열지 못함 | 같은 recording 다시 열기 |

- 기술 상세(WORLD 변환·SDK 버전·내부 경로)는 정보 영역에 둔다. 선택 씬·현재 프레임·표시 결과 job·데이터 출처를 우선 표시한다.
- 초기 보기에서 점군과 GT를 찾을 수 있도록 실제 데이터 기준으로 시점을 검수한다. 시점 초기화와 분할 배치 초기화를 구분한다. SDK 지원 여부를 확인한 뒤 시점 제어를 확정한다.
- 6카메라 기본 3×2와 좁은 분할 2×3을 유지하고 실제 이미지의 가독성을 비교한다. 부족하면 우측 패널 접기·카메라 확대를 우선 활용한다.
- 타임라인은 실제 timestampUs 기반이며 sample 1개이면 재생을 비활성화하고 이유를 알 수 있게 한다.
- 새 작업이 실패해도 기존 완료 결과는 유지하고 현재 표시하는 jobId를 명시한다.

## 7. 신규 준비 상태 API 설계

### Spring: GET /api/system/status

신규 계약이다. query의 datasetId는 선택적인 양의 정수이며 refresh는 기본 false다. datasetId 지정 시 해당 데이터의 준비 상태를 평가한다. 잘못된 값은 400, 없는 dataset은 404다. 상태 조회 자체가 성공하면 200이며 일부 기능 미지원은 capability로 표현한다. DB/API 자체가 요청을 처리할 수 없으면 기존 오류 계약을 사용한다.

~~~json
{
  "schemaVersion": 1,
  "instanceId": "00000000-0000-4000-8000-000000000001",
  "checkedAt": "2026-10-05T00:00:00Z",
  "dataset": {
    "id": 7,
    "version": "v1.0-mini",
    "origin": "UNKNOWN",
    "metadataChecksum": "0000000000000000000000000000000000000000000000000000000000000000",
    "mediaValidation": "NOT_CHECKED"
  },
  "capabilities": {
    "catalog": {"state": "READY", "canExecute": true, "reasonCode": null},
    "media": {"state": "CONFIGURED", "canExecute": true, "reasonCode": "MEDIA_NOT_FULLY_VALIDATED"},
    "search": {"state": "UNAVAILABLE", "canExecute": false, "reasonCode": "EMBEDDINGS_NOT_READY"},
    "vespa": {"state": "CONFIGURED", "canExecute": false, "reasonCode": "EXECUTOR_NOT_CHECKED", "executor": "ssh"},
    "recording": {"state": "READY", "canExecute": true, "reasonCode": null}
  }
}
~~~

계약 설명용 예시다. UUID·datasetId·checksum은 실제 값이 아니며 현재 응답을 나타내지 않는다. datasetId를 지정하지 않으면 dataset=null이다. capability에는 checkedAt/expiresAt/message를 제공하며 message는 한국어 안내다. 내부 경로·키·개인 접속 정보를 반환하지 않는다.

| state | 의미 | 행동 정책 |
|---|---|---|
| READY | 해당 기능의 가벼운 필수 조건 검사를 통과 | canExecute=true일 때 실행. 실제 추론 성공을 보장하는 뜻은 아님 |
| CONFIGURED | 설정 존재는 확인했지만 필요한 연결/데이터 검사 미완료 | VESPA/생성은 canExecute=false, 환경 확인 안내. 미디어 읽기는 가능한 경우 허용 |
| UNAVAILABLE | 미지원 API 또는 확인된 설정/데이터/연결 누락 | 실행 차단, reasonCode로 필요한 조치 표시 |
| UNKNOWN | 조회 실패·이전 서버·정보 부족 | 재확인. 기존 결과/파일 조회는 계속 제공 |

- origin은 SYNTHETIC/NUSCENES/UNKNOWN이다. 명시적 import 설정과 checksum에 연결한 출처 기록에서 읽는다. 이름·version·sample 개수로 추정하지 않는다.
- mediaValidation은 NOT_CHECKED/PARTIAL/VERIFIED/FAILED다. origin=NUSCENES만으로 전체 파일 존재나 원본 진위가 검증됐다고 판단하지 않는다.
- search는 CLIP modelName/preprocess/dimension과 선택 dataset의 embedding을 대조한다. images>0을 전체 대상 coverage 검증으로 취급하지 않는다.
- VESPA는 대응 API·executor 설정·선택 데이터 일치를 확인한다. SSH에서는 연결·필수 command/script/config/metadata를 읽기 전용으로 검사한다. local에서는 실행 runtime/config/metadata를 검사한다. GPU 유무만으로 판정하지 않는다.
- recording은 대응 API·SDK/export 설정·공유 저장소 쓰기 준비·선택 데이터를 확인한다. 기존 READY recording 열기는 생성 기능 미지원 상태에서도 허용한다.
- 일반 GET은 가벼운 정보와 캐시를 반환한다. refresh=true는 사용자의 명시적 환경 재확인에 사용하며 추론·sbatch·embedding 생성·import를 실행하지 않는다.
- 캐시는 datasetId/checksum/instanceId/executor로 구분한다. 일반 화면 상태 조회는 30초, 숨겨진 탭에서는 중단한다. 서버에서 검사를 중복 실행하지 않으며 SSH 검사에는 짧은 시간 상한을 둔다. refresh 실패 후 만료된 READY를 사용하지 않는다.
- 새 job/recording POST에서도 준비 조건을 확인한다. GET 판정만 신뢰하지 않는다. 동일 Idempotency-Key의 기존 job은 AI 중단 중에도 반환할 수 있도록 reuse 확인을 먼저 한다. 외부 조회 중 DB transaction을 유지하지 않는다.
- 이전 AI /health의 configured를 READY로 바꾸지 않는다. 정보가 없는 기능은 UNKNOWN 또는 명시적인 UNAVAILABLE로 처리하고 mock로 자동 대체하지 않는다.

### 내부 AI 능력 계약

FastAPI에 GET /capabilities를 추가한다. clip·vespa·recording 지원 여부와 설정 상태, model/SDK/export version, executor, 설정 dataset version/checksum을 반환한다. Spring 내부 호출 전용이며 브라우저는 직접 호출하지 않는다. 이전 AI에는 /health adapter를 사용하고 누락된 필드를 준비 완료로 처리하지 않는다.

생존 확인과 기능 준비 상태를 분리한다. CLIP 초기화 실패를 exporter에 일괄 전파하지 않는다. 현재 /health의 전체 상태를 바꿀 경우 기존 소비자와 Docker healthcheck도 함께 검수한다. 필요하면 별도 생존 확인 경로를 추가하고 기존 readiness 의미는 유지한다.

## 8. DB·오류 호환성 설계

구현 시 최신 migration 번호를 확인하고 새 migration을 추가한다. 현재 V5 다음 번호를 사용하는 구상이며 기존 V1~V5는 수정하지 않는다.

| 변경 | 목적·호환성 |
|---|---|
| system_instance의 안정적인 UUID | DB 환경별 receipt/query 구분. 재시작할 때 바뀌지 않음 |
| dataset_provenance(dataset_id,origin,metadata_checksum,validated_at) | checksum에 대응하는 출처. 기존 행에 기록이 없으면 UNKNOWN |
| auto_label_job.error_code | 기존 failure_reason/status를 유지하는 추가 필드 |
| scene_recording.error_code | 생성/파일/검증 실패 식별. 기존 DTO 필드 유지 |

출처 설정 이름은 NUSCENES_DATA_ORIGIN, 기본 UNKNOWN으로 설계한다. SYNTHETIC은 개발 테스트에서 사용하고 NUSCENES를 지정해도 metadata/files 검사를 생략하지 않는다. checksum이 다른 기존 행의 출처를 일괄 변경하지 않는다. instanceId는 localStorage 분리에 쓰는 공개 식별자이며 비밀값이 아니다.

JobStatus/Recording에 nullable errorCode를 추가한다. 이전 행의 불명확한 원인을 추측해서 채우지 않는다. errorMessage만 있는 이전 응답은 일반적인 실패로 안내한다.

| reason/errorCode 예 | 표시·복구 |
|---|---|
| AI_ENDPOINT_UNSUPPORTED | 연결 대상이 기능을 제공하지 않음. 설정 확인, 새 작업 반복 실행 금지 |
| AI_UNREACHABLE / AI_TIMEOUT | 연결 또는 시간 초과. 기존 job 상태와 실패 지점 구분 |
| DATASET_MISMATCH / DATA_NOT_READY | 데이터/version/sample 문맥 수정 |
| EMBEDDINGS_NOT_READY / MODEL_NOT_READY | 검색 준비 부족. 목록 탐색 유지 |
| VESPA_NOT_CONFIGURED / VESPA_REMOTE_UNREACHABLE / VESPA_TIMEOUT | 원인에 맞는 설정·원격 실행 상태 확인 |
| VESPA_EXECUTION_FAILED / VESPA_INVALID_RESULT | 실행 로그 또는 결과 검증 확인 |
| RESULT_STORAGE_FAILED / RECORDING_FILE_MISSING | 저장·파일 복구. GPU 자동 재실행 금지 |

HTTP status와 errorCode를 함께 보존하고 참조한다. 404를 timeout에 합치지 않으며 502만으로 AI 모델 실패를 단정하지 않는다. API 오류의 기존 {code,message} 형식을 유지하고 job terminal errorCode와 구분한다.

## 9. 비동기·실행·복구 설계

### 요청 snapshot

- Job 실행 의도에 instanceId, datasetId/checksum, sceneId/token/name, paneId, classMode, requestedAt, idempotencyKey, UI 문맥 generation을 저장한다.
- Receipt는 onSuccess 시점의 scene prop 대신 snapshot에서 만든다. 응답 후 현재 pane의 instance/dataset/scene/generation이 같을 때만 watchJob을 자동 연결한다.
- A→B→A로 돌아와도 오래된 요청이 새로운 사용자 선택을 덮어쓰지 않도록 generation으로 판정한다.
- 화면을 떠나도 서버가 접수한 job 기록을 잃지 않도록 receipt 저장 수명을 컴포넌트와 분리한다. 자동 재시도도 같은 snapshot/key를 사용한다.
- Recording 요청 snapshot은 resultJobId/export version을 포함한다. 원래 scene의 query를 갱신하고 다른 scene의 pane에 자동 선택하지 않는다.
- 이전 receipt를 새 DB의 확정 사실로 사용하지 않는다. 새 저장 영역으로 옮길 때 서버의 씬 문맥을 확인하며 불일치/불명확한 이력은 자동 복원하지 않는다.

### Worker 병행

VESPA와 recording에 전용 scheduler/실행 자원을 각각 하나씩 두고 각 실행 상한은 1을 기본으로 한다. 장시간 HTTP 호출이 다른 계통을 막지 않게 한다. DB claim/SKIP LOCKED/transaction/executionToken과 AI lock을 유지하며 일반 executor에서 GPU 작업을 무제한 제출하지 않는다.

SSH 방식도 queue 대기를 포함한 동기 HTTP다. UI는 기존 RUNNING 상태를 유지하고 실제 대기/추론 단계를 구분할 정보가 없으면 '작업 처리 중'으로 안내한다. 가짜 진행률이나 예상 완료 시간을 만들지 않는다.

### Recording 복구

| 실패 위치 | 처리 |
|---|---|
| exporter FAILED | 같은 scene/job의 recording만 다시 요청 |
| READY content 다운로드 실패 | 같은 recordingId의 GET 재시도. 새 생성 없음 |
| WASM/Viewer 시작 실패 | 이전 instance/channel/listener 해제 후 같은 파일로 다시 열기 |
| READY지만 서버 파일이 없음 | 서버 상태를 실패로 정정해 reuse 해제 후 recording만 재생성 |
| metadata/status GET 실패 | 조회 불가로 안내하고 다시 확인. 클라이언트가 READY/FAILED로 변경하지 않음 |

공유 파일이 일시적으로 읽히지 않는 것만으로 READY를 만료시키지 않는다. 서버가 파일 부재를 확인한 뒤 상태 조건부 갱신과 운영 로그를 사용한다. PENDING/RUNNING 중단은 실제 process/Slurm job을 확인한 뒤 복구한다. 단순 timeout으로 새 GPU 작업을 중복 실행하지 않는다.

## 10. 테스트·실제 데이터 완료 기준

검증 ID는 개선 체크리스트의 IT-01~IT-18을 사용한다. 기존 fixture/live 테스트는 장애 표시 확인에 활용하고 실제 데이터 정상 성공 검증을 분리한다.

- Fixture 정상/오류: capability, 서버 식별자 전환, 404/timeout, 지연 POST, A/B 변경, 재시도 key, worker 병행, recording 복구를 검증한다.
- 실제 mini 정상: 출처/checksum 확인, 선택한 scene의 여러 sample, 기대한 6개 카메라 ready, GT, LIDAR_TOP 점군, timestamp 이동, A/B 독립을 검증한다. missing/error로 종료한 것만으로 통과시키지 않는다.
- 실제 검색: model/preprocess가 일치하는 embedding을 준비한 dataset에서 조회 성공과 scene/sample 문맥을 확인한다. 임의 문장이 항상 결과를 반환한다고 가정하지 않고 검증 query와 기대 결과를 미리 정한다.
- 실제 VESPA: 기존 COMPLETED job을 UI 검증에 재사용할 수 있다. 새 추론은 준비한 local/SSH 환경에서 별도로 검증하고 scene/version/classMode/sample coverage/errorCode를 기록한다. 박스 0개인 프레임은 정상으로 다룬다.
- Geometry: devkit과 동일 camera/sample/GT를 비교한다. 회전, 전/측/후방, near-plane/이미지 경계, resize/확대를 기록한다. 같은 렌더링 조건을 맞춰 허용 pixel 차이를 정한다.
- Rerun: SDK/Web pin, 점 수, GT/예측 ID, sample 동기화, 선택, 재시도, unmount/resize를 검증한다.
- 사용 검수: Chromium과 실제 Safari, 1440/1280/1024에서 작업, 768/375에서 주요 정보·오류 복구, keyboard/focus/reduced-motion/screen-reader 안내를 확인한다.
- 성능: 실제 scene의 recording size, 점 수, 최초/반복 로딩, frame 준비 시간, A/B 메모리, unmount 후 자원을 측정한다. 목표 예산은 기준 실기기/회선 측정 후 확정하고 미측정 값을 통과로 기록하지 않는다.

각 기록에 commit/ref, dataset/checksum, scene/sample/job/recording, executor, browser/viewport, 명령/조작, 기대/실제 결과, 증거 저장 위치, 제약을 남긴다. 실제 ID를 추정하지 않으며 이전 보고 숫자를 이번 실행 결과로 사용하지 않는다.

## 11. 작업 묶음과 단계 진입 조건

| 단계 | 작업 | 다음 단계 진입 조건 |
|---|---|---|
| I0 | 변경 보존, 최신 main 통합, 관련 테스트 | local/ssh/recording 양쪽 기능이 유지된 기준 기록 |
| I1 | provenance/instance, capability, 부분 준비, 오류, 화면 상태 | recording-harness에서 VESPA 버튼 차단, AI 없이 catalog, 이전 서버 호환 |
| I2 | 요청 snapshot, worker 분리, Viewer/file 복구 | 지연/전환/병행/재시도 테스트 통과 |
| I3 | 실제 mini 별도 DB, 이미지·GT·LiDAR·devkit | A: 실제 센서 탐색 완료 |
| I4 | CLIP/embedding과 local/SSH VESPA | B: 실제 검색·예측 결과 비교 완료 |
| I5 | Safari/접근성/성능/문서/운영 복구 | C: 사용 검수 완료, 후속 미완료 명시 |

I1/I2는 실제 데이터/Seraph를 기다리는 동안에도 진행할 수 있다. I3과 AI 환경 준비는 병행 가능하다. I3의 GT-only recording에는 신규 VESPA 실행이 필요하지 않다. 부족한 환경의 단계만 미검증으로 남기고 mock로 완료 처리하지 않는다.

## 12. 산출물·담당 영역

| 영역 | 주요 산출물 |
|---|---|
| 프론트 | system query/mapper, 배지/기능 제어, snapshot 서비스, 서버별 receipt, Viewer 재시도, 적용 범위 안내, 회귀/실제 mini 검증 |
| Spring | system 상태/provenance API, migration, errorCode, POST 준비 검증, 전용 worker, 유실 파일 복구, 계약 테스트 |
| AI/VESPA | 기능별 초기화/capability, local/ssh 유지, 준비 검사, recording/CLIP 독립, 모델/데이터 환경 기록 |
| 데이터/실행 환경 | 원본 root/version, 별도 DB/Compose/port, Seraph 접속/원격 script/모델, embedding 준비 |
| 문서 | API/실행 안내, 개선 체크리스트, 실제 데이터 증거, 후속 위험/운영 절차 |

착수 시 CLAUDE.md, 이 문서, 개선 체크리스트, 분석서, 기존 product plan/API를 읽고 실제 코드와 대조한다. 이전 시작 프롬프트의 신규 구축 지시로 기존 구현을 재작성하지 않는다. 현재 브랜치·미커밋 변경·테스트/데이터 volume을 보존한다.
