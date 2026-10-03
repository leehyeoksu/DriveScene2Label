# 자연어 Scene 검색

## 역할 및 데이터 흐름

Frontend -> SceneSearchController -> SceneSearchService -> TextEmbeddingClient -> FastAPI POST /embedding/text -> CLIP -> Spring -> SceneSearchRepository -> PostgreSQL pgvector -> Scene 결과.

- Controller: HTTP 파라미터와 응답 담당.
- Client: FastAPI JSON 요청/응답 DTO 및 연결/읽기 timeout 담당.
- Service: 입력 검증, 모델/차원/정규화 검증, 집계 방식 선택.
- Repository: cosine 연산 및 image_embedding -> sample_data -> sample -> scene JOIN/집계 담당. camera modality도 확인.
- AI는 벡터만 반환하며 DB를 조회/저장하지 않음. 이 검색 요청도 DB에 벡터를 삽입하지 않음.

## 호출

```bash
curl --get http://localhost:8080/api/search/scenes \
  --data-urlencode 'q=rainy night road' \
  --data-urlencode 'k=10'
# 특정 dataset, Scene별 상위 3장 평균
curl --get http://localhost:8080/api/search/scenes \
  --data-urlencode 'q=rainy night road' \
  --data-urlencode 'datasetId=1' \
  --data-urlencode 'aggregation=TOP_K_AVERAGE' \
  --data-urlencode 'imageTopK=3'
```

| 파라미터 | 기본값/의미 |
|---|---|
| q | 필수; trim 후 1..10000자 |
| k | 10; 최종 Scene 수, 1..100 |
| datasetId | 생략 시 모든 dataset, 지정 시 양의 ID로 제한 |
| aggregation | TOP_K_AVERAGE; MAX/AVERAGE/TOP_K_AVERAGE (대소문자 무관) |
| imageTopK | 3; TOP_K_AVERAGE에서 Scene당 평균할 이미지 수, 1..100 |
| keyframesOnly | true; 저장된 keyframe camera embedding만 검색 |

매칭 이미지가 있는 Scene만 반환하며 최대 k개입니다. 검색 범위에 embedding이 없으면 scenes=[]입니다. datasetId가 없는 번호여도 빈 결과입니다. 누락된 embedding은 집계에 포함되지 않습니다.

응답 형태 (수치는 예시):

```json
{
  "query": "rainy night road",
  "modelName": "ViT-L-14-quickgelu/openai",
  "preprocess": "lr-square-crop-mean",
  "aggregation": "TOP_K_AVERAGE",
  "imageTopK": 3,
  "keyframesOnly": true,
  "scenes": [{
    "sceneId": 1,
    "datasetId": 1,
    "sceneToken": "scene-token",
    "sceneName": "scene-0061",
    "description": "...",
    "score": 0.32,
    "distance": 0.68,
    "matchedImages": 240,
    "contributingImages": 3,
    "bestImageId": 7,
    "bestSampleToken": "sample-token",
    "bestImagePath": "samples/CAM_FRONT/image.jpg",
    "contentUrl": "/api/sensor-files/7/content"
  }]
}
```

## 집계 전략

이미지마다 distance = embedding <=> query_vector, similarity = 1-distance입니다. Scene score가 클수록 유사합니다. cosine similarity는 [-1,1] 범위이며 confidence/확률이 아닙니다. 결과의 distance=1-score는 집계된 거리입니다. bestImage는 각 Scene의 최저 거리 이미지로 별도 선정하므로 평균 score와 해당 이미지 점수는 다를 수 있습니다.

| 방식 | 계산 | 특성 |
|---|---|---|
| MAX | 최고 similarity 한 장 | 순간적인 사건 찾기에 유용; 한 장의 오탐/우연한 매칭에 민감 |
| AVERAGE | 저장된 대상 이미지 모두 평균 | Scene 전체 분위기; 다른 방향 카메라와 프레임이 신호를 희석할 수 있음 |
| TOP_K_AVERAGE | Scene별 상위 imageTopK장 평균 | 기본값 3; 단일 매칭과 전체 평균 사이의 절충 |

Scene 이미지 수가 imageTopK보다 적으면 있는 이미지 모두 평균합니다. matchedImages는 필터 후 유효 이미지 전체 수, contributingImages는 실제 집계에 사용한 수입니다. 같은 sample의 여러 카메라가 상위 이미지에 함께 포함될 수 있으며 시간적 지속성을 보장하는 점수는 아닙니다. 나중에 지속성이 필요하면 sample별 camera max -> 상위 sample 평균으로 확장할 수 있습니다.

SQL은 전체 대상 이미지에 cosine distance를 계산하고 scene_id별 순위를 매긴 다음 집계합니다. 이미지 top-k를 먼저 자르면 다른 Scene 후보/평균이 잘못되므로 그렇게 제한하지 않습니다. 같은 scene_token이 다른 dataset에 존재해도 scene.id 기준으로 별도 그룹이며 모든 JOIN은 dataset_id를 포함합니다. 동점 Scene은 datasetId, sceneId 순, 동점 대표 이미지는 sensor file ID 순으로 정렬합니다. zero vector 등으로 유효하지 않은 거리가 나온 이미지도 제외합니다.

## 모델 호환성 / 오류

FastAPI DTO: text 요청, model_name/dimension/embedding/preprocess 응답. Spring은 모델이 embedding.model-name과 일치하고 768차원 finite unit vector(norm squared 허용차 0.001), preprocess=clip-text-tokenizer인지 검증합니다. DB 이미지 필터는 embedding.preprocess (기본 lr-square-crop-mean)를 사용합니다. text preprocess를 image DB 필터로 쓰지 않습니다.

잘못된 q/k/집계 입력은 400, AI HTTP 오류/JSON 오류/모델·벡터 불일치는 502, 연결 실패/timeout은 503입니다. AI 응답이 잘못되면 DB 검색을 실행하지 않습니다. 추론 HTTP 호출은 DB read-only transaction 시작 전에 수행합니다.

## 실행 연결

Host Spring 기본 AI URL: http://127.0.0.1:8000.

```bash
# WSL: AI 실행 (프로젝트 루트)
cd ai-server
source .venv/bin/activate
export HF_HOME="$(pwd)/../.local/clip-model-cache"
export CLIP_IMAGE_ROOT=/home/hyuksu/Cap_Project_Data/v1.0-mini
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --workers 1
```

Compose app의 기본 AI_SERVER_BASE_URL=http://host.docker.internal:8000입니다. AI가 WSL에서 동작할 경우 Docker Desktop의 host/WSL 네트워크에서 접근 가능한 주소여야 합니다. 연결이 안 되면 실제 접근 가능한 AI 주소로 환경변수를 설정하세요. host Spring만 사용하는 경우 127.0.0.1 listen으로 충분합니다.

application.properties 설정: AI_SERVER_BASE_URL, AI_SERVER_CONNECT_TIMEOUT (5s), AI_SERVER_READ_TIMEOUT (30s). 모델/이미지 전처리는 기존 EMBEDDING_MODEL_NAME, EMBEDDING_PREPROCESS 설정을 유지합니다.

기본 구현은 정확한 집계를 위한 full scan입니다. 데이터가 커지면 latency를 측정하고 후보 추출/Scene별 임베딩 캐시 등으로 최적화해야 합니다. ANN 이미지 인덱스만 추가해도 전체 Scene 평균 집계가 자동으로 빨라지는 것은 아닙니다.

## 검증

새 SceneSearchTests는 실제 HTTP 테스트 서버와 pgvector PostgreSQL에서 FastAPI 요청/DTO, 집계 방식별 순위, Scene 개수 제한, 모델·전처리·keyframe 필터, 동일 token의 dataset 분리, 입력 오류, upstream 응답 오류를 검증합니다. AI 테스트 서버는 합성 unit vector를 반환합니다. 실제 CLIP API CUDA 추론은 ai-server의 이전 검증에서 통과했으며 이 테스트는 Spring의 계약/SQL 연결을 검증합니다.

실행: bash scripts/docker-test.sh (기존 DB/volume과 분리된 임시 DB 사용).

참고: https://docs.spring.io/spring-framework/reference/integration/rest-clients.html
pgvector: https://github.com/pgvector/pgvector

2026-10-03 검증 결과: Java 컴파일 및 격리된 pgvector DB에서 전체 Spring 테스트 10개 통과. 새 검색 테스트 4개에 HTTP DTO, 각 집계 방식, dataset/모델/preprocess/keyframe 필터, 입력/AI 오류 검사가 포함됩니다. 기존 DB는 변경하지 않았습니다. 실제 FastAPI를 사용하는 전체 서비스 동시 실행은 별도 운영 연결 확인이 필요합니다.
