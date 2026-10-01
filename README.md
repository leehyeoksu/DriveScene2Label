# DriveScene2Label — nuScenes 데이터 DB

Spring Boot 4.1.1 / Java 21 / Spring Data JDBC / PostgreSQL로 nuScenes 원본 정보를 저장하고 조회합니다.
사진·LiDAR·지도 파일은 원래 폴더에 두고, DB에는 상대경로와 장면·센서·위치·정답 박스 정보를 저장합니다.
현재 범위는 원본 데이터 조회입니다. VESPA 실행, 예측 라벨 저장, 3D 뷰어는 아직 구현하지 않았습니다.

## 먼저 실행하기 (Ubuntu / WSL 터미널)

프로젝트 폴더에서 실행합니다.

```bash
bash scripts/local-db.sh
bash scripts/run-local.sh import
bash scripts/run-local.sh run
```

- 첫 번째: 프로젝트 `.local/postgres`에 PostgreSQL 16을 준비하고 실행합니다. 시스템 설치나 sudo가 필요하지 않습니다. Ubuntu 24.04의 apt 패키지를 이용합니다.
- 두 번째: 테이블을 자동 생성하고 실제 JSON을 읽어 DB에 저장합니다. 완료 후 종료합니다.
- 세 번째: 조회 API를 `http://localhost:8080`으로 실행합니다. 종료는 Ctrl+C입니다.
- 이미 같은 데이터를 가져왔으면 import를 반복해도 레코드가 중복되지 않습니다.
- DB를 중지하려면 `bash scripts/local-db.sh stop`을 실행합니다.
- DB 데이터와 임의 생성한 비밀번호는 `.local/`에 보관하며 Git에서 제외합니다.

기본 데이터 루트는 `/home/hyuksu/Cap_Project_Data/v1.0-mini`입니다. 이 경로 아래에 `samples`, `sweeps`, `maps`, `v1.0-mini`가 있어야 합니다.
경로가 달라지면 실행 전에 `NUSCENES_ROOT` 환경변수를 설정합니다. 서버는 WSL에서 실행하는 구성을 검증했습니다.

## 조회 환경

현재 검증한 실행 환경은 WSL입니다. WSL 내부의 `http://127.0.0.1:8080`에서 HTTP 조회와 파일 다운로드를 확인했습니다.
이 PC에서는 Windows의 localhost 전달이 작동하지 않아 Windows 브라우저 접속은 아직 사용할 수 없습니다. Windows/WSL 네트워크 설정은 변경하지 않았습니다.
WSL 터미널에서는 아래처럼 바로 확인할 수 있습니다.

```bash
curl http://127.0.0.1:8080/api/datasets/1/stats
bash scripts/db-shell.sh -f docs/queries.sql
```

## 브라우저로 조회하기

1. `http://localhost:8080/api/datasets`에서 데이터셋 ID 확인
2. `/api/datasets/{id}/scenes`에서 장면 ID 확인
3. `/api/scenes/{id}/samples`에서 프레임 ID 확인
4. `/api/samples/{id}`에서 카메라·LiDAR·Radar·지도 연결 확인
5. 응답의 `contentUrl`을 열면 실제 파일을 받습니다. JPG와 PNG는 브라우저에서 표시되며, LiDAR/Radar는 바이너리 파일입니다.

처음 등록한 실제 데이터의 예시:

- `/api/datasets/1/stats`: 씬 10개, 프레임 404개, 센서 파일 31,206개, GT 박스 18,538개
- `/api/samples/1`: 카메라 6개 + LiDAR 1개 + Radar 5개 + 지도
- `/api/samples/1/annotations`: 해당 프레임의 GT 박스 69개

ID는 DB가 생성한 숫자이고, `token`은 nuScenes 원본 식별자입니다. 다른 DB에서는 ID를 목록에서 확인하세요.

## 어떤 파일이 어떤 일을 하나요?

| 위치 | 역할 |
|---|---|
| `build.gradle` | 라이브러리 의존성 선언. `gradlew`는 Gradle을 실행하는 도구 |
| `src/main/resources/application.properties` | DB 접속, 데이터 루트, 서버 설정 |
| `src/main/resources/db/migration/V1__nuscenes_catalog.sql` | 테이블·외래키·인덱스 생성. Flyway가 최초 실행 시 적용 |
| `src/main/java/com/example/demo/nuscenes/domain` | DB 레코드를 표현하는 Java 객체 |
| `.../repository` | Spring Data JDBC 조회 기능 |
| `.../importer` | JSON을 읽어 DB에 등록 |
| `.../api` | HTTP 조회와 파일 응답 |
| `.../storage` | 데이터 루트 안의 파일 경로 확인 |
| `docs/queries.sql` | 직접 실행할 수 있는 테이블 조회 SQL |

Spring Data JDBC를 사용하며 JPA는 사용하지 않습니다. `@Table`, `@Id`로 객체를 매핑하고, 조회는 Repository 및 JdbcClient, 대량 입력은 NamedParameterJdbcTemplate으로 수행합니다.
테이블 변경은 Java 객체를 바꾸는 것만으로 반영되지 않습니다. 후속 `V2__...sql` 등의 마이그레이션을 추가해야 합니다. 적용된 V1 파일은 수정하지 마세요.

기존 JDBC·PostgreSQL 의존성을 유지하고 `spring-boot-starter-flyway`, `flyway-database-postgresql`을 추가했습니다. 버전은 기존 Spring Boot dependency management가 관리합니다.

## 데이터 관계

```text
Dataset
 └─ Scene ── CaptureLog ── MapLog ── MapAsset
     └─ Sample
         ├─ SampleData ── CalibratedSensor ── Sensor
         │       └─ EgoPose
         └─ GtAnnotation ── ObjectInstance ── Category
                  ├─ Visibility
                  └─ AnnotationAttribute ── Attribute
```

- `samples`와 `sweeps` 모두 `sample_data`에 저장합니다. `is_key_frame`이 둘을 구분합니다.
- 기본 프레임 조회는 키프레임만 반환합니다. `/api/samples/{id}?keyframesOnly=false`로 연결된 sweep도 확인합니다.
- 사진 방향은 `sample_data → calibrated_sensor → sensor.channel`로 찾습니다.
- 촬영 위치는 파일별 ego pose로 연결합니다. sweep의 시각은 키프레임 시각과 다르므로 합칠 때 별도 좌표 변환이 필요합니다.
- 박스 중심은 지도 좌표, 크기는 width/length/height, 회전은 quaternion w/x/y/z입니다. 원본 시각은 BIGINT 마이크로초로 보존합니다.
- 지도 파일은 도로 영역 마스크입니다. 지도 위 차량 표시에는 별도 미터→픽셀 변환이 필요합니다.
- 원본 JSON은 `raw_payload` JSONB에도 보존합니다. 보통 조회는 별도 컬럼을 사용합니다.
- 토큰 관계는 dataset ID와 함께 외래키로 검사합니다. 원본 prev/next, first/last 포인터는 부분 데이터셋도 보존할 수 있도록 텍스트로 유지하고, 빈 prev/next는 NULL로 바꿉니다.
- mini의 map에는 mini 밖의 log 토큰도 있습니다. 존재하는 log만 연결하고 제외 개수를 로그에 남깁니다. 실제 mini에서는 75개가 제외됩니다.
- 메타데이터 가져오기는 하나의 트랜잭션이며, 파일 누락·참조 오류 시 완료되지 않습니다. 동일 버전의 메타데이터 내용이 바뀌면 혼합 입력을 거부합니다.
- 현재 하나의 `nuscenes` 저장소 루트만 설정합니다. 여러 물리적 데이터 루트를 동시에 서비스하려면 storage_key별 루트 설정을 확장해야 합니다.

## API 목록

| 요청 | 결과 |
|---|---|
| `GET /api/datasets` | 데이터셋 목록 |
| `GET /api/datasets/{id}/stats` | 테이블별 개수 |
| `GET /api/datasets/{id}/scenes` | 씬 목록 |
| `GET /api/datasets/{id}/categories` | 원본 클래스 목록 |
| `GET /api/scenes/{id}/samples?limit=100&offset=0` | 시간 순 프레임 목록, limit 1~500 |
| `GET /api/samples/{id}` | 센서 파일·지도·차량 위치 |
| `GET /api/samples/{id}/annotations` | GT 박스 |
| `GET /api/sensor-files/{id}/content` | 센서 원본 파일 |
| `GET /api/sensor-files/{id}/calibration` | 센서 캘리브레이션 |
| `GET /api/sensor-files/{id}/pose` | 차량 위치·회전 |
| `GET /api/maps/{id}/content` | 지도 PNG |

존재하지 않는 ID는 404, 잘못된 페이지 범위는 400을 반환합니다. 파일 경로를 직접 요청받지 않고 DB ID로 찾으며, 루트 밖의 경로와 외부를 가리키는 심볼릭 링크는 차단합니다.

## SQL로 직접 테이블 조회

```bash
bash scripts/db-shell.sh -f docs/queries.sql
# 직접 SQL 입력하기
bash scripts/db-shell.sh
```

DB 접속 주소는 `127.0.0.1:55432`, 데이터베이스와 사용자는 `drivescene`입니다. 비밀번호는 `.local/postgres/password`에 있으며 저장소에 포함하지 않습니다.
다른 PostgreSQL을 쓰려면 `DB_URL`, `DB_USERNAME`, `DB_PASSWORD`를 설정하고 `bash gradlew bootRun`으로 실행합니다. 현재 로컬 개발 구성이며 서버는 기본적으로 루프백 주소에만 바인딩합니다.

## 검증

```bash
bash scripts/local-db.sh
bash scripts/run-local.sh test
```

실제 PostgreSQL의 별도 `drivescene_test` DB에서 Flyway와 JDBC 매핑, 중복 가져오기, 프레임·지도·GT 조회, 파일 응답, 오류 응답, 경로 제한을 검증합니다. 테스트 데이터는 직접 만든 작은 가상 데이터이며 원본 이미지가 아닙니다.
다른 테스트 DB를 사용할 경우 `TEST_DB_URL`, `TEST_DB_USERNAME`, `TEST_DB_PASSWORD`를 설정하세요.

개발 시 실제 nuScenes mini를 등록하고 첫 프레임의 JPG·LiDAR·지도 HTTP 응답이 원본 파일과 바이트 단위로 동일함을 확인했습니다.

참고: [Spring Data JDBC 조회](https://docs.spring.io/spring-data/relational/reference/jdbc/query-methods.html), [nuScenes 원본 스키마](https://github.com/nutonomy/nuscenes-devkit/blob/master/docs/schema_nuscenes.md).

## Git에 올리는 범위

소스 코드, Gradle 설정·Wrapper, SQL, 실행 스크립트, 문서, 작은 가상 JSON 테스트 데이터만 저장합니다.
nuScenes 원본 데이터, 사진·점군, 로컬 PostgreSQL 데이터와 비밀번호, 모델 가중치, 중간·최종 출력, 빌드 결과는 제외합니다.
테스트에 필요한 가상 센서 파일은 테스트 실행 시 임시 폴더에 생성하므로 사진이나 LiDAR 바이너리를 Git에 올리지 않습니다.

## Docker로 실행하기 (Ubuntu / WSL)

기존 로컬 실행 방식도 계속 사용할 수 있습니다. Docker에서는 `app`(Spring Boot)과 `db`(PostgreSQL 16)를 실행합니다.
Docker DB는 기존 `.local/postgres`와 별개이므로 최초 한 번 import가 필요합니다. 기존 DB를 자동으로 복사하지 않습니다.

### 준비 및 최초 실행

Docker Engine과 Compose v2가 필요합니다. Windows에서는 Docker Desktop을 실행하고
Settings → Resources → WSL Integration에서 Ubuntu 연동을 켠 다음 **Ubuntu 터미널**의 프로젝트 폴더에서 실행하세요.
`docker version`에 Client와 Server가 모두 나오고 `docker compose version`이 성공해야 합니다.

```bash
# 최초 한 번만 복사하고 .env를 편집합니다.
cp .env.example .env
# POSTGRES_PASSWORD를 개발용 비밀번호로 변경합니다.
# NUSCENES_HOST_PATH를 실제 데이터 폴더의 절대경로로 지정합니다.

docker compose build
docker compose up -d db
docker compose run --rm app --spring.main.web-application-type=none --nuscenes.import.enabled=true
docker compose up app
```

데이터 루트 아래에 `samples/`, `sweeps/`, `maps/`, `v1.0-mini/`가 있어야 합니다.
원본 폴더는 컨테이너의 `/data/nuscenes`에 읽기 전용으로 연결됩니다.
경로가 없으면 빈 폴더를 자동 생성하지 않고 오류를 반환합니다.
앱은 UID 10001의 일반 사용자로 실행하므로 원본 폴더를 탐색하고 파일을 읽을 권한이 필요합니다.

이미 로컬 Spring 서버가 8080을 사용 중이면 해당 서버를 종료하거나 `.env`의 `APP_PORT=8081`로 변경하세요.
포트를 바꾸면 아래 API 주소도 해당 포트로 바꿉니다. Docker DB는 호스트 포트를 열지 않으므로 기존 DB의 55432와 충돌하지 않습니다.

최초 import 이후 일반 실행은 다음 한 줄입니다.

```bash
docker compose up --build
```

DB healthcheck 성공 후 Spring이 시작되고 기존 Flyway SQL로 테이블을 준비합니다.
일반 실행은 import를 수행하지 않으므로 새 DB에서 import 전 `/api/datasets` 응답은 `[]`입니다.
import가 성공하면 데이터셋 JSON이 반환됩니다. 같은 원본 데이터로 import를 반복해도 중복 등록되지 않습니다.

### API와 로그 확인

별도 Ubuntu 터미널에서 실행합니다.

```bash
curl --fail http://localhost:8080/api/datasets
# 위 응답에서 확인한 id를 사용하세요. 아래는 id=1인 경우입니다.
curl --fail http://localhost:8080/api/datasets/1/stats
docker compose ps
docker compose logs --tail=100 app db
```

mini 전체 import의 예상 개수는 scene 10, sample 404, sample_data 31,206, gt_annotation 18,538, map_asset 4입니다.
파일 응답까지 확인하려면 scene → sample 조회 후 반환된 `contentUrl`을 요청하세요.
Windows 브라우저 접근은 Docker Desktop의 포트 전달 상태에 따라 확인해야 합니다.

Docker DB에서 SQL을 확인할 때는 기존 로컬 전용 `db-shell.sh` 대신 다음을 사용합니다.

```bash
docker compose exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

### 종료와 데이터 보존

```bash
docker compose down
```

컨테이너와 네트워크를 정리해도 `postgres_data` named volume에 DB가 남습니다.
Compose는 프로젝트 이름을 접두사로 붙여 volume을 관리합니다.

**아래 명령은 PostgreSQL 데이터까지 완전히 삭제합니다. 다시 실행하면 import부터 해야 합니다.**
호스트에 보관한 nuScenes 원본 파일은 삭제되지 않습니다.

```bash
docker compose down -v
```

`.env`의 DB 이름·사용자·비밀번호는 새 DB volume을 초기화할 때 사용합니다.
기존 volume이 있다면 `.env`의 비밀번호만 변경해도 DB 비밀번호가 자동 변경되지는 않습니다.

### 추가한 파일과 동작 원리

| 파일 | 역할 |
|---|---|
| `Dockerfile` | JDK 21과 Gradle Wrapper로 bootJar를 만들고, Java 21 JRE 이미지에 실행 JAR만 복사 |
| `compose.yml` | app/db 연결, DB healthcheck, 포트, 환경변수와 volume 설정 |
| `.dockerignore` | 빌드 입력만 허용하여 로컬 DB·비밀번호·원본 데이터가 빌드 컨텍스트에 들어가지 않도록 제한 |
| `.env.example` | 비밀번호·원본 경로·포트 설정 예시. 복사한 실제 `.env`는 기존 `.gitignore`에서 제외 |

- **이미지**는 실행에 필요한 파일을 담은 묶음이고, **컨테이너**는 그 이미지로 실행한 프로세스 환경입니다.
- 두 컨테이너는 Compose 내부 네트워크에서 통신합니다. 앱의 DB 주소는 `jdbc:postgresql://db:5432/drivescene`입니다.
  `db`는 PostgreSQL 서비스 이름입니다. 앱 안의 `localhost`는 앱 컨테이너 자신을 가리킵니다.
- 앱은 컨테이너 내부에서 `0.0.0.0:8080`으로 요청을 받고, 호스트에는 기본 `127.0.0.1:8080`으로 공개합니다.
- nuScenes는 크고 이미 호스트에 있으므로 이미지에 복사하지 않고 읽기 전용 bind mount로 연결합니다.
  DB에는 기존처럼 메타데이터와 상대경로만 저장합니다.
- PostgreSQL의 `/var/lib/postgresql/data`는 named volume에 연결하여 컨테이너를 교체해도 DB를 유지합니다.
- Dockerfile의 `ENTRYPOINT`가 `java -jar /app/app.jar`이므로 `compose run ... app` 뒤 옵션은 Spring에 전달됩니다.
  import 명령은 웹 서버 없이 실행하고 완료 후 종료합니다.
- Flyway SQL, Spring 설정·API·import 코드, 기존 로컬 실행 스크립트는 변경하지 않았습니다.
- 이미지 빌드는 DB가 필요한 통합 테스트를 실행하지 않습니다. 기존 회귀 테스트는 로컬 DB를 준비한 뒤
  `bash scripts/run-local.sh test`로 실행합니다.

참고: [Docker Compose 시작 순서](https://docs.docker.com/compose/how-tos/startup-order/),
[Compose 서비스 설정](https://docs.docker.com/reference/compose-file/services/),
[PostgreSQL 공식 이미지](https://hub.docker.com/_/postgres).
