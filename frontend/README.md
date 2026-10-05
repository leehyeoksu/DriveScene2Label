# DriveScene2Label 프론트

React 19 + TypeScript + Vite 8 앱이다. 브라우저는 Spring `/api/*`만 호출한다. 개발·미리보기 서버는 `/api`(JSON, JPG, `.rrd`)를 Spring으로 proxy하며 FastAPI·DB 주소는 프론트에 두지 않는다. 기준 문서는 [개발 기획서](../docs/frontend-product-plan.md), [구현 체크리스트](../docs/frontend-implementation-checklist.md), [REST 계약](../README_API.md), [Rerun recording 계약](../docs/rerun-recording.md)이다.

## 실행

```bash
cd frontend
npm ci
cp .env.example .env.local      # 필요 시 API_PROXY_TARGET 변경 (기본 http://127.0.0.1:8080)
npm run dev                     # http://localhost:5173
```

Spring이 다른 PC에 있으면 `API_PROXY_TARGET`을 그 주소로 바꾼다. 배포는 같은 origin의 reverse proxy가 `/api`를 Spring으로 전달하고 나머지 경로에는 `dist/index.html`을 돌려주도록 구성한다(BrowserRouter, 새 탭 링크).

| script | 내용 |
|---|---|
| `npm run typecheck` | `tsc -b --noEmit` |
| `npm run build` | 타입 검사 + 제품 빌드(`dist/`). Rerun WASM(약 51MB, gzip 16MB)은 별도 asset이며 작업대 화면에서만 lazy load |
| `npm test` | Vitest 단위 테스트(기하·DTO 변환·시간·재시도·receipt·A/B 상태·이미지 캐시) |
| `npm run test:e2e` | Playwright. `/api/*`를 실제 DTO 형식 route fixture로 응답하는 UI 흐름 검증(실제 서버 연동 아님) |

Rerun 기술 검증 e2e는 실제 rerun-sdk 0.38.1로 만든 `.rrd`가 있을 때만 실행된다.

```bash
# ai-server/RECORDING.md 의 방법으로 합성 recording 생성 후
DS2L_RRD=/path/to/scene-test.rrd npx playwright test tests/e2e/viewer.spec.ts --project=desktop-1440
```

실행 중인 Spring을 대상으로 한 live 검증(route mock 없음, 데이터 내용과 무관한 검사):

```bash
DS2L_API=http://127.0.0.1:8080 npx playwright test -c playwright.live.config.ts
# 선택: DS2L_LIVE_JOB_ID=<기존 job>  /  DS2L_LIVE_ALLOW_POST=1 (recording 생성 허용)
```

live 검증은 job을 만들지 않는다. VESPA job 생성은 실제 GPU 실행이므로 사람이 화면에서 실행한다.

## 구조

```text
src/
  app/          router, QueryClient, URL 문맥(urls.ts)
  api/          dto.ts(Spring 그대로) → mappers.ts → models.ts, http.ts(오류 모델), queries.ts(query key)
  pages/        SceneSearchPage, SceneWorkspacePage, SceneComparePage
  features/
    frames/     useFrameBundle·usePaneFrames: requested/displayed 프레임, prefetch, 재생
    cameras/    CameraGrid/Tile/Overlay/Dialog
    timeline/   FrameTimeline
    objects/    LayerToggles, ObjectInspector, 예측 연결
    labeling/   JobPanel(생성·receipt·polling·소속 검증), jobLogic
    viewer/     RecordingPanel, RerunViewer, recordingMap
    workspace/  PaneView, 단축키·숨김 탭 정지
  stores/       workspace(single/A/B 패널 상태), layout(선호), toast
  lib/          geometry(투영), time(timeline), jobs(idempotency·receipt), classes(VESPA mapping), imageCache
  styles/       index.css(시안 토큰 + 컴포넌트 스타일)
tests/e2e/      Playwright + fixtures/mockApi.ts
tests/live/     실제 Spring 대상 검증
```

## 상태 책임

| 위치 | 내용 |
|---|---|
| TanStack Query | dataset·scene·samples·sample detail·GT·calibration(`calibratedSensorToken`별)·pose(파일별)·검색·job·recording |
| Zustand | 패널별 dataset/scene/requested·displayed sample/재생/속도/레이어/선택/classMode/job/결과 job/recording/보기 |
| URL | `/scenes?dataset&q`, `/scenes/:id?dataset&sample&job&view=split|six`, `/compare?datasetA&sceneA&sampleA&jobA&…&sync=relative&active=B` |
| localStorage | 배치 선호(`ds2l.layout`), job 생성 receipt(`ds2l.jobReceipts`, 최대 60개). 이미지·점군·결과는 저장하지 않음 |
| 메모리 | 카메라 JPG blob URL LRU(참조 중인 이미지 유지, 나머지 48개 초과 시 revoke·다운로드 취소) |

## 주요 구현 결정

- 카메라 배치는 channel 이름 기준(FL/F/FR, BL/B/BR). 빈 영역 크기에 따라 3×2/2×3을 자동 선택한다.
- 프레임은 sample detail, GT, 카메라별 calibration·pose, 6개 JPG decode가 모두 끝나야 화면에 전환한다. 그 전에는 이전 프레임을 유지하고 “불러오는 중”을 표시한다. 늦은 응답은 다른 sample의 묶음이라 표시 프레임에 섞이지 않는다.
- 재생 간격은 인접 sample `timestampUs` 차이 / 속도(0.5·1·2×). 다음 프레임이 준비될 때까지 기다린다. 탭이 숨겨지거나 작업대를 떠나면 정지한다.
- 투영: `p_world = R·p_local + c`(local x=L, y=W, z=H) → ego pose 역변환 → calibration 역변환 → K. 12개 edge를 near plane(0.1 m)에서 자른 뒤 이미지 사각형으로 clip한다. overlay SVG는 원본 width×height viewBox와 `xMidYMid meet`로 이미지 `object-fit: contain`과 같은 매핑을 쓴다.
- GT 원본 category를 보존하고, 1/3/8종 비교 분류는 VESPA upstream `assets/class_mapping/*.yaml`(commit acb2b6e) 표를 그대로 쓴다. 미매핑은 “비교 분류 없음”.
- job: 사용자 실행마다 새 Idempotency-Key, 응답 유실·502~504는 같은 key로 최대 2회 자동 재시도 후 “같은 요청 다시 보내기”. status 3초 polling, GET 실패는 5초 재시도하며 “연결을 확인할 수 없어요”로만 표시. 완료 결과 GET 실패는 결과만 다시 읽는다.
- job 소속 검증: 서버 job 문맥(sceneToken) → 로컬 receipt → 완료 결과 sampleTokens 순서. 확인 전에는 “작업 대상 확인 필요”, 불일치하면 결과를 연결하지 않는다.
- Rerun: `@rerun-io/web-viewer@0.38.1`. Spring content를 fetch해 `open_channel().send_rrd()`로 전달한다(0.38.1은 `.rrd`로 끝나지 않는 HTTP URL을 recording으로 인식하지 않음). React 타임라인이 기준이며 Viewer의 `sample` 타임라인과 양방향 연결, 자기 echo는 무시한다. 선택은 entity path + instance id → recording metadata의 GT/예측 id로 바꾼다. 비교 화면에서는 활성 패널 하나만 Viewer를 연다.
- 버튼 대비: 주요 파랑 `#216FE5`(흰 글자 4.70:1), hover `#1D64D6`(5.46:1).
