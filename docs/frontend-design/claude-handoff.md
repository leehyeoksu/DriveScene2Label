# DriveScene2Label 프론트 시안 인계

## 1. 결과물과 실행

- `index.html` 하나로 동작합니다. 브라우저에서 파일을 열면 됩니다. 서버, 빌드, 네트워크가 필요 없습니다.
- `assets/` 폴더는 없습니다. 카메라 이미지와 LiDAR 점군을 코드가 실행 시점에 합성하기 때문입니다. 외부 이미지를 쓰지 않아 출처·라이선스 문제가 없습니다.
- 외부 의존은 Pretendard 웹폰트(jsDelivr) 하나이며 선택 사항입니다. 막히면 시스템 한글 폰트로 표시되고 레이아웃은 그대로입니다.
- 주소 예시
  - `index.html#/?q=rainy%20night%20road` 검색 결과
  - `index.html#/scene/scene-0553?view=camlidar&frame=12` 카메라 + LiDAR
  - `index.html#/scene/scene-0103?view=cams&frame=1` 6개 카메라
  - `index.html#/compare/scene-0061/scene-1094?fa=10&fb=10&sync=1` 두 씬 비교
- 오른쪽 위 ‘시안 상태’ 메뉴에서 느린 로딩, 카메라 누락, 다음 작업 실패, 검색 오류를 켤 수 있습니다. 저장된 시안 상태 초기화도 여기서 합니다. 이 메뉴는 제품 UI가 아닙니다.
- 카메라 누락은 메뉴 없이도 확인할 수 있습니다. `scene-0796`의 `CAM_BACK_RIGHT`는 21–24 프레임이 항상 비어 있습니다.

## 2. 예시와 실제의 경계

| 영역 | 시안 | 실제 연결 시 |
|---|---|---|
| 씬 설명, 프레임 수, 위치 | 씬 이름만 nuScenes v1.0-mini를 따르고 나머지는 예시 | `GET /api/datasets/{id}/scenes` |
| 카메라 이미지 | `SyntheticCamera`가 합성 (각 채널 다른 시점) | `GET /api/sensor-files/{id}/content` JPG |
| LiDAR / 3D | `LidarSim` 합성 점군을 캔버스로 그림 | Rerun Web Viewer + `.rrd` (현재 제공 API 없음) |
| 박스 투영 | `DemoProjection`: yaw만 쓰는 예시 보정값 | ego_pose와 calibrated_sensor의 전체 quaternion, 카메라 축 변환, intrinsic |
| GT 클래스명 | `_demoCategory` 예시 필드 | GT API에 클래스 필드 추가 필요 |
| 검색 | 태그 동의어로 점수를 흉내 냄 | `GET /api/search/scenes?q=&datasetId=&k=10` |
| 자동 라벨링 | 시간 기반 상태 시뮬레이션, 요청 전송 없음 | `POST /api/auto-label/jobs`, `GET .../jobs/{id}`, `GET .../results` |
| 상태 저장 | 해시 + localStorage (`ds2l.prototype.v1.*`) | React Router 경로 + 필요 시 서버 저장 |

UI 문구로도 경계를 표시했습니다. 센서 화면에 ‘합성 예시’, 자동 라벨링에 ‘시뮬레이션’, LiDAR에 ‘Rerun Web Viewer가 들어갈 자리’ 안내가 붙어 있습니다.

## 3. 백엔드 계약을 지킨 부분

- 프론트는 `/api/*` 형태만 사용합니다. 시안은 `MockBackend.api`로 같은 메서드를 흉내 내며 실제 요청은 보내지 않습니다.
- 숫자 ID(`sceneId`, `sampleId`, `sensorFileId`)와 문자열 token(`sceneToken`, `sampleToken`, `instanceToken`)을 분리했습니다.
- 작업 생성 body는 `{"sceneToken", "datasetId", "classMode"}` 그대로입니다. 인스펙터의 ‘요청 body 보기’에서 확인할 수 있습니다.
- 예측은 `datasetId + sampleToken`으로 프레임에 연결합니다.
- 작업 상태는 PENDING / RUNNING / COMPLETED / FAILED만 씁니다. 2초 간격으로 polling하고 terminal 상태에서 멈춥니다. 진행률과 처리 단계는 표시하지 않고 경과 시간만 보여 줍니다.
- 작업은 씬 전체 단위입니다. 진행 중에는 같은 씬에서 다시 실행할 수 없고, 실패하면 ‘새 작업으로 재시도’로 새 jobId를 만듭니다.
- 박스 값은 WORLD 좌표, 크기 W/L/H, quaternion W/X/Y/Z, timestamp µs 그대로 표시합니다.
- 검색 유사도는 ‘유사도 0.537’처럼 점수로만 표시하고 확률이나 정확도라고 부르지 않습니다.
- `detectionScore`(1.0 고정)는 표시하지 않습니다. 신뢰도 필터도 없습니다.
- `artifact.relativePath`는 ‘다운로드 URL이 아님’ 안내와 함께 텍스트로만 보여 줍니다.
- 수동 박스 편집, 작업 취소, 평가 지표는 동작하는 기능으로 넣지 않았습니다.

## 4. React 전환

### 컴포넌트

`index.html`의 스크립트는 주석으로 8개 구획에 나뉘어 있습니다. 각 템플릿 함수 위의 `[React: …]` 주석이 컴포넌트 경계입니다.

| 컴포넌트 | 시안 위치 | 비고 |
|---|---|---|
| `SceneSearch` | `SearchPageHTML`, `ResultsHTML`, `SceneCardHTML`, `doSearch` | 결과 카드에 새 탭 링크 포함 |
| `SceneWorkspace` | `WorkspaceHTML`, `SingleHTML`, `TopbarHTML` | 보기 모드: camlidar / cams |
| `SceneCompare` | `CompareHTML`, `PaneHTML`, `toggleSync` | 패널 클릭 시 작업 대상 전환 |
| `CameraGrid` | `CameraGridHTML`, `layoutGrid` | 3×2 또는 2×3을 공간에 맞춰 선택. 2열일 때 왼쪽 열은 전방 카메라, 오른쪽 열은 후방 카메라 |
| `CameraTile` | `paintCamera`, `drawTile` | 로딩 / 누락 / 오류 상태 포함 |
| `CameraOverlay` | `drawCameraOverlay`, `drawTag` | GT 노랑 점선, 예측 민트 실선. 선택 시 흰 테두리와 나머지 흐리게 |
| `CameraModal` | `openModal`, `renderModal`, `closeModal` | Esc, 배경 클릭, 포커스 가둠, 닫으면 확대 버튼으로 포커스 복귀 |
| `RerunPanel` | `LidarHTML`, `drawLidar` | Rerun Web Viewer로 교체할 자리 |
| `FrameTimeline` | `TimelineHTML`, `updateTimelines`, `drawStrip` | 띠: 예측이 있는 프레임(민트), 선택한 GT가 보이는 프레임(노랑) |
| `JobControls` | `JobControlsHTML` | |
| `JobStatus` | `JobStatusHTML` | |
| `ObjectInspector` | `ObjectInspectorHTML` | |

### 상태

- `store.views[scene]` → Zustand `useSceneViewStore`. 씬별로 `frame`, `playing`, `speed`, `camera`, `selected`, `layers`, `split`, `paneView`, `classMode`, `jobIds`를 가집니다. 두 씬 비교에서 상태가 섞이지 않는 근거가 이 구조입니다. 같은 씬을 A와 B에 동시에 열 수 없게 막았습니다.
- `store.compare` → `{ ratio, sync, active }`.
- `Q.*` → TanStack Query 캐시로 옮깁니다.

### 데이터 어댑터

`MockBackend.api`와 같은 메서드 이름으로 `HttpAdapter`를 만들고 교체하면 됩니다. 메서드와 엔드포인트 대응표는 스크립트 3번 구획 상단에 있습니다.

권장 Query 키:

- `['datasets']`
- `['scenes', datasetId]`
- `['samples', sceneId, {limit, offset}]`
- `['sample', sampleId]`
- `['annotations', sampleId]`
- `['pose', fileId]`
- `['calibration', fileId]`
- `['search', q, datasetId, k]`
- `['job', jobId]`: `refetchInterval`로 polling하고, terminal 상태가 되면 `false`로 멈춥니다.
- `['jobResults', jobId]`

시안은 40프레임을 한 번에 받습니다. 실제로는 현재 프레임 ±N개를 prefetch하는 편이 좋습니다.

## 4-1. 디자인 토큰 (Toss · Apple 감성 다크 테마)

`index.html`의 `<style>` 맨 앞 `:root` 블록이 토큰 원본입니다. Tailwind로 옮길 때 `theme.extend`에 그대로 매핑하면 됩니다.

- **면**: `--bg #111215`, `--bg-sunk #0A0B0D`(센서 뷰), `--card #1C1D22`(인스펙터 카드), `--raised #26272D`(입력, 내부 카드). 선 대신 이 단계로 영역을 나눕니다.
- **글자**: `--tx-1 #F2F4F6`, `--tx-2 #B0B8C1`, `--tx-3 #8B95A1`, `--tx-4 #6B7684` (Toss 회색 계열)
- **행동 색**: `--accent #2272EB`(주요 버튼, 흰 글자 대비 4.5:1 이상), `--accent-hover #3182F6`, 약한 버튼 `--accent-soft`
- **데이터 색**: GT `#FFCC4D`(점선), 예측 `#4FE0D5`(실선). 파란색과 겹치지 않게 데이터에만 씁니다.
- **상태**: 대기 회색, 실행 중 파랑, 완료 `#3AD17A`, 실패 `#FF6B63`. 연한 배경 배지로 표시하고 상태 코드(PENDING 등)는 옆에 작게 둡니다.
- **재질**: 카메라, LiDAR, 상단바, 타임라인 위의 컨트롤은 `backdrop-filter: saturate(180%) blur(20px)` 반투명 유리
- **모양**: 반경 6 / 10 / 12 / 16 / 22px. 세그먼트는 Apple식 thumb, 스위치는 iOS식(40×24), 주요 버튼은 높이 52px
- **글꼴**: Pretendard → 시스템(SF Pro, Apple SD Gothic Neo) 순. 제목은 굵게(700–800), 자간 −0.02~−0.035em. 고정폭은 token, 좌표, JSON에만 씁니다.
- **문구**: Toss식 해요체 (“라벨 생성을 마쳤어요”, “아직 실행한 작업이 없어요”)
- **움직임**: 누를 때 0.97배로 줄어드는 반응, 시트·토스트의 짧은 등장. `prefers-reduced-motion`에서는 모두 끕니다.

## 5. 백엔드에 필요한 항목

1. **GT 클래스 이름 필드.** `/api/samples/{id}/annotations` 응답에 category 이름이 필요합니다. 지금은 GT 라벨을 표시할 수 없습니다.
2. **Rerun 연결 경로.** VESPA `visualize=True` 또는 별도 `.rrd` 생성, 저장소, 그리고 프론트가 받을 URL API가 필요합니다.
3. **씬별 작업 목록 조회.** jobId를 다시 찾을 API가 없어 시안은 브라우저에 jobId를 보관합니다. 다른 기기나 팀원과 공유하려면 `GET /api/auto-label/jobs?sceneToken=` 같은 조회가 필요합니다.
4. **같은 씬 중복 실행 정책.** 서버가 409로 막는지 확인이 필요합니다. 시안은 프론트에서만 막습니다.
5. **예측 결과의 트랙 ID.** 없어서 예측 박스 선택은 그 프레임 안에서만 유지됩니다. GT는 `instanceToken`으로 프레임을 넘어 유지됩니다.
6. **카메라 이미지 해상도 정보.** 썸네일 또는 축소본이 있으면 검색 카드와 6분할 화면이 가벼워집니다.
7. **검색 결과의 표시 필드.** 응답에 위치, 프레임 수가 없으면 씬 목록과 join해야 합니다. 시안은 join합니다.
8. **실제 투영.** `GET /api/sensor-files/{id}/calibration`, `/pose`의 축 정의와 단위 확인이 필요합니다. 시안의 `DemoProjection`은 그대로 쓰면 안 됩니다.
9. **OpenAPI 타입.** Spring OpenAPI 타입 자동 생성은 후속 작업으로 남아 있습니다. 그전까지는 README_API.md의 계약을 기준으로 합니다.

## 6. 시안에서 정한 가정

- 클래스 모드 대응: 1 = vehicle, 3 = vehicle / pedestrian / bicycle. motorcycle은 1과 3 모두 vehicle로 묶었습니다. VESPA 설정으로 확인이 필요합니다.
- 재생 1×는 키프레임 2 Hz(프레임당 0.5초)입니다. 속도는 0.5× / 1× / 2× / 4×입니다.
- 검색은 k=10이며, 유사도는 소수 셋째 자리까지 표시합니다.
- 상대 위치 동기화는 `B = round(A / (N_A − 1) × (N_B − 1))`입니다. 동기화 중에는 한쪽만 재생합니다.
- 프레임을 단계 이동하면 재생이 멈춥니다.
- 레이어를 끄면 해당 레이어에서 선택한 객체도 선택 해제됩니다.
- 작업 시뮬레이션은 PENDING 약 1.5–2.4초 후 RUNNING, 약 7초 후 terminal 상태가 됩니다.
- 보기 모드 경로는 `/scenes/:id?view=&frame=`, `/compare/:a/:b?fa=&fb=&sync=`을 권장합니다.

## 7. 검증 기록

Chromium(headless, Playwright)에서 실제로 클릭하고 키를 눌러 확인했습니다. 콘솔 런타임 오류는 0건이었습니다. 폰트 CDN 403은 이 환경의 네트워크 차단 때문입니다.

**흐름**

- 검색, 결과, 작업대, 씬 목록 복귀가 동작합니다. 검색 결과 없음과 검색 오류 상태도 확인했습니다.
- 해시로 씬, 모드, 프레임이 복원됩니다. 새로고침 후 비교 경로와 작업 기록도 복원됩니다.

**작업**

- 작업 실행 중 버튼이 비활성화되고, PENDING에서 COMPLETED로 바뀝니다.
- 완료 후 예측 박스가 목록, 이미지, LiDAR에 표시됩니다.
- 실패 시 오류 안내가 나오고, 재시도하면 새 jobId가 생깁니다.

**표시와 선택**

- GT 레이어를 끄면 목록에서도 사라집니다.
- 목록 선택, 카메라 박스 클릭, LiDAR 박스 클릭 모두 같은 선택으로 이어집니다. Esc로 해제됩니다.

**재생**

- 재생, 일시정지, 4× 속도, ←/→, Space가 동작합니다.
- 프레임 1회 갱신(6개 카메라와 LiDAR 합성)은 평균 약 22 ms입니다.

**확대 모달**

- 열기, 카메라 전환, 모달 안 프레임 이동이 됩니다.
- Esc 또는 배경 클릭으로 닫히고, 포커스가 확대 버튼으로 돌아갑니다. Tab 포커스는 모달 안에 머뭅니다.

**레이아웃과 3D**

- 분할 경계는 드래그, 키보드, 기본 배치 복원이 됩니다.
- 6개 카메라 모드는 3×2 배치입니다.
- LiDAR 드래그 회전, 키보드 회전, 위에서 보기가 됩니다.

**비교**

- B 조작이 A 프레임과 작업에 영향을 주지 않습니다.
- B를 조작하면 작업 대상이 B로 바뀝니다.
- 동기화하면 A 20번째 프레임일 때 B가 같은 비율 위치로 이동합니다.
- 카메라 누락 타일이 표시됩니다.

**크기**

- 1440, 1280, 1024, 768, 375 px에서 가로 넘침과 잘린 버튼이 없습니다.
- reduced-motion 설정에서도 동작합니다.

**미검증**

- Safari, Firefox
- 실제 터치 기기의 드래그와 핀치 (LiDAR는 핀치 확대를 구현하지 않았고 버튼과 휠만 지원)
- 스크린리더 실제 낭독 (VoiceOver, NVDA). 마크업과 live region만 확인했습니다.
- Pretendard 실제 적용 모습
- claude.ai 미리보기 안에서의 localStorage와 주소 해시 동작. 막히면 저장 없이 동작하고, 메뉴에 그 사실을 표시합니다.
- 장시간 재생 시 메모리. 이미지 캐시는 54장으로 제한했습니다.
- 저사양 기기와 고 DPI 4K 화면 성능

## 8. 이미지 출처와 교체 위치

- **카메라:** `SensorSource.cameraImage(scene, frame, channel, size)`를 `api.sensorContentUrl(fileId)`의 JPG로 바꿉니다. `<img>`, 또는 `createImageBitmap(await fetch(url).then(r => r.blob()))`를 쓰면 됩니다. 오버레이는 이미지 원본 크기 기준으로 그리므로 1600×900 이외 해상도는 intrinsic과 함께 넘겨야 합니다.
- **LiDAR:** `RerunPanel`(`LidarHTML`, `drawLidar`)을 Rerun Web Viewer 임베드로 바꿉니다. 선택 동기화(Rerun 엔티티 선택과 `selected`)는 별도 설계가 필요합니다.
- **합성 생성기:** `buildWorld`, `SyntheticCamera`, `LidarSim`, `MockBackend`는 실제 제품에서 삭제할 시안 전용 코드입니다.
