# 프론트·데이터·AI 연동 개선 분석

분석일: 2026-10-05 (Asia/Seoul). 대상: codex/frontend-implementation, HEAD 501da08 및 현재 미커밋 구현. 이 문서는 개선 제안이며, 아래 수정이 이미 구현되었다는 뜻은 아니다.

## 1. 판단

현재 화면의 직접적인 원인은 합성 데이터와 recording 전용 테스트 AI 서버를 연결한 실행 환경이다. 실제 카메라·LiDAR 원본과 VESPA 실행 기능이 연결된 제품 환경이 아니다. 동시에 프론트의 상태 안내·비동기 작업 처리·3D 복구와 백엔드의 작업 실행 구조에도 보완할 항목이 있다.

React 구현을 전면 교체할 근거는 없다. 카메라별 pose/calibration, 프레임 준비 상태, 패널별 상태 분리, 동일 실행의 Idempotency-Key, recording과 라벨 작업의 분리 등은 유지하고 개선한다. 현재 화면만으로 기존 백엔드/VESPA 담당자의 구현 오류를 판단할 수 없다.

### 이번 분석에서 직접 확인한 사실

| 확인 대상 | 결과 | 의미 |
|---|---|---|
| Spring 데이터 통계 | scenes=1, samples=1, sensorFiles=7, gtBoxes=1 | 실제 여러 프레임 재생의 검증 환경이 아님 |
| 씬 API | scene-0001, description=Synthetic test fixture | nuScenes mini라는 dataset version 표기만으로 실제 원본 여부를 판별할 수 없음 |
| AI /health | service=recording-harness, clip=not_loaded, vespa=not_configured, recording=configured | recording만 가능한 개발 하네스 |
| 현재 로컬 override | AI_SERVER_BASE_URL을 host.docker.internal:18000으로 지정 | 제품 AI 컨테이너 대신 호스트 테스트 서버 연결 |
| 테스트 서버 구현 | .local/recording_app.py는 /recordings와 /health만 제공 | /auto-label 요청이 실패하는 이유를 코드로 확인 |
| 직전 실패 작업 #2 | status=FAILED, 백엔드 로그의 upstream HTTP 404 | timeout으로 확정할 오류가 아님; 2026-10-04에 직접 조회한 증거 |
| 타입 검사·단위 테스트·빌드 | 이번 분석에서 재실행하여 모두 통과, 4 files / 48 tests | 코드의 정적·단위 검증 결과이며 실제 모델 연동 완료를 뜻하지 않음 |
| 비동기 작업 최소 재현 | 요청 scene-A → 옵션 갱신 scene-B → receiptScene=scene-B | 사용하는 Query 라이브러리에서 callback 문맥 변경 가능성을 직접 재현 |

실제 nuScenes 투영, 실제 CLIP 검색 성공, 실제 VESPA 완료, Safari의 실제 데이터 렌더링, 장시간 작업 중 recording 병행은 이번에 실행하지 않았다. 기존 체크리스트의 43개 browser / 22개 Spring / 27개 AI 테스트는 이전 구현자가 기록한 결과이며 이번 분석에서 다시 실행한 숫자가 아니다.

## 2. 연결 구조와 책임 경계

~~~text
React
 └─ Spring /api
     ├─ PostgreSQL: 씬·프레임·GT·작업·예측·recording 문맥
     ├─ nuScenes 원본: 6카메라 JPG, LiDAR .pcd.bin, metadata
     └─ AI
         ├─ CLIP: 텍스트/이미지 embedding 및 검색 지원
         ├─ VESPA: 씬 전체 라벨 생성
         └─ recording exporter: 점군·GT·예측 → .rrd

React Rerun Viewer ← Spring recording content ← .rrd
~~~

LiDAR 원본, VESPA가 만든 예측, Rerun의 3D 표시를 구분한다. Viewer가 설치되어 있어도 원본 점군이 생기지 않으며, GT recording이 열려도 VESPA 성공을 증명하지 않는다. 카메라·GT 탐색은 CLIP/VESPA가 없어도 원본과 Spring/DB가 준비되면 사용할 수 있어야 한다.

## 3. 개선 항목과 우선순위

P0는 실제 장면 확인을 막는 실행 환경과 기능 준비 상태, P1은 잘못된 문맥·실패 복구·검증 판정, P2는 사용성·성능·운영 보완이다. 담당은 사람에 대한 귀책이 아니라 수정할 영역이다.

| ID | 우선순위 | 항목 | 담당 영역 | 증거 수준 |
|---|---|---|---|---|
| ENV-01 | P0 | 합성 환경과 실제 데이터 환경 분리·실제 mini 연결 | 데이터/실행 설정 | 직접 API·설정 확인 |
| CAP-01 | P0 | 준비되지 않은 검색·라벨 기능을 실행 가능하게 표시 | 백엔드+프론트+AI | 현재 health와 JobPanel 확인 |
| ERR-01 | P1 | 502를 AI 문제로 고정하고 upstream 404를 timeout과 합침 | 프론트+백엔드 | 코드·실패 로그 확인 |
| ASYNC-01 | P1 | 씬 전환 중 늦은 응답의 작업 문맥 혼동 | 프론트 | 코드 및 Query 최소 재현 |
| JOB-01 | P1 | 긴 VESPA 호출이 recording worker를 막을 수 있음 | 백엔드 | 구조·기본 설정으로 추론; 병행 실험 필요 |
| VIEW-01 | P1 | READY recording의 다운로드/Viewer 실패 재시도 부재 | 프론트 | effect·오류 UI 확인 |
| VIEW-02 | P1 | GT/예측 토글의 카메라·3D 적용 범위 불일치 | 프론트+exporter | props·구현·기존 체크리스트 확인 |
| QA-01 | P1 | 오류 표시 성공과 실제 기능 성공을 같은 통과로 읽음 | 검증 | live.spec.ts 확인 |
| GEO-01 | P1 | 실제 이미지/점군과 좌표·시간 정합 검증 미완료 | 프론트+데이터+AI | 검증 공백; 현재 기하 오류를 발견했다는 뜻 아님 |
| JOB-02 | P2 / 공유 서비스 운영 전 P1 | 재시작 후 RUNNING 작업 복구 없음 | 백엔드+AI | claim·상태 갱신·reuse index 확인 |
| UX-01 | P2 | 환경 안내·3D 시점·카메라 면적·기술 문구 개선 | 프론트 | 제공된 화면과 구현 검토 |
| PERF-01 | P2 / 성능 측정은 실제 mini 검수에 포함 | 큰 WASM·recording·프레임 캐시 비용 | 프론트+exporter+파일 제공 | 자산 크기·전체 파일 로딩 확인; 성능 문제 실측 아님 |
| DOC-01 | P2 | 문서의 계약·검증 범위 불일치 정리 | 문서/실행 설정 | CLAUDE.md·API·체크리스트 대조 |

### ENV-01: 실제 데이터부터 확인

- .local/nuscenes는 테스트 데이터 용도로 유지하고 실제 nuScenes root와 구분한다. 실제 root에는 version metadata뿐 아니라 samples/sweeps/maps 등 사용하는 원본 파일이 있어야 한다.
- 데이터 준비 여부는 dataset 이름이나 version 문자열로 추정하지 않는다. 가져온 데이터의 출처, checksum, 실제 파일 존재/읽기, 채널별 미디어 상태를 확인한다. 프레임 1개라는 이유만으로 합성이라고 판정하지 않는다.
- Spring과 AI가 같은 version·원본을 바라보는지 확인한다. 프론트의 dataset 선택이 곧 해당 dataset에 대한 AI 지원을 뜻하지 않으므로 선택 데이터와 AI의 지원 데이터도 대조한다.
- 실제 데이터 등록은 테스트 DB와 별도로 진행하는 구성이 권장된다. 기존 테스트 volume을 삭제해서 문제를 해결하지 않는다.
- 완료 조건: 선택한 실제 씬의 전체 프레임 목록을 읽고 서로 다른 프레임에서 원본 카메라 이미지·GT·점군을 확인한다. 이미지·metadata·센서 calibration/pose의 sample 문맥을 함께 기록한다.

### CAP-01: 실행 가능한 기능을 서버가 알려주기

AI에는 이미 /health가 있지만 React에서 사용하는 Spring API에 기능 준비 상태를 전달하는 계약이 없다. 현재 JobPanel의 실행 버튼은 진행 중 여부만 보며 VESPA 미설정 여부를 확인하지 않는다.

- Spring 경유 상태 조회 API를 추가한다. 예: GET /api/system/status. 이는 신규 제안이며 현재 존재하는 API가 아니다.
- 데이터 출처는 명시적 설정 또는 검증된 import 정보로 synthetic/nuscenes/unknown을 구분한다. synthetic 배지는 목록과 작업대 모두에 계속 표시한다.
- catalog/media, CLIP model, 선택 데이터의 embedding, VESPA 설정, recording exporter를 독립 항목으로 반환한다.
- configured, ready, unavailable, unknown을 구분한다. 현재 VespaService.configured()는 주요 경로·metadata 존재를 확인할 뿐, 모델/런타임의 실제 추론 성공을 검증하지 않는다. configured를 ready로 번역하지 않는다.
- GPU 유무 하나만으로 사용 가능 여부를 결정하지 않는다. 지원하는 실행 방식과 실제 의존성·데이터·모델 상태를 기준으로 판정한다.
- VESPA 미지원이면 실행 버튼을 비활성화하고 이유를 표시한다. 상태 확인 실패는 준비 상태 unknown으로 표시하며, 정책에 따라 재확인 후 실행하도록 한다. 서버도 실행 요청을 검증해야 한다.
- CLIP 또는 embedding이 없으면 검색에 이유를 안내하고 씬 목록 탐색은 계속 제공한다. recording 지원 여부와 별도로 다룬다.
- 완료 조건: 지금의 recording-harness에 연결했을 때 GT/센서 보기만 가능하다고 안내하고 새 VESPA 작업을 생성하지 않는다.

### ERR-01: 실제 원인을 보존하는 오류 계약

근거: frontend/src/api/http.ts:113은 모든 HTTP 502를 AI 문제로 표시한다. AutoLabelWorker.java:25는 RestClientException에 HTTP 상태와 관계없이 같은 실패 문구를 저장한다.

- 502 자체는 중계 요청 실패로 안내하고 AI 원인은 서버의 errorCode로 확정된 경우에만 설명한다.
- job status에 안정적인 errorCode와 사용자용 errorMessage를 제공한다. upstream HTTP 404, 연결 거부, timeout, 데이터 미준비, VESPA 실행 실패, 결과 검증/저장 실패를 구분한다.
- 내부 경로·stack trace는 서버 로그에 남기고 사용자는 작업 번호와 필요한 조치를 본다. 상세 요청 정보는 진단 영역에 둔다.
- 같은 환경에서 무조건 새 작업 재실행을 권하지 않는다. 설정 누락이면 먼저 환경을 준비해야 한다.
- 완료 조건: 현재 하네스의 /auto-label 미지원은 timeout으로 표시하지 않고, 백엔드 연결 실패도 AI 모델 문제로 단정하지 않는다.

### ASYNC-01: 요청 당시 씬으로 늦은 응답 처리

근거: JobPanel.tsx:69~76의 onSuccess가 intent 대신 현재 scene prop에서 receipt 문맥을 읽는다. SceneComparePage.tsx:156은 key가 active A/B뿐이고 :222는 같은 패널의 씬 변경을 허용한다. 캐시에 씬 목록이 있으면 컴포넌트가 유지될 수 있다.

최소 재현은 실제 설치된 @tanstack/query-core의 MutationObserver를 사용했다. A 요청 진행 중 options를 B callback으로 갱신하자 요청 변수는 A지만 성공 callback의 scene은 B였다. 전체 화면 재현은 회귀 테스트에 추가해야 한다. 서버 sceneToken 검증이 있어 잘못된 예측 표시는 방어할 수 있지만, receipt 오염과 작업 연결 혼동은 여전히 발생할 수 있다.

- RunIntent에 datasetId/sceneId/sceneToken/sceneName/paneId/요청 시각을 캡처한다. receipt는 이 snapshot으로 저장한다.
- 응답 후 pane의 현재 dataset/scene이 snapshot과 같을 때만 자동으로 watchJob을 연결한다. 달라졌으면 원래 씬의 이력만 기록한다.
- key만 바꾸는 해결책은 요청을 보낸 뒤 화면을 떠났을 때 receipt를 잃을 수 있다. 작업 접수 기록의 수명도 함께 설계한다.
- RecordingPanel.tsx:61~66에도 같은 형태의 현재 scene/pane 참조가 있으므로 요청 snapshot과 연결 조건을 같이 적용한다. 이 항목은 recording UI 전체 재현 전 코드상의 동일 위험으로 분류한다.
- 완료 조건: 지연된 A 요청 후 B로 씬 전환해도 B에는 A job/recording이 연결되지 않고, A 이력에는 올바르게 남는다. A/B 활성 패널 변경·언마운트·동일 key 재시도도 검증한다.

### JOB-01: 라벨 생성과 3D 생성의 실행 통로 분리

AutoLabelWorker.java:14와 RecordingWorker.java:18은 모두 @Scheduled이며 HTTP 호출 완료까지 해당 스레드를 사용한다. 별도 scheduler/pool 설정은 없고 가상 스레드 활성화도 없다. Spring Boot의 일반 TaskScheduler 기본은 한 스레드이므로 긴 라벨 호출 동안 recording poll이 지연될 수 있다. [Spring 공식 문서](https://docs.spring.io/spring-boot/reference/features/task-execution-and-scheduling.html)

- 최소 수정은 scheduler pool 2개로 병행 가능하게 하는 것이다. 권장 구조는 VESPA와 recording 전용 실행 자원을 분리하고 동시 실행 수를 제한하는 것이다.
- DB claim의 transaction·executionToken과 AI 측 직렬 실행 제한을 유지한다. 스레드 수만 늘리고 VESPA 병렬 실행 수를 무제한으로 늘리지 않는다.
- 완료 조건: fake AI에서 라벨 호출을 latch로 대기시킨 동안 GT-only recording이 별도로 실행되어 READY가 되는 통합 테스트. 실제 GPU 없이 검증할 수 있다.

### VIEW-01: 생성 실패와 열기 실패를 따로 복구

RerunViewer.tsx:47 부근에서 .rrd를 전체 fetch하고, :108~112에서 오류 상태로 바꾸지만 :143에는 재시도 버튼이 없다. effect의 dependency는 contentUrl 등이라 같은 READY 파일을 그대로 다시 열기 어렵다.

- recording 생성 FAILED는 recording 생성만 다시 요청한다.
- READY 파일 다운로드, WASM 초기화, Viewer 시작 실패는 같은 recordingId로 다시 연다. VESPA나 exporter를 새로 실행하지 않는다.
- 재시도 시 fetch 취소·channel close·Viewer stop·이벤트 해제 후 새 인스턴스를 만든다. 로딩이 영구히 멈춘 경우의 복구도 정의한다.
- READY 파일이 서버에서 유실된 경우는 서버의 상태 정정·재생성 경로도 필요하다. 현재 READY reuse 때문에 POST만 반복해서는 유실 파일이 복구되지 않을 수 있다.
- 완료 조건: 첫 content GET 실패 후 두 번째 성공에서 회복, 성공한 recording에 대해 새 생성 POST 0회, VESPA POST 0회.

### VIEW-02: 토글의 적용 범위와 객체 선택

LayerToggles → visibleBoxes는 카메라에 적용되지만 RerunViewer에는 layers prop이 전달되지 않는다. 현재 같은 영역의 GT/예측 버튼을 사용자가 전체 화면 제어로 이해할 수 있다.

- 즉시 적용할 수정: 카메라 라벨 토글임을 명시한다.
- 목표: 고정된 Rerun 버전에서 blueprint/다른 지원 방식으로 entity 표시 제어가 가능한지 작은 recording으로 검증하고 구현한다. JS API에서 가능하다고 가정하거나 토글마다 무조건 전체 씬을 다시 export하지 않는다.
- 현재 확인된 연결은 3D 박스 클릭 → React 객체 선택이다. 목록/카메라 클릭 → 3D 선택 강조는 코드에 없다. 양방향 강조가 필요한지 제품 계약을 확정한 뒤 지원 API를 검증한다.
- 완료 조건: 버튼이 설명하는 범위와 실제 표시 변화가 일치한다. 프레임별 ID mapping을 유지하고 GT/예측 객체를 임의로 동일 객체로 연결하지 않는다.

### QA-01: 테스트의 통과 의미 강화

frontend/tests/live/live.spec.ts는 다음을 허용한다: 카메라가 ready/missing/error 중 하나로 settle, 검색이 결과/빈 결과/오류 중 하나로 종료, recording이 READY 또는 FAILED로 종료. 이는 장애 안내·응답 종료 확인에는 유용하지만 제품의 정상 기능 성공 기준은 아니다.

- 기존 실패/복구 테스트는 유지한다.
- 별도 실제 mini 성공 검증에서 예상한 카메라 모두 ready, 다중 프레임 이동, GT 정상, 준비된 embedding 검색 성공, 지정한 완료 job의 결과와 sample 일치, recording READY와 해당 sample의 점군 존재를 확인한다.
- actual-data 성공 검증에는 합성 fixture를 사용하지 않는다. 입력 데이터의 출처와 scene/sample/job/recording/version을 기록한다.
- 이미 완료된 VESPA job을 UI 검증에 재사용한다. GPU 작업을 테스트마다 새로 만들지 않는다. 신규 추론 검증은 실행 환경을 준비한 뒤 별도 절차로 진행한다.
- Safari도 실제 다중 프레임·3D·분할·화면 복귀를 확인한다. 이전 Chromium fixture 검증으로 Safari 완료를 선언하지 않는다.

### GEO-01: 이미지·GT·점군의 정합

현재 projection은 WORLD → 해당 카메라 ego pose 역변환 → calibration 역변환 → intrinsic 순서를 따른다. exporter는 LiDAR sensor → ego → WORLD 변환과 W/L/H·quaternion 순서를 명시한다. 코드의 기본 접근은 타당해 보이며, 지금 단색 화면이 곧 좌표 계산 오류를 뜻하지 않는다.

- nuScenes devkit 참고 렌더링과 같은 sample·camera·annotation을 비교한다. 전방/측면/후방, 회전 객체, 이미지 경계와 near-plane 사례를 포함한다.
- world 좌표를 서로 다른 센서의 ego pose로 혼합하지 않았는지 확인한다. 키프레임 간 취득 시각 차이와 MVP의 시간 보간 미지원도 구분한다.
- Rerun에서 해당 sample의 점군·GT·예측과 metadata의 점 수·박스 ID가 맞는지 확인한다.
- 완료 조건: 기준 렌더와 비교한 사례·픽셀 오차 기준·불일치 사유를 기록한다. 오차 허용값은 기준 renderer의 clipping/표현 방식까지 맞춰 정한다.

### JOB-02: 중단된 작업의 복구

현재 claim은 RUNNING으로 바꾼 뒤 외부 호출한다. heartbeat/lease/restart recovery 경로는 보이지 않는다. recording의 non-FAILED unique reuse index 때문에 중단된 RUNNING 요청은 새 생성에서도 재사용되어 계속 기다릴 수 있다.

- 우선 운영자가 실행 상태를 확인한 뒤 안전하게 실패 처리하는 절차를 문서화한다.
- 공유 서비스 운영 전에는 heartbeat/lease·worker 식별·만료 판단과 결과의 executionToken fencing을 설계한다. 오래 걸린다는 이유만으로 즉시 새 GPU 작업을 실행하면 중복 추론이 생길 수 있다.
- 완료 조건: worker 중단 후 무한 대기하지 않고, 과거 실행의 늦은 결과가 새 실행을 완료 처리하지 않는다. 사용자에게 복구 상태를 구분해 안내한다.

### UX-01 / PERF-01 / DOC-01

- 현재 카메라 분할의 2열×3행은 좁은 영역에서 면적을 확보하려는 의도된 배치다. 제공된 화면의 단색 타일을 CSS 오류로 단정하지 않는다. 실제 이미지로 3열×2행·2열×3행과 확대 사용성을 비교한다.
- 테스트 데이터 배지, 검색/VESPA 준비 상태, recording 상태를 먼저 보이게 한다. WORLD 좌표 설명·SDK 버전·recording 내부 번호는 상시 주요 문구보다 정보/진단 영역에 둔다. 데이터 자체에 대한 중요한 한계는 숨기지 않는다.
- 3D 첫 시점에서 점군과 박스를 찾기 쉽도록 exporter blueprint 및 시점 초기화 가능성을 검증한다. 스크린샷에서 점군이 잘 안 보인다는 이유만으로 renderer 고장으로 판정하지 않는다.
- 이번 빌드에서 Rerun WASM은 약 51.2 MB, gzip 약 16.3 MB다. .rrd도 전체 파일을 읽는다. 실제 씬의 file size·점 수·브라우저 메모리·첫 표시 시간·프레임 전환 시간을 측정한다.
- 이미지 idle cache는 개수 기반 48개이고 Query metadata는 최대 30분 유지한다. 원본 이미지와 A/B에서 메모리 비용을 측정한 뒤 필요 시 byte budget·cache 수·점군 표시 밀도를 조정한다.
- 전송 압축·WASM 정적 캐시·대형 파일 전달 방식은 측정 후 조정한다. .rrd URL alias/streaming은 고정 Viewer와 서버의 지원을 검증한 뒤 선택한다.
- CLAUDE.md는 아직 job status에 sceneToken/classMode가 없다고 적혀 있지만 실제 DTO에는 추가됐다. API와 맞게 갱신한다.
- 체크리스트의 Docker 전체 이미지 미검증과 현재 backend-only 실행을 구분한다. 로컬 override·하네스 기동을 제품 AI 이미지 검증 완료로 기록하지 않는다.

## 4. 실행 순서와 완료 조건

| 단계 | 수행 작업 | 완료 조건 |
|---|---|---|
| 1. 상태 안내·오류·문맥 수정 | CAP-01, ERR-01, ASYNC-01, VIEW-01, VIEW-02의 적용 범위 안내 | 실제 모델 없이도 기능 미지원과 장애를 정확히 안내하고, 지연 응답·재시도 회귀 테스트 통과 |
| 2. 실제 센서·GT 확인 | ENV-01, GEO-01; 실제 mini와 별도 DB 준비 | 6카메라 원본·여러 프레임·GT·점군 정상, devkit 비교 기록 |
| 3. AI 연결 검증 | 제품 AI 이미지 빌드/health, 선택 데이터 embedding, VESPA 설정·기존 결과/신규 실행 검증 | 검색 성공과 VESPA 완료 결과를 각각 실제로 확인; recording-only health를 완료로 보지 않음 |
| 4. 작업 병행·중단 복구 | JOB-01, JOB-02 | 라벨 대기 중 recording 실행, 프로세스 중단의 복구/운영 절차 검증 |
| 5. 실제 사용 검수 | 강화한 QA-01, UX-01, PERF-01, DOC-01 | 실제 데이터에서 A/B·재생·확대·Safari·접근성·성능 결과와 미완료 항목 기록 |

2와 3의 준비는 병행할 수 있다. 카메라/GT 검수를 위해 먼저 GPU 전체 추론이 끝나야 할 필요는 없다. 실제 데이터 준비와 별개로 1 및 JOB-01의 fake AI 병행 테스트는 지금 시작할 수 있다.

## 5. 역할별 전달할 작업

| 영역 | 전달할 내용 |
|---|---|
| 프론트 | 기능 준비 상태 표시/버튼 제어, 정확한 오류 안내, 요청 snapshot, 3D 열기 재시도, 토글 범위, 실제 다중 프레임·A/B·Safari 검수 |
| Spring | 기능 상태 API·선택 dataset 문맥, 안정적인 오류 코드, worker 실행 분리, 중단/유실 recording 복구, 기존 idempotency/transaction 보존 |
| AI/VESPA | 실제 /auto-label 제공 환경, 모델·runtime·데이터 일치, configured/ready 구분, 기존 성공 실행 정보 또는 재현 절차 |
| 데이터/실행 환경 | 실제 root·version·원본 파일·출처, 테스트/실제 DB 구분, product Compose와 .local override 구분 |
| 함께 확인 | devkit 투영 비교, scene/sample/job/recording 일치, 실제 성공 경로와 실패 복구를 나눈 검증 기록 |

다음 구현자는 이 문서와 기존 product plan/API를 함께 읽고 현재 브랜치의 미커밋 변경을 보존한다. 단계별 수정·검증을 작은 단위로 기록한다. 대규모 모델/데이터 다운로드, volume 삭제, remote push는 이 분석 문서의 작성으로 승인된 작업이 아니다.

## 6. 새 main 병합 확인과 통합 계획

사용자가 분석 도중 제공한 브랜치 화면을 근거로 원격 정보를 갱신하고 PR 및 원격 코드를 확인했다. 화면의 Ahead/Behind 숫자만으로 병합을 단정하지 않고 GitHub PR 상태로 검증했다.

### 사실과 인과관계

- [PR #3](https://github.com/leehyeoksu/DriveScene2Label/pull/3), feature/vespa-ssh-executor는 merged=true이며 원격 main의 merge commit은 8b0c88c이다.
- 병합 시각은 2026-10-04 17:27:52 UTC, 한국 시간으로 **2026-10-05 02:27:52**다.
- 사용자가 보여준 합성 화면의 macOS 표시 시각은 **10월 4일 18:58**로 병합보다 앞선다.
- 현재 HEAD는 501da08의 codex/frontend-implementation이며 새 main의 5개 commit은 아직 포함하지 않는다. fetch는 원격 ref만 갱신했다. 작업 파일과 실행 중인 하네스를 새 main으로 교체하지 않았다.
- 현재 실행 중인 Spring은 계속 host.docker.internal:18000의 recording-harness를 호출하고, 해당 health는 VESPA not_configured를 반환한다.

따라서 새 main 병합이 제공된 합성 이미지/1프레임/라벨 404 실패의 원인이라는 인과관계는 성립하지 않는다. 다만 원격 VESPA 실행 기능이 추가됐으므로 향후 실제 연결 계획에 반영해야 한다.

### 무엇이 달라졌나

| 항목 | 원격 main 변경 | 프론트에 주는 영향 |
|---|---|---|
| VESPA 실행 위치 | VESPA_EXECUTOR=local 기본값 유지, ssh 옵션 추가 | REST 요청 형식 변경 없이 실행 환경 선택 가능 |
| SSH 실행 | AI → SSH sbatch 제출 → squeue 대기 → 결과 JSON 복사/검증 | GPU 클러스터를 활용할 수 있음; Slurm queue 대기 안내 필요 |
| Spring/DB/REST | PR에서 변경하지 않았고 diff에서도 해당 변경 없음 | 프론트 API 재설계의 직접 원인이 아님 |
| AI health | inference.vespa_executor 추가 | 신규 상태 API에 local/ssh와 configured/ready 구분을 반영 |
| 실행 구성 | compose.seraph.yml, SSH key/known_hosts mount, 환경변수 추가 | main 병합만으로 원격 연결이 준비되지 않음 |
| 보고된 검증 | PR 작성자는 scene-0061 8class의 39 samples / 985 boxes COMPLETED 및 fake SSH 테스트를 보고 | 유용한 참고이나 이 PC에서 독립 재실행한 결과는 아님 |

새 SSH 기능은 카메라 JPG나 LiDAR 원본을 자동으로 내려받지 않는다. 결과 JSON을 복사하는 기능이다. 센서 파일을 제공하는 Spring 호스트에는 여전히 해당 원본이 필요하고, exporter에도 점군 파일이 필요하다. Spring을 원격 호스트에 둘 수도 있지만 현재 구조에서는 로컬 데이터/하네스를 그대로 둔 채 SSH 옵션만 켜서 실제 주행 화면이 생기지는 않는다.

### 합칠 때 반드시 보존할 부분

원격 main과 현재 미커밋 변경이 겹치는 tracked file 5개에 대해 임시 파일에서 git merge-file 3-way 텍스트 검사를 했다. 실제 branch merge 또는 checkout을 수행한 결과가 아니다.

| 파일 | 텍스트 검사 | 통합 기준 |
|---|---|---|
| .env.example | 충돌 | recording 설정과 SSH 설정 모두 유지 |
| ai-server/Dockerfile | 충돌 | recording exporter의 의존성/복사와 openssh-client 설치 모두 유지 |
| ai-server/main.py | 충돌 | recording router/service/error handler/health와 vespa_executor health 모두 유지 |
| README.md | 텍스트 자동 병합 가능 | 프론트·recording·SSH 실행 안내의 의미를 다시 검수 |
| ai-server/README.md | 텍스트 자동 병합 가능 | 로컬/SSH VESPA와 recording 제공 범위가 일치하는지 확인 |

권장 순서:

1. 현재 미커밋 구현의 검토·검증 범위를 확인하고 복원 가능한 체크포인트로 보존한다. 분석을 위해 임의로 commit하지는 않았다.
2. 프론트 작업 브랜치에 최신 origin/main을 통합하고 위 세 파일을 양쪽 기능 기준으로 해결한다. 문서의 자동 병합 성공을 기능 호환 완료로 판단하지 않는다.
3. frontend 검사와 Spring 계약 테스트, AI의 기존 local/recording/신규 SSH 테스트를 함께 수행한다. PR에 적힌 35개와 기존 27개를 단순 합산하지 않고 실제 발견된 테스트 수를 기록한다.
4. 실행 형태를 결정한다: 지원되는 로컬 추론 환경 또는 접근 가능한 Seraph SSH/Slurm 환경. SSH 주소·키·원격 script·데이터·모델이 준비돼야 한다. 실제 서버 접속/Slurm 제출은 이번 분석에서 실행하지 않았다.
5. 현재 recording-only override 대신 통합 AI 서버를 연결한다. 원본/version/sampleToken과 Spring/AI/클러스터의 문맥을 맞춘다.
6. 실제 센서 탐색·CLIP 검색·기존 또는 신규 완료 VESPA 결과·Rerun을 각각 검증한다.

### SSH 방식에서 추가할 사용자 상태와 검증

- 현재 Spring의 PENDING/RUNNING/COMPLETED/FAILED 의미는 유지한다. 원격 제출 후 Slurm PENDING이어도 Spring job은 RUNNING이므로 현재 UI만으로는 GPU queue 대기와 실제 추론을 구분하지 못한다.
- 필요하면 기존 status와 별도로 executionPhase=SUBMITTED/QUEUED/EXECUTING/FETCHING을 추가한다. 실제 진행률을 제공하지 않는데 퍼센트를 만들지 않는다. 이것은 신규 개선 제안이며 PR에 구현된 계약이 아니다.
- SSH 접속 실패, Slurm queue/조회 실패, 원격 timeout, 새 결과 파일 미생성 오류를 ERR-01에 반영한다.
- SSH 모드도 동기 HTTP이며 queue 대기가 포함된다. JOB-01의 worker 실행 분리는 계속 필요하다.
- AI가 연락을 잃어도 원격 job이 계속 실행될 수 있다. JOB-02의 중단 복구에서 원격 Slurm job 식별·취소/결과 확인을 고려해야 하며 새 작업을 무조건 다시 제출하지 않는다.
- 원격 문서는 같은 scene/EXP를 다른 곳에서 동시에 실행하면 고정 출력 경로의 결과 구분이 어렵다고 명시한다. 다중 사용자 운영 전에는 실행별 원격 output 또는 cluster 차원의 직렬화가 필요하다. 이 사항은 현재 화면 원인이 아니라 운영 확장 위험이다.
