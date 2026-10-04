# Claude Code 프론트 구현 시작 프롬프트

DriveScene2Label 저장소에서 Claude Code를 시작하고, 아래 코드 블록 전체를 첫 메시지로 전달한다. 문서는 `codex/frontend-implementation` 브랜치에 준비되어 있다. 이전 실행 결과가 있다면 체크리스트와 실제 코드를 기준으로 이어서 작업한다.

```text
DriveScene2Label의 프론트와 필요한 백엔드·AI 보완을 실제로 구현해줘.

현재 저장소는 Spring Boot + PostgreSQL/pgvector + 내부 FastAPI/CLIP 검색 + VESPA 자동 라벨링을 갖추고 있다. 이 기반에 React 프론트를 연결한다. 디자인 기준 HTML은 합성 프로토타입이며 실제 연동 완료 코드가 아니다.

0. 작업 시작과 기준 읽기

- 먼저 pwd, git status, 현재 branch/HEAD, 기존 변경을 확인한다.
- 문서 준비 브랜치 codex/frontend-implementation에서 작업한다. 이미 해당 브랜치면 그대로 이어간다. 다른 브랜치에 사용자 변경이 있으면 덮어쓰거나 강제로 checkout하지 않는다.
- 다음 문서를 읽고 실제 Controller/DTO/Service 및 AI wrapper와 대조한다.
  1) CLAUDE.md
  2) docs/frontend-product-plan.md
  3) docs/frontend-implementation-checklist.md
  4) README_API.md
  5) docs/frontend-design/README.md
  6) docs/frontend-design/index.html
  7) README.md, docs/docker-integration.md, ai-server/VESPA.md
- docs/frontend-design/claude-handoff.md는 참고용 원문이다. 오류와 mock 한계는 디자인 README와 기획서가 보정했다.
- 파일이 제공되지 않았다고 다시 요청하지 말고 저장소 안의 자료를 사용한다. 기준 시안 원본은 보존한다.

1. 제품과 기술 스택

- React + TypeScript + Vite, React Router, TanStack Query, Zustand, Tailwind CSS + shadcn/ui, Rerun Web Viewer, Vitest + Playwright.
- frontend/에 독립 앱을 만든다. npm lockfile, typecheck/build/test/test:e2e scripts, 환경 예제와 실행 안내, 적절한 ignore를 구성한다.
- ECharts와 평가·학습·라벨 편집·취소·팀 전체 작업 이력은 후속이다.
- 다크 테마, 파랑 주요 행동, 노랑 GT 점선, 민트 예측 실선, A/B 보라/분홍, 한국어 안내를 유지한다.
- shadcn 기본 스타일로 기준 시안을 대체하지 않는다. 주요 버튼의 흰 글자 대비를 보완하고, 센서 면적을 위해 우측 패널 접기를 제공한다.
- 일반 제품 화면에서 요청 body·SDK 제약 같은 개발 설명과 시안 상태 메뉴를 제거한다.

2. 이번에 구현할 기능

A. 데이터셋·씬 목록·자연어 검색
- 실제 /api/datasets와 scene 목록, 검색 응답 scenes[]를 연결한다.
- 대표 이미지·설명·유사도·대표 프레임, 빈 결과·로딩·오류를 구현한다.
- dataset/scene/sample을 공유 URL로 복원한다. 숫자 ID·token·scene 이름을 구분한다.

B. 씬 작업대
- 6개 카메라를 channel 기준으로 배치하고 실제 JPG 위에 GT/예측 박스를 표시한다.
- 6카메라 모드, 카메라+LiDAR 분할, 경계 크기 조절, 확대 모달, 프레임 이동·재생·속도, 레이어·객체 정보.
- timestampUs 기반 재생, 인접 prefetch, 요청 프레임/표시 프레임 분리, 이미지와 박스 함께 전환, 누락 센서와 오래된 응답 처리.
- 모달/타임라인/분할의 키보드와 focus, 작은 화면, 숨겨진 탭 정지·viewer/blob 자원 해제.

C. VESPA 작업
- 씬 전체 생성, classMode 1/3/8, 실제 jobId 보관, receipt, 2~5초 polling, 결과 표시.
- 동일 실행의 네트워크 재시도는 같은 Idempotency-Key, 새 실행은 새 key.
- PENDING/RUNNING/COMPLETED/FAILED, GET 연결 실패를 분리하고 terminal에서 polling을 중단한다.
- 완료 결과 GET 실패는 결과만 다시 읽는다. 새 VESPA job을 만들지 않는다.
- 실제 completedAt으로 경과 시간을 멈춘다. 현재 status에 없는 sceneToken/classMode는 receipt나 호환 가능한 계약 보완으로 연결한다.
- 결과는 최상위 datasetId + boxes[].sampleToken으로 프레임에 연결한다. 빈 boxes는 정상 상태다.
- 알려진 jobId 새로고침 복원과 씬 소속 검증을 구현한다.

D. 동일/다른 씬 A/B 비교
- A/B에 같은 씬을 서로 다른 프레임으로 열 수 있어야 한다.
- dataset/scene/sample/job/재생/레이어/선택은 패널별로 독립이며 서버 캐시는 공유 가능하다.
- 활성 패널과 우측 실행 대상을 일치시킨다. 상대 동기화는 실제 timestamp 기준이다.
- 양쪽 6카메라를 필수로 구현하고, Rerun은 활성 패널 단일 인스턴스를 시작 기준으로 둔다. 두 Rerun 동시 표시는 이번 완료를 막는 조건으로 추가하지 않는다.

E. GT category 보완과 실제 투영
- GT geometry는 이미 있다. 기존 응답에 원본 categoryToken/categoryName을 추가하고 JOIN의 dataset 범위를 지킨다.
- 원본 category와 1/3/8종 표시 mapping을 구분하며 미매핑을 임의로 vehicle로 만들지 않는다.
- WORLD m, size W/L/H, quaternion W/X/Y/Z, 로컬 x=L/y=W/z=H.
- 각 camera sensor file의 pose/calibration과 intrinsic으로 투영하고 near-plane·카메라 뒤·화면 밖을 처리한다.
- 원본 이미지 width/height와 object-fit 여백을 반영하고 실제 프레임에서 위치를 검증한다.

F. Rerun recording 생성·저장·제공·웹 연결
- 이것도 이번 필수 구현 범위다. 프론트 자리 표시자로 끝내지 않는다.
- 현재 Python pin과 호환되는 SDK/웹 Viewer를 먼저 작은 실제 recording으로 검증한다.
- exporter로 실제 점군·GT 및 선택한 완료 job 예측을 .rrd로 생성한다. VESPA upstream은 수정하지 않는다.
- 기획서의 recording API 초안을 출발점으로 metadata/status/content 제공, 저장소·Spring 접근, sample/timeline·entity/box mapping을 구현한다.
- 필요하면 새로운 migration과 Compose의 recording volume 구성을 추가하되 기존 결과·데이터·DB volume을 보존한다.
- artifact.relativePath를 URL로 사용하지 않는다. 라벨 job 완료와 recording 준비 상태를 분리하고, recording 실패는 recording만 재시도한다.
- React 타임라인과 viewer를 연결하고 반복 이벤트를 막는다. 선택 API가 entity 단위이면 박스 식별 mapping을 구현·검증한다.
- SDK 버전 선택·WASM 자산·resize·해제·실제 로딩 결과를 기록한다.

3. API와 아키텍처에서 주의할 점

- 브라우저는 Spring /api/*만 호출한다. FastAPI/DB 직접 접근 금지.
- 실제 samples는 Sample[], 상세는 {sample,sensorFiles,maps}, 검색은 scenes[], 생성은 {jobId,status}, 결과는 boxes[]다.
- 실제 center/rotation/calibration은 평탄한 DTO다. DTO→화면 모델 mapper를 명시한다.
- Query는 서버 상태, Zustand는 패널 상태, URL은 공유 문맥, localStorage는 작은 설정·receipt를 담당한다.
- datasetId=1 고정, scene 이름 전역 키, 무조건 {items}/{data} envelope를 사용하지 않는다.
- 검색 score는 확률이 아니고 VESPA detectionScore=1.0은 confidence가 아니다. 지원하지 않는 진행률·정확도·평가값을 만들지 않는다.
- 현재의 transaction, Idempotency-Key, GT/예측 분리, CLIP 검색을 보존한다. 기존 응답을 깨지 말고 추가 계약을 문서화한다.
- 실제 API 실패 시 synthetic mock로 자동 전환하지 않는다. 테스트 fixture와 명시적 개발용 예시는 제품 데이터와 구분한다.

4. 진행 순서와 검증

- 환경 조사 후 M1 기반→M2 실제 카메라→M3 검색/job→M4 투영/GT→M5 Rerun→M6 비교/통합 순서로 진행한다.
- Rerun 기술 검증과 GT category 보완은 카메라 개발과 병행 가능한 작업이다.
- 첫 검증 가능한 묶음은 실제 씬을 열고 6개 JPG를 같은 sample로 이동·확대하는 것이다. 이 묶음이 끝나도 남은 이번 범위를 계속 진행한다.
- 평범한 선택은 기록하고 진행한다. 단계마다 계속할지 묻거나 계획만 제시하고 종료하지 않는다.
- 실제 서버·nuScenes·GPU 접근이 없더라도 가능한 코드 구현·계약/계산 검증을 계속하고 정확한 통합 미검증 항목을 남긴다. 예시 데이터 검증만으로 실제 연동 완료를 선언하지 않는다.
- Vitest로 DTO 변환, timestamp mapping, 투영 축·clipping, idempotency/GET 재시도, A/B 독립 경계를 확인한다.
- Playwright로 탐색·확대·비교·재생·job 복원·실패 복구와 주요 화면 크기를 확인한다.
- 백엔드/AI를 바꾸면 관련 Spring/pytest 검증을 수행하고 실행 환경 제약을 기록한다.
- 실제 mini 검증은 dataset/version, scene/sample/job/recording, 브라우저/크기, 결과와 증거를 남긴다.
- 장시간 GPU 실행·대규모 모델 다운로드·기존 데이터 삭제는 일반 UI 검증의 일부로 자동 실행하지 않는다.

5. 작업 기록과 종료 보고

- 작은 기능 묶음마다 docs/frontend-implementation-checklist.md의 체크 상태·결정·검증·다음 재개 지점을 갱신한다.
- 실제 API 확장은 README_API.md, 실행/환경/배포 변경은 README 및 예제 설정, 기능 변경은 기획서에 반영한다.
- typecheck, build, 관련 테스트, git diff --check를 실행하고 실패·미실행도 그대로 보고한다.
- node_modules, dist, .env, 모델, dataset, 생성 JSON/NPZ/.rrd, screenshots/test reports를 commit하지 않는다.
- 새 PR/push/공개 배포는 별도 요청 범위를 확인한다. main에 직접 push하지 않는다.
- 마지막에는 구현한 범위, 실제 데이터 연결 여부, 실행한 검사와 결과, 남은 미검증/막힌 항목, 다음 재개 지점을 명확히 알려준다.

이제 저장소와 문서를 확인하고 실제 구현을 시작해줘.
```

## 다음 세션에서 이어갈 때

```text
CLAUDE.md와 docs/frontend-implementation-checklist.md를 읽고, 현재 git 상태·코드를 먼저 확인해줘. 완료 항목을 다시 만들지 말고 다음 재개 지점부터 frontend-product-plan.md의 이번 범위를 이어서 구현해줘. 검증 결과와 남은 항목을 체크리스트에 갱신하고, 코드 구현과 실제 데이터 통합 확인을 구분해서 보고해줘.
```
