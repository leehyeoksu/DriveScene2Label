# Docker 통합 구성 및 검증

## 구성

- 추가: `ai-server/Dockerfile`, `ai-server/requirements-vespa.txt`, `compose.gpu.yml`, `scripts/docker-smoke.py`.
- 변경: `Dockerfile`, `compose.yml`, `.env.example`, `.gitignore`, `.dockerignore`, `.gitattributes`, `README.md`, `README_API.md`, VESPA runner 호환 처리.
- 서비스: db(PostgreSQL16+pgvector), backend(Spring), ai-server(FastAPI/CLIP/VESPA).
- 포트: backend8080, AI8000, DB55433. 호스트 loopback만 bind.
- volume: postgres_data(DB), model_cache(`/models`), vespa_results(`/results`), 공통 dataset read-only bind(`/data/nuscenes`). Spring에 results volume은 필요하지 않음.
- 환경: `.env.example` 참조. 실제 .env/비밀번호는 commit하지 않음. 내부 주소는 db:5432, ai-server:8000.
- CPU: 기본 compose에서 자동 사용. GPU: compose.gpu.yml overlay로 NVIDIA 장치 할당.

## 실행

```bash
cp .env.example .env
# 실제 데이터 경로/비밀번호 입력
docker compose up --build -d
# NVIDIA GPU 사용 시 대신:
docker compose -f compose.yml -f compose.gpu.yml up --build -d
```

DB와 AI healthy를 기다려 backend를 시작한다. backend health는 `/api/datasets`로 DB 조회 가능 여부를 확인하며 초기 import가 끝났음을 보장하지는 않는다. import 완료 로그 또는 실제 dataset 목록을 확인한다. smoke script는 초기 빈 dataset 상태를120초까지 기다린다.

## 실제 검증 기록

2026-10-03, Docker Desktop + WSL2, 격리된 `drivescene-verify` Compose project에서 실행. 기존 사용자 DB/volume은 변경하지 않았다.

|검증|결과|
|Compose CPU/GPU config|통과|
|Spring image build|통과|
|AI image build + 원본 VESPA 모듈 import|통과|
|빈 model cache에서 CLIP 다운로드|통과, 약1.6GB cache 생성|
|CPU /health|200, clip ready, device cpu|
|Flyway V1~V4 + mini import|10 scenes,404 samples,31,206 sensor files,18,538 GT boxes|
|CPU 실제 mini image→Spring→FastAPI→DB|STORED,768-d; 반복 호출 SKIPPED|
|CPU 실제 text→CLIP→pgvector→scene|통과, 준비한1개 이미지의 scene 반환|
|GPU 컨테이너 재생성|cache 유지, /health device cuda|
|GPU image 저장/skip 및 scene 검색|통과|
|실제 VESPA scene-0061|실행 결과는 아래 최종 기록 참조|

대상 image token: `03bea5763f0f4722933508d5999c5fd8`. 이미지1개 smoke test이므로 retrieval 품질/전체 scene ranking 평가가 아니다. API/DB 연결 검증이다.

## 발견한 설치·호환 문제

1. upstream nuScenes devkit1.1.11은 Python3.12에서 구형 Shapely build 실패. Docker는1.2.0으로 고정.
2. CLIP NumPy2와 VESPA scientific dependency 충돌을 피하기 위해 VESPA용 system-site-packages venv에서 NumPy1.26.4 등만 override. Torch 대용량 설치는 공유.
3. upstream NumPy 1.x/2.x 별칭 혼용(`bool`, `int`, `concat`, `atan2`)은 runner subprocess 안에서 해당 표준 구현으로 호환. 원본 소스는 수정하지 않음.
4. 전처리에서 CPU 사용률이 약960%로 증가했다. VESPA_NUM_THREADS=1로 BLAS/OMP 병렬화를 제한한 새 실행에서 프레임당 수 초가 대체로1초 미만으로 감소하는 것을 관찰했다. 정밀 benchmark 수치는 아니며 입력/환경에 따라 달라진다.
5. 처음 import 중 HTTP가 열려도 dataset transaction은 아직 미완료일 수 있음. smoke test에 대기 추가.

## 모델과 Git

소스/문서/설정만 commit한다. 다운로드 모델과 원본 VESPA clone은 사용자 저장소에 넣지 않는다. 공식 source/model 링크는 메인 README에 제공한다. Docker image는 약15GB이며 GitHub에 image 자체를 push하는 작업은 하지 않는다. 로컬 caches/결과/.env/venv/Windows metadata는 제외한다.

## 알려진 제약

RUNNING job crash recovery/lease, 취소 API, 결과 pagination, artifact download는 미구현. CPU 전체 VESPA scene 처리시간은 보장하지 않는다. 전역 모델 cache를 지우면 재다운로드가 발생한다. 모델/라이브러리 다운로드와 dataset 준비 없이 완전한 offline 첫 실행은 불가능하다.

## 최종 VESPA 기록

실제 nuScenes mini `scene-0061`, 8class 결과를 Spring API로 요청하고 저장했다. 최종 job4는 2026-10-03 14:55:30 UTC에 COMPLETED.

- 39 sample 전부 result_received_at 기록, predicted_annotation 985개, FINAL_JSON artifact 1개.
- 클래스별 박스: car197, truck112, bus26, trailer8, construction_vehicle31, pedestrian552, motorcycle37, bicycle22.
- 좌표계 WORLD, size 순서 width/length/height, quaternion w/x/y/z, score_type VESPA_CONSTANT, detection_score1.0. 학습된 confidence로 해석하지 않는다.
- GET /api/auto-label/jobs/4/results에서 실제 39 sample/985 boxes 반환 확인.
- GT18,538개 유지. 실패 job1~3의 prediction은0개. 실패 이유와 FAILED 상태 기록 확인.
- canonical JSON SHA256: `6d30d670c04c8a6fa8f698c14ad12b1ad13f7abce64734b4a55a72fcbcaabcab`.
- 결과 경로: `89d2fb72-06cf-46e4-9b56-41eba4eee9cd/outs/vlm/p_final/#out_labels/vlm_p_final_scene-0061_8class.json` (vespa_results volume 안).

검증 방식: 첫 실계산에서 지면 제거382 sweep(약2분55초), GroundingDINO/SAM 분할(약28분), LiDAR 재투영까지 계산했다. NumPy concat 호환 오류를 수정한 재실행은 그 캐시를 재사용하고 DINOv2/병합/속도 추정을 실제 계산했다. atan2 호환 오류 수정 후 최종 재실행은 이전 실행의 원본 단계 캐시를 재사용하여 방향/박스/JSON 생성과 Spring 저장을 검증했다. 최종 job4의 약31초는 캐시 재사용 시간이며 처음부터의 전체 처리시간이 아니다. 캐시 복사 launcher와 Compose override는 격리된 검증 환경에만 적용했고 Git에 포함하지 않는다. 원본 데이터/알고리즘을 줄이거나 mock box를 사용하지 않았다.

Spring 통합 테스트17개, AI API/wrapper 테스트17개 통과. 1class/3class는 wrapper 테스트로 확인했으며 실제 전체 scene 실행은8class만 확인했다. full mini 전체 scene 및 detection/retrieval 품질 평가는 별도 작업이다.
