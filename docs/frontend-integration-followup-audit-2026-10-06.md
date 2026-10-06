# FU-01~08 후속 결과 검토

검토일: 2026-10-06. 대상: `codex/frontend-implementation`, HEAD `273b8e6` 위의 미커밋 작업 트리. 기존 수정과 검증 기록을 보존했다. 이번 검토는 제품 코드를 변경하지 않았고, 시험 Docker 자원도 삭제/중단하지 않았다.

## 직접 확인한 결과

- 기존 FU-01의 조회 실패 우선 처리·브라우저 시계 기준 유효기간·마지막 확인 표시와 FU-02의 v1/legacy v2 자동 귀속 차단은 코드에 반영되어 있다.
- `npm run typecheck`, `npm test`(5개 파일, 57개 통과), `npm run build`를 다시 실행해 통과했다.
- 후속 recording/접근성 e2e 파일과 결과 기록은 확인했다. 이번 검토에서는 77개 e2e, Docker AI 빌드, worker 중단 실험을 재실행하지 않았다.
- 로컬 status API를 2026-10-06 13:07 KST에 조회했다. instanceId는 기존 `9878f9bb-7800-4b79-97d4-4e949e0c6b19`이며 dataset checksum도 이전과 같다. origin SYNTHETIC, media PARTIAL/CONFIGURED, 검색 CLIP_NOT_DEPLOYED, VESPA SYNTHETIC_DATASET, recording READY다. `18000/health`와 `5174/`도 HTTP 200이었다.
- A/B/C 실제 완료는 여전히 미완료다. arm64 의존성을 바꾼 시험용 이미지의 exporter 통과는 고정된 제품 amd64 이미지나 실제 VESPA 실행 검증을 대신하지 않는다.

## 추가 보완 1: 서로 다른 기능 만료 시간의 화면 갱신

관련: FU-01, I1-03/I1-06, IT-02.

위치: `frontend/src/features/system/useSystemStatus.ts:24`.

현재 expiry effect는 `data/datasetId/qc`가 변할 때 가장 이른 유효기간의 timer 하나만 만든다. timer에서 `setNow`를 호출해도 `now`가 effect의 dependency가 아니므로, 새로운 응답이 오지 않으면 그다음 기능 만료를 위한 timer가 예약되지 않는다.

React + 실제 QueryClient + fetch mock으로 다음 사례를 임시 Vitest 진단 테스트에서 재현했다.

1. 초기 응답: media/search는 15초, VESPA는 60초, recording은 90초 동안 READY.
2. 이후 모든 status GET은 응답 없이 대기한다.
3. 16초 뒤 media의 렌더된 capability는 실행 불가, VESPA는 실행 가능이다.
4. 62초 뒤 VESPA의 렌더된 capability는 여전히 실행 가능이다. 같은 시점에 capability 함수를 직접 다시 평가하면 실행 불가가 나온다.

```text
{"displayedVespa":true,"recalculatedVespa":false}
Expected displayedVespa.canExecute: false
Actual: true
```

진단 테스트 1개는 실패했다. 기존 57개 테스트의 통과와 구분한다. 임시 파일은 검토 후 제거했다. 기존 만료 테스트는 기능들의 만료 시간이 같아 이 사례를 포착하지 못한다.

영향: 렌더 시점에 계산한 실행 버튼/안내가 나중 기능의 만료 시점에 갱신되지 않을 수 있다. 서버 측 POST 준비 검증은 별도로 남아 있으므로 이 재현만으로 실제 추론이 수행됐다고 판단하지 않는다.

수정 방향: expiry 발생 이후 다음 미래 deadline을 다시 예약하고, 새 응답 없이도 각 기능이 만료될 때 UI가 재평가되도록 한다. hidden/visible 복귀와 timer 해제, 무한 timer/GET 루프 방지도 유지한다. 15/60/90초처럼 다른 deadline을 사용하고 재조회가 대기하는 동안 실제 렌더된 버튼이 차단되는 회귀 검증을 추가한다.

## 추가 보완 2: embed.sh의 환경변수 우선순위

관련: FU-07, I4-01, 실제 데이터용 DB 분리.

위치: `scripts/embed.sh:12`.

Compose는 shell의 DB_PORT가 `.env`보다 우선한다. 하지만 embed.sh는 `source "$env_file"`로 shell 값을 덮어쓴 뒤 PGPORT를 설정한다. `.env`에 DB_PORT가 있고 호출 시 다른 DB_PORT를 전달하면 Compose 실행 시 기대한 포트와 달라질 수 있다.

실제 스크립트의 source/PGPORT 설정 두 줄만 추출하여, 별도 임시 환경 파일의 `DB_PORT=55433`과 호출 환경 `DB_PORT=55434`로 실행했다. DB 연결·임베딩·모델 다운로드는 하지 않았다.

```text
Requested DB_PORT=55434, fixture env DB_PORT=55433
PGPORT=55433
exit=0
```

영향: 다른 project를 선택해 준비 여부는 확인하고도 Python 임베딩 프로세스는 이전 포트의 DB에 연결할 수 있다. 실제 해당 DB에 잘못 쓴 사실을 확인한 것은 아니다. `.env`에 DB_PORT가 없는 경우에는 이 덮어쓰기 사례가 발생하지 않는다.

수정 방향: 호출 환경의 명시적인 DB_PORT를 보존하거나 실제 데이터 전용 ENV_FILE을 일관되게 사용하도록 실행 계약을 정한다. project 선택과 PGHOST/PGPORT/DB 및 원본 root의 조합이 맞는지 확인한다. 암호를 출력하지 않는다. shell override 있음/없음과 기존 기본값의 작은 스크립트 검증을 추가한다.

## Docker 중단 사건

읽기 전용 docker inspect에서 기존 db/backend와 dadene-db의 마지막 종료 시각이 2026-10-06 03:36:13~14Z로 확인됐고, 03:46Z 재시작 이후 현재 healthy였다. 현 상태의 OOMKilled는 false다. 재시작 뒤의 ExitCode/State는 사건 당시 상태와 동일한 자료라고 가정하지 않는다.

`docker events --since 2026-10-06T03:34:00Z --until 2026-10-06T03:40:00Z`에는 해당 사건이 반환되지 않았다. 이 정보만으로 OOM·Docker engine 재시작·대형 빌드의 인과관계를 확정할 수 없다. 기록된 증상과 복구 상태만 확인된 것으로 남긴다.

## 다음 순서

1. 위 두 경우를 수정하고 좁은 회귀 검증을 수행한다.
2. D-01/D-02를 확보해 CPU로도 가능한 I3(실제 카메라·GT·LiDAR·GT-only recording)를 진행한다. 실제 project는 기존 DB/volume/포트와 분리한다.
3. 제품 amd64 이미지 확인은 적합한 환경에서 진행한다. 현재 Mac의 시험 이미지 결과를 제품 기준으로 승격하지 않는다.
4. CLIP/embedding과 기존 완료 VESPA job을 확보해 I4를 진행하고 신규 추론 여부와 구분한다.
5. 실제 Safari/VoiceOver·원본 성능·Seraph 잔존 job 검증을 필요한 환경에서 마친다.
