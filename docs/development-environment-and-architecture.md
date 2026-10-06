# DriveScene2Label 개발 환경 및 시스템 구성

> **초기 학습 기록 (2026-10-01)** — 아래 구조·명령·검증 결과는 당시 기준입니다.
> 현재 gpu_local은 frontend·backend·ai-server·db 구성과 웹 업로드·GPU 추론을 사용합니다.
> 현재 설치·실행·포트·검증 범위는 [최신 README](../README.md)를 따르세요.

## 1. 프로젝트 개요

DriveScene2Label은 **nuScenes 데이터셋의 메타데이터를 PostgreSQL에 저장하고 Spring Boot API로 조회하는 프로젝트**입니다.

사진·LiDAR·Radar·지도 파일은 기존 데이터 폴더에 보관합니다. DB에는 파일 자체 대신 파일의 상대경로와 장면·프레임·센서·차량 위치·GT 박스 정보를 저장합니다.

현재 구현 범위는 데이터 가져오기와 조회 API이며, 라벨 편집·예측 결과 저장·3D 뷰어는 아직 구현하지 않았습니다.

## 2. 사용 기술과 버전

| 항목 | 버전 및 구성 | 역할 |
|---|---|---|
| Java | 21 | Spring 애플리케이션 개발·실행 |
| Spring Boot | 4.1.1 | 서버 실행과 애플리케이션 설정 |
| Spring Web MVC | Spring Boot 의존성 관리 적용 | HTTP 요청 처리 및 JSON·파일 응답 |
| Spring Data JDBC | Spring Boot 의존성 관리 적용 | Java 객체와 DB 테이블 매핑 및 조회 |
| PostgreSQL | 16 | 메타데이터 저장과 SQL 실행 |
| Flyway | Spring Boot 의존성 관리 적용 | SQL 기반 테이블 생성·변경 이력 관리 |
| Gradle | 프로젝트 Gradle Wrapper 사용 | 의존성 다운로드·빌드·테스트 |
| Docker Compose | Compose v2 사용 | Spring과 PostgreSQL 컨테이너 구성·실행 |
| 로컬 개발 환경 | Windows + Ubuntu WSL 2 | 프로젝트 개발 및 Docker 명령 실행 |

Spring Boot 버전은 `build.gradle`에 `4.1.1`로 지정되어 있습니다. Java도 같은 파일에서 21을 사용하도록 설정했습니다.

Spring Data JDBC·Flyway·PostgreSQL JDBC 드라이버 등의 라이브러리 버전은 개별적으로 지정하지 않고 Spring Boot의 의존성 관리 설정을 따릅니다.

**이 프로젝트는 JPA를 사용하지 않습니다.** Spring Data JDBC의 `@Table`, `@Id`와 SQL을 사용합니다.

## 3. 전체 구성

```text
사용자 또는 프런트엔드
          │
          │ HTTP 요청
          │ http://localhost:8080/api/...
          ▼
┌──────────────── Docker Compose ────────────────┐
│                                                │
│  app 컨테이너                                  │
│  ├─ Spring Boot 4.1.1                          │
│  ├─ Java 21                                   │
│  ├─ 조회 API                                  │
│  ├─ nuScenes JSON 가져오기                    │
│  └─ 원본 파일 읽기                            │
│          │                                     │
│          │ JDBC 연결                           │
│          │ db:5432                             │
│          ▼                                     │
│  db 컨테이너                                   │
│  └─ PostgreSQL 16                             │
│          │                                     │
└──────────┼─────────────────────────────────────┘
           ▼
   postgres_data volume
   DB 데이터 지속 보관

호스트의 nuScenes 원본 폴더
           │
           │ 읽기 전용 bind mount
           ▼
   app 내부 /data/nuscenes
```

Compose는 `app`과 `db` 두 서비스를 구성합니다. 두 컨테이너는 Compose 내부 네트워크를 통해 통신합니다.

nuScenes 원본 폴더는 별도의 컨테이너가 아닙니다. 호스트에 있는 폴더를 app 컨테이너에 연결해서 사용합니다.

## 4. Spring 애플리케이션 구성

Spring은 크게 다음 역할을 수행합니다.

| 영역 | 주요 역할 |
|---|---|
| `api` | HTTP 요청을 받고 데이터나 파일 반환 |
| `domain` | DB 레코드에 대응하는 Java 데이터 객체 |
| `repository` | Spring Data JDBC 기반 조회 |
| `importer` | 원본 JSON을 읽고 DB에 저장 |
| `storage` | 원본 파일 경로 확인 및 접근 범위 제한 |

### 조회 흐름

```text
HTTP 요청
    ↓
Controller
    ↓
Repository 또는 JdbcClient
    ↓
PostgreSQL 조회
    ↓
Java 객체로 결과 구성
    ↓
JSON 응답
```

단순 조회는 Repository를 사용하고, 여러 테이블을 연결하는 상세 조회와 통계는 `JdbcClient`로 SQL을 실행합니다.

JSON을 대량으로 가져올 때는 `NamedParameterJdbcTemplate`을 사용해 여러 행을 묶어서 저장합니다.

### 파일 조회 흐름

```text
센서 파일 ID로 요청
    ↓
DB에서 파일 상대경로 조회
    ↓
설정된 데이터 루트와 상대경로 결합
    ↓
파일 경로와 접근 가능 여부 확인
    ↓
사진·점군·지도 원본 응답
```

클라이언트가 호스트의 절대경로를 전달하는 방식은 아닙니다. API에 DB ID를 전달하면 서버가 등록된 파일을 찾아 반환합니다.

## 5. PostgreSQL 구성

Docker 환경에서는 공식 `postgres:16` 이미지를 사용합니다.

| 항목 | 기본 설정 |
|---|---|
| Compose 서비스 이름 | `db` |
| 데이터베이스 이름 | `drivescene` |
| DB 사용자 | `drivescene` |
| 비밀번호 | `.env`의 `POSTGRES_PASSWORD` |
| 컨테이너 내부 포트 | `5432` |
| 호스트 공개 포트 | 현재 설정하지 않음 |
| DB 저장 위치 | 컨테이너 내부 `/var/lib/postgresql/data` |
| 지속 저장 공간 | `postgres_data` named volume |

### 저장하는 정보

| 주요 테이블 | 저장 내용 |
|---|---|
| `dataset` | 데이터셋 이름·버전·저장소 정보 |
| `scene` | 주행 장면 |
| `sample` | 장면에 속한 촬영 순간 |
| `sample_data` | 센서 파일 정보와 상대경로 |
| `sensor` | 카메라·LiDAR·Radar 채널 정보 |
| `calibrated_sensor` | 센서 위치·회전·카메라 내부 행렬 |
| `ego_pose` | 촬영 당시 차량 위치·회전 |
| `gt_annotation` | 원본 정답 박스 |
| `category` | 객체 클래스 |
| `map_asset` | 지도 파일 정보 |

핵심 관계는 다음과 같습니다.

```text
dataset
  └─ scene
       └─ sample
            ├─ sample_data
            │    ├─ calibrated_sensor → sensor
            │    └─ ego_pose
            └─ gt_annotation
```

DB에서 사용하는 숫자 `id`와 nuScenes 원본의 `token`은 구분합니다. 원본 데이터 사이의 관계는 주로 `dataset_id`와 `token`을 함께 사용해 연결합니다.

## 6. Docker의 app 구성

app 이미지는 프로젝트 루트의 `Dockerfile`로 만듭니다.

### 빌드 단계

```text
eclipse-temurin:21-jdk-jammy
    ↓
프로젝트 소스와 Gradle Wrapper 복사
    ↓
Gradle bootJar 실행
    ↓
실행 가능한 Spring Boot JAR 생성
```

빌드 단계에는 Java 컴파일이 필요하므로 **JDK 21**을 사용합니다.

### 실행 단계

```text
eclipse-temurin:21-jre-jammy
    ↓
빌드 단계에서 만든 JAR만 복사
    ↓
java -jar /app/app.jar
```

실행 단계에서는 **JRE 21**을 사용합니다. 컴파일 도구와 프로젝트 소스 전체를 실행 이미지에 넣지 않고 JAR를 중심으로 구성합니다.

app은 root가 아닌 일반 사용자로 실행합니다. 따라서 연결된 nuScenes 폴더에 대한 읽기 권한이 필요합니다.

## 7. 컨테이너 사이의 통신과 포트

Spring의 기본 Docker DB 접속 주소는 다음과 같습니다.

```text
jdbc:postgresql://db:5432/drivescene
```

각 부분의 의미는 다음과 같습니다.

| 값 | 의미 |
|---|---|
| `db` | Compose에 정의한 PostgreSQL 서비스 이름 |
| `5432` | PostgreSQL 컨테이너 내부 포트 |
| `drivescene` | 접속할 데이터베이스 |

**app 안에서 `localhost`는 app 컨테이너 자신을 의미합니다.** PostgreSQL은 db 컨테이너에서 실행되므로 `localhost` 대신 `db`를 사용합니다.

API 포트는 다음과 같이 연결됩니다.

```text
호스트 127.0.0.1:8080
          ↓
app 컨테이너 8080
```

app 내부의 Spring은 `0.0.0.0:8080`에서 요청을 받습니다. 호스트에는 기본적으로 `127.0.0.1:8080`으로 공개하며, `.env`의 `APP_PORT`로 호스트 포트를 변경할 수 있습니다.

DB는 현재 호스트에 포트를 공개하지 않습니다. 따라서 Docker DB를 DBeaver에서 직접 연결하려면 별도의 DB 포트 공개 설정이 필요합니다.

## 8. 원본 파일과 DB 데이터 보관 방식

두 종류의 저장 공간을 사용합니다.

### nuScenes 원본은 bind mount

```text
호스트 폴더
/home/hyuksu/Cap_Project_Data/v1.0-mini

          ↓ 읽기 전용 연결

app 컨테이너
/data/nuscenes
```

호스트 경로는 `.env`의 `NUSCENES_HOST_PATH`로 변경합니다.

원본 파일을 이미지에 넣지 않는 이유는 데이터 크기가 크고, 이미 호스트에 보관되어 있기 때문입니다. 앱을 다시 빌드할 때마다 원본 데이터를 복사할 필요가 없습니다.

읽기 전용으로 연결하므로 app이 이 경로를 통해 원본 파일을 수정할 수 없습니다.

### PostgreSQL 데이터는 named volume

```text
postgres_data volume
          ↓
db 컨테이너 /var/lib/postgresql/data
```

DB 데이터를 컨테이너의 임시 저장 공간과 분리합니다. 컨테이너를 삭제하고 새로 만들어도 volume을 유지하면 기존 DB 데이터를 사용할 수 있습니다.

| 명령 | DB 데이터 |
|---|---|
| `docker compose down` | 유지 |
| `docker compose down -v` | volume과 함께 삭제 |

`down -v`를 실행하면 다시 데이터를 가져와야 합니다. 호스트의 nuScenes 원본 폴더는 이 명령으로 삭제되지 않습니다.

## 9. Flyway와 데이터 가져오기

Flyway와 import는 서로 다른 작업입니다.

| 구분 | 역할 |
|---|---|
| Flyway | 테이블·외래키·인덱스 등 DB 구조 준비 |
| nuScenes import | 원본 JSON의 실제 내용을 DB에 저장 |

일반적인 실행 흐름은 다음과 같습니다.

```text
PostgreSQL 시작
    ↓
DB healthcheck 통과
    ↓
Spring 시작
    ↓
Flyway가 미적용 SQL 실행
    ↓
조회 API 실행
```

Compose에는 app이 DB healthcheck 통과 후 시작하도록 설정했습니다. 단순히 DB 컨테이너가 만들어졌다는 이유만으로 app을 바로 실행하지 않습니다.

데이터 가져오기는 별도로 실행합니다.

```bash
docker compose run --rm app \
  --spring.main.web-application-type=none \
  --nuscenes.import.enabled=true
```

이 명령은 웹 서버 없이 Spring을 실행해 JSON을 저장하고 종료합니다. 일반 app 실행에서는 import가 자동으로 수행되지 않습니다.

동일한 메타데이터를 다시 가져오면 중복 저장을 방지합니다. 같은 데이터셋 버전인데 메타데이터 내용이 달라졌다면 기존 데이터와 섞이지 않도록 가져오기를 거부합니다.

## 10. 환경변수와 설정 파일

### 개발자가 설정하는 값

| 환경변수 | 용도 |
|---|---|
| `POSTGRES_DB` | DB 이름, 기본 `drivescene` |
| `POSTGRES_USER` | DB 사용자, 기본 `drivescene` |
| `POSTGRES_PASSWORD` | 개발용 DB 비밀번호 |
| `NUSCENES_HOST_PATH` | 호스트의 원본 데이터 폴더 |
| `NUSCENES_VERSION` | 데이터셋 버전, 기본 `v1.0-mini` |
| `APP_PORT` | 호스트 API 포트, 기본 `8080` |

Compose는 이 값을 이용해 Spring에 `DB_URL`, `DB_USERNAME`, `DB_PASSWORD` 등을 전달합니다.

컨테이너 내부의 `NUSCENES_ROOT`는 `/data/nuscenes`로 설정합니다. 호스트의 원본 경로와 컨테이너 내부 경로가 서로 다르다는 점에 주의해야 합니다.

### 파일별 역할

| 파일 | 역할 |
|---|---|
| `build.gradle` | Spring Boot·Java 버전과 의존성 선언 |
| `gradlew`, `gradle/wrapper/` | 프로젝트에 정해진 Gradle 실행 |
| `Dockerfile` | app 이미지 빌드 및 실행 |
| `compose.yml` | app·db 서비스, 통신, 포트, 저장 공간 정의 |
| `.dockerignore` | Docker 빌드에 포함할 파일 제한 |
| `.env.example` | 환경변수 예시 |
| `.env` | 개인별 실제 설정, Git 제외 |
| `application.properties` | Spring 기본 설정 및 환경변수 연결 |
| `V1__nuscenes_catalog.sql` | 최초 DB 스키마 생성 |

## 11. 기존 로컬 실행과 Docker 실행의 차이

| 구분 | 기존 로컬 실행 | Docker 실행 |
|---|---|---|
| Spring | WSL에서 Gradle로 실행 | app 컨테이너에서 JAR 실행 |
| PostgreSQL | `local-db.sh`로 실행 | db 컨테이너에서 실행 |
| Spring의 DB 주소 | `localhost:55432` | `db:5432` |
| DB 저장 공간 | `.local/postgres` | `postgres_data` volume |
| 원본 접근 경로 | 호스트의 데이터 경로 | `/data/nuscenes` |
| 비밀번호 설정 | 로컬 비밀번호 파일 | `.env` |

두 방식은 모두 유지합니다. **기존 로컬 DB와 Docker DB는 별개의 DB**이므로 기존 로컬 환경에서 import를 완료했더라도 Docker DB에는 최초 import가 필요합니다.

현재 Docker 설정은 팀원 각자의 PC에서 같은 구성을 재현하는 로컬 개발 환경입니다. 여러 팀원이 하나의 서버에 접속하는 공동 운영 환경은 별도로 구성해야 합니다.

## 12. 구현 및 검증 상태

Dockerfile, Compose 설정, 환경변수 예시와 실행 문서를 추가했습니다. 기존 Spring API와 import 코드는 유지했습니다.

기존 테스트 5개, 로컬 실행 JAR 빌드, Compose 설정 검사는 통과했습니다. 실제 Docker 이미지 빌드와 컨테이너 기동은 Docker Desktop 엔진 및 WSL 연동을 준비한 뒤 추가 확인이 필요합니다.
