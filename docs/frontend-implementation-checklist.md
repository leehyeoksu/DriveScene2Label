# 프론트 구현 체크리스트

기준: [개발 기획서 v1.1](frontend-product-plan.md). 문서 준비 브랜치: `codex/frontend-implementation`. 기능별 세부 요구는 기획서 FR-01~24, 검증은 QA-01~17을 따른다.

**현재 상태:** 문서와 기준 시안만 준비됨. 프론트 설치·앱 구현·GT category 확장·Rerun 제공은 시작하지 않음. 이전 백엔드 검증 기록은 이 브랜치의 새 프론트 검증 결과가 아니다.

완료한 항목만 체크한다. 코드가 준비되었지만 실제 데이터 검증을 못 했다면 별도 기록하고 단계 전체를 완료로 체크하지 않는다. 환경 때문에 막힌 작업과 병행 가능한 작업을 구분한다.

## P0 · 준비 및 Rerun 기술 검증

- [x] 수정 HTML·핸드오프 원본과 디자인 결정을 `docs/frontend-design/`에 보관.
- [x] 기존 Spring API를 기준으로 프론트 기획서 v1.1 정리.
- [x] 구현용 브랜치, CLAUDE.md, 체크리스트, 시작 프롬프트 준비.
- [ ] 현재 코드·실행 환경·사용 가능한 실제 dataset/scene/job 확인. local main `88847a9`는 최초 기준이며 작업 시 HEAD를 기록.
- [ ] Python Rerun pin과 웹 Viewer 호환 조합 확인·기록.
- [ ] 작은 실제 .rrd 생성 및 브라우저 로딩·시간 제어·선택 이벤트·resize·자원 해제 검증.

P0 기술 검증이 남아 있어도 M1/M2는 병행한다. SDK 기능 제약이 나오면 변경 근거와 채택 계약을 기록한다.

## M1 · 프론트 기반·실제 API

- [ ] React/TS/Vite, npm lockfile, Router/Query/Zustand, Tailwind/shadcn 구성.
- [ ] `.gitignore`, 예제 환경 설정, `/api` JSON·이미지 proxy, npm scripts, README 실행 안내.
- [ ] 디자인 토큰·앱 shell·탐색/작업대/비교 route 구현.
- [ ] 실제 DTO, HTTP 오류 모델, mapper, query keys 구성.
- [ ] dataset→scene→samples→sample detail 조회, 직접 링크·dataset 복구·pagination 구현.

완료 조건: 실제 목록을 조회하고 선택한 dataset/scene/sample을 URL과 연결한다. 이 단계에 이미지·job 전체 완성을 요구하지 않는다.

## M2 · 6카메라·확대·타임라인

- [ ] 6채널 이름 기반 배치, 실제 JPG, 원본 width/height, 누락·다운로드 오류 상태.
- [ ] 6카메라/카메라+LiDAR 모드, 분할 경계·키보드 조절, 우측 패널 접기.
- [ ] 확대 모달·카메라 전환·Esc·포커스 복귀.
- [ ] sample 이동·timestamp 기반 재생/속도, requested/displayed sample 구분.
- [ ] 이미지/박스 프레임 준비 정책, 인접 prefetch, 이전 응답 배제, 숨겨진 탭 정지·자원 해제.

첫 구현 묶음 완료 조건: 실제 씬의 6개 JPG를 같은 sample로 한 프레임씩 이동하고 확대할 수 있다. M2 전체 완료에는 재생·오류·배치 검수도 포함한다.

## M3 · 검색·VESPA 작업·복원

- [ ] 자연어 검색·대표 이미지/프레임·빈 결과·오류. 실제 `scenes[]` 계약 사용.
- [ ] 실제 sceneToken/datasetId/classMode로 job 생성, 중복 클릭 제한, 실행 receipt 보관.
- [ ] 동일 의도 네트워크 재시도는 같은 Idempotency-Key, 새 사용자 실행은 새 key.
- [ ] status polling·terminal 중단·completedAt 경과 시간·GET 연결 오류 구분.
- [ ] 결과 boxes/sampleTokens 연결, 정상 빈 박스, 이전 완료 결과 보존.
- [ ] 완료 결과 ‘다시 불러오기’, 알려진 jobId URL 복원, job 소속 검증 또는 확인 필요 상태.

완료 조건: 실제 검색→씬→job→결과 확인이 이어지고, 결과 조회 실패가 새 VESPA 실행으로 이어지지 않는다. GPU 추론을 실행하지 못하면 실제 완료 job 조회 검증과 추론 미검증을 구분한다.

## M4 · 투영·GT 클래스

- [ ] GT annotation categoryToken/categoryName JOIN·DTO 보완 및 README_API 갱신.
- [ ] 원본 category 보존, 1/3/8 mapping, 미매핑 처리.
- [ ] 박스 로컬 축·WLH·WXYZ, 카메라별 world→ego→sensor→pixel 변환·clipping.
- [ ] 원본 이미지 크기·object-fit·resize·확대에 맞는 overlay.
- [ ] GT 점선/예측 실선·레이어·객체 목록/선택/상세, 같은 sample 보장.
- [ ] 계산 경계 검증과 실제 이미지/devkit 참고 결과 비교.

완료 조건: 실제 JPG 위에 GT·예측 박스가 올바른 위치로 표시되고 클래스 출처·단위가 명확하다. synthetic yaw 투영으로 통과 처리하지 않는다.

## M5 · Rerun 생성·제공·연결

- [ ] recording API 초안을 실제 계약으로 정리하고 metadata/state/timeline/box mapping 명세 갱신.
- [ ] 원본 센서·GT 및 완료 job 예측의 recording exporter, 재사용·실패 재시도 구현.
- [ ] 저장소·필요한 Compose volume/proxy·Spring metadata/content 제공 연결.
- [ ] 버전 호환 Rerun Web Viewer, WASM 자산·로딩·준비/실패 상태·자원 해제 구현.
- [ ] 공통 타임라인·sample mapping·이벤트 루프 방지·레이어/객체 연결 검증.
- [ ] recording 실패 복구가 VESPA 재실행 없이 동작하는지 확인.
- [ ] 실제 점군·GT·예측을 실제 sample/job과 함께 열고 통합 검증 기록.

완료 조건: 실제 .rrd를 브라우저에서 제공·조회하고 카메라와 같은 프레임을 확인한다. 이 단계가 남아 있으면 이번 범위 전체 완료라고 표시하지 않는다.

## M6 · A/B 비교·최종 검수

- [ ] pane별 dataset/scene/sample/job/레이어/재생/선택 분리. Query cache는 공유 가능.
- [ ] 서로 다른 씬과 동일 씬의 서로 다른 프레임 비교.
- [ ] 활성 A/B 표시·우측 작업 대상·새 탭/공유 URL 일치.
- [ ] timestamp 기반 상대 위치 동기화, off 시 독립, 단일 프레임 예외.
- [ ] 비교 6카메라 및 활성 패널 단일 Rerun 구성 검수. 동시 두 Rerun은 후속 성능 범위.
- [ ] 1440/1280/1024/768/375 화면, 키보드·focus·reduced-motion·버튼 대비 확인.
- [ ] typecheck/build/관련 테스트, QA-01~17, 실제 mini 통합 기록.
- [ ] README/API/기획서/체크리스트를 최종 구현과 일치시킴.

## 검증 기록

아직 이 브랜치의 기능 검증을 실행하지 않았다. 아래 행은 검증을 실제 수행했을 때 추가한다.

| 날짜·HEAD 또는 작업 상태 | 범위 | 명령/사용자 시나리오 | 결과·증거 | 미검증·제약 |
|---|---|---|---|---|

기록 시 unit fixture, HTTP/DB 통합, 실제 mini·모델·브라우저 검증을 구분한다. screenshot·recording 등 생성 결과는 Git 제외 경로에 두고 필요한 재현 정보만 문서에 남긴다.

## 계약·설계 결정 기록

| 날짜 | 항목 | 채택한 결정·이유 | 영향 문서/코드 |
|---|---|---|---|
| 2026-10-04 | 디자인 기준 | 작업 폴더 수정본 사용. 소스 검토 완료, 독립 시각 검수는 미완료 | frontend-design/README.md |
| 2026-10-04 | 상태/실제 연동 | 같은 씬 A/B 허용, 실제 DTO mapper, timestamp 재생 | frontend-product-plan.md |
| 2026-10-04 | 이번 필수 범위 | GT category 보완·Rerun 생성/제공 포함 | 기획서 BE-02~04 |

## 다음 재개 지점·환경 제약

- 다음 작업: P0 환경 조사 및 M1 프론트 기반부터 시작.
- API 주소·실제 dataset 준비·GPU 환경은 아직 이 작업에서 확인하지 않음.
- recording API/버전/저장소의 세부 선택은 구현 과정에서 근거와 함께 기록.
- 기능 구현 완료와 실제 데이터 통합 확인은 서로 다른 상태로 보고.
