# Docker 통합 구성 및 검증

## 구성

- 추가: `ai-server/Dockerfile`, `ai-server/requirements-vespa.txt`, `compose.gpu.yml`, `scripts/docker-smoke.py`.
- 변경: `Dockerfile`, `compose.yml`, `.env.example`, `.gitignore`, `.dockerignore`, `.gitattributes`, `README.md`, `README_API.md`, VESPA runner 호환 처리.
- 서비스: db(PostgreSQL16+pgvector), backend(Spring), ai-server(FastAPI/CLIP/VESPA).
- 포트: backend8080(`APP_PORT`), AI8000(`AI_PORT`), DB55433(`DB_PORT`, 2026-10-06부터 변경 가능). 호스트 loopback만 bind.
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

## 별도 Compose project 포트 분리 (2026-10-06)

실제 데이터 검증용 project를 기존 테스트 project와 함께 띄울 때 사용한다. 서로 다른 project 이름은 container·network·volume(`<project>_postgres_data` 등)을 분리하지만, 호스트 포트는 `APP_PORT`·`AI_PORT`·`DB_PORT`로 따로 바꿔야 한다. 이전 `compose.yml`은 DB 포트가 55433으로 고정되어 project 이름이나 APP_PORT만 바꾸면 두 번째 db가 포트 충돌로 시작하지 못했다.

```bash
# 예: 실제 mini 원본 검증용 project (경로·origin은 실제 제공된 값으로. 추정 금지)
export COMPOSE_PROJECT_NAME=ds2l-actual APP_PORT=18080 AI_PORT=18001 DB_PORT=55434   # 사용 중인 포트는 lsof -nP -iTCP -sTCP:LISTEN 으로 먼저 확인
export NUSCENES_HOST_PATH=<제공된 mini root> NUSCENES_DATA_ORIGIN=NUSCENES NUSCENES_IMPORT_ENABLED=true
docker compose --env-file .env config --format json | python3 -c 'import json,sys; c=json.load(sys.stdin); print({n:[p["published"] for p in s.get("ports",[])] for n,s in c["services"].items()})'
docker compose --env-file .env up -d db backend          # 제품 ai-server도 build·시작된다 (depends_on)
# 제품 AI 없이: docker compose --env-file .env -f compose.yml -f <override> up -d db && ... up -d --no-deps backend
```

- 임베딩(`scripts/embed.sh`)도 같은 project/DB를 가리켜야 한다. 실제 데이터용 project는 전용 env 파일(예: git-ignore된 `.env.actual`에 `COMPOSE_PROJECT_NAME`, `DB_PORT`, `NUSCENES_HOST_PATH`, `NUSCENES_DATA_ORIGIN`, DB 자격 증명)을 두고 Compose와 embed를 같은 파일로 실행한다: `docker compose --env-file .env.actual up -d db backend`, `ENV_FILE=.env.actual bash scripts/embed.sh`. embed.sh의 DB 포트 우선순위는 Compose와 같다(호출 시 `DB_PORT` → env 파일 `DB_PORT` → 55433, 2026-10-06 수정. 이전에는 env 파일 값이 호출 값을 덮어썼다). 데이터 root는 `NUSCENES_ROOT` → env 파일의 `NUSCENES_HOST_PATH` 순서이며 env 파일 값이 shell 값을 덮어쓰므로, 다른 원본을 쓰려면 env 파일에 적는다. 회귀 검사: `bash scripts/tests/embed-db-port.sh`(stub만 사용, DB·Docker·모델 접속 없음).
- shell 환경변수가 `.env` 값보다 우선한다. `docker compose config` 출력에는 DB 비밀번호가 포함되므로 그대로 공유·기록하지 않고 위처럼 필요한 필드만 본다.
- `depends_on`을 override로 바꾸려면 Compose의 `!override`/`!reset` 태그를 쓴다(확인: Docker Compose v5.0.2). 목록 병합 규칙 때문에 일반 override로는 기존 `ports`·`volumes` 항목을 제거할 수 없다.
- 기존 project의 volume은 지우거나 재생성하지 않는다. project를 정리할 때도 `down -v`는 해당 project 소유 volume만 지우므로 project 이름을 반드시 확인한다.

검증(2026-10-06, macOS arm64, Docker Desktop, Compose v5.0.2):

|검사|결과|
|---|---|
|`docker compose -p <새 이름> --dry-run up -d db backend`(override 없음)|`ai-server` image build와 container 생성이 포함됨 → 제품 AI가 함께 시작됨을 확인|
|recording 전용 override + `--no-deps` dry-run|db·backend만 생성|
|기존 project(55433/8080) 실행 중 `ds2l-fu05` project를 DB_PORT=55533, APP_PORT=18180으로 실행|두 db·backend 동시 healthy, 기존 container·volume 변경 없음|
|DB 포트 고정값 재사용(55433) bind 시도|`driver failed programming external connectivity` (충돌 재현)|

## Apple Silicon(arm64)에서 AI image build 제약 (2026-10-06)

- 확인 환경: macOS arm64, Docker Desktop 29.2(linux/arm64 VM). 제품 `ai-server/Dockerfile`은 그대로 build할 수 없다. VESPA venv의 `open3d==0.19.0`에 linux/aarch64 cp312 wheel이 없다(`Could not find a version that satisfies the requirement open3d==0.19.0 (from versions: 0.20.0)`).
- base 계층(`requirements.txt`)은 arm64에서도 설치되지만 PyPI torch 2.14.1 aarch64가 CUDA 13 `nvidia-*` wheel(cudnn 651MB, cublas 543MB 등 약 2.5GB 이상)을 함께 받는다. 느린 회선에서는 pip 기본 timeout(15초)으로 중간 실패할 수 있어 시험 때는 `PIP_DEFAULT_TIMEOUT=300`을 추가했다.
- FU-04 시험 변형(제품 파일 미수정): VESPA venv만 `open3d==0.20.0`, apt `libgfortran5 libegl1` 추가 → 원본 VESPA import·rerun 버전 검사 통과(image 13.9GB). 이 변형은 CLIP 실패 격리·exporter 확인용이며 VESPA 실행 결과의 기준 환경이 아니다.
- 제품 기준 platform은 기존 검증대로 linux/amd64(Docker Desktop + WSL2, NVIDIA)다. `--platform linux/amd64` emulation build와 arm64용 의존성 분기 추가는 실행·결정하지 않았다(VESPA 결과 재현성 확인 필요).
