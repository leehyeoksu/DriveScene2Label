# Claude Code 만료 타이머·임베딩 DB 포트 보완 프롬프트

작성일: 2026-10-06. FU-01~08 후속 검토에서 재현한 두 경우만 수정하는 실행 프롬프트다. 기준은 [후속 검토 문서](frontend-integration-followup-audit-2026-10-06.md)다.

아래 전체를 Claude Code에 전달한다.

```text
DriveScene2Label의 후속 검토에서 재현한 두 문제를 수정해줘. 계획 설명으로 끝내지 말고 수정 전 실패 재현 → 최소 수정 → 수정 후 회귀 검증 → 문서 갱신까지 완료해줘.

1. 작업 문맥과 범위

- 작업 위치: /Users/jeonwoojin/Documents/ChatGPT/캡스톤/DriveScene2Label. 상위 캡스톤은 별도 저장소다. 실제 Git root/branch/HEAD/status부터 확인해줘.
- 기대 브랜치: codex/frontend-implementation. 검토 기준 HEAD는 273b8e6이며 FU-01~08 구현은 그 위의 미커밋 변경이다. 이후 변경이 있으면 현재 상태를 먼저 대조해줘.
- CLAUDE.md, docs/frontend-integration-followup-audit-2026-10-06.md, docs/frontend-integration-checklist.md, 관련 실제 코드를 읽어줘.
- 이미 완료한 main 병합과 FU-01~08 기본 구현을 반복하지 말고, 기존 사용자 변경과 v1/legacy 이력 격리, recording 문맥/복구 기능을 보존해줘.
- 이번 범위는 아래 두 보완과 관련 검증/문서다. 대형 Docker AI 이미지 빌드, 신규 원격 GPU 추론, 모델/원본 다운로드, 시험 자원 삭제, 다른 서비스 중단은 하지 마. 앞선 Docker 전체 중단 원인은 미확정이므로 빌드 때문이라고 확정하지 마.
- reset --hard/clean/강제 checkout과 DB·volume 삭제를 하지 마. 이번 요청만으로 commit/push/PR 생성하지 마.

2. 보완 A — 서로 다른 capability 만료 시점의 화면 갱신

시작점:
- frontend/src/features/system/useSystemStatus.ts
- frontend/src/api/system.ts
- frontend/src/features/system/useSystemStatus.test.tsx
- frontend/src/features/labeling/JobPanel.tsx
- frontend/src/features/viewer/RecordingPanel.tsx

확인된 재현:
- 현재 expiry effect는 가장 이른 deadline의 timer 하나를 예약한다. setNow 이후에도 dependency가 data/datasetId/qc뿐이라 다음 deadline 예약이 안 될 수 있다.
- 초기 READY: media/search 15초, VESPA 60초, recording 90초. 이후 모든 상태 GET은 응답 없이 대기한다.
- 16초에는 media가 차단되지만, 62초에도 렌더된 VESPA capability는 canExecute=true로 남았다. 같은 시점에 capability 함수를 직접 호출하면 false다.
- 따라서 함수 값을 다시 계산하는 테스트만으로는 부족하며, 실제 렌더 시점의 버튼/표시 값을 검증해야 한다.

수정 요구:
- 첫 만료 이후 다음 미래 deadline을 다시 예약하고, 새로운 응답 없이도 각 기능의 만료 시점에 화면이 갱신되게 해줘. 90초의 recording 만료까지 확인해줘.
- timer는 deadline 변경/언마운트 시 정리하고, 이미 만료된 값으로 0ms timer 또는 반복 GET 루프가 생기지 않게 해줘.
- hidden/visible 복귀, 실패 시 UNKNOWN, STATUS_EXPIRED, 마지막 확인 정보, 브라우저 시계 기준 TTL/최대 응답 나이 정책을 유지해줘.
- 기존 결과·박스·READY recording 조회를 만료 때문에 없애지 마. 새 실행의 UI와 서버 측 검증을 구분해줘.
- fake timers + 실제 QueryClient + fetch mock으로 서로 다른 15/60/90초 deadline과 매달린 GET을 재현하는 회귀 검증을 남겨줘. 렌더 과정에서 계산된 값 또는 실제 DOM 버튼을 확인해줘.
- 만료 전 허용, 각 만료 뒤 차단, 새 정상 응답 뒤 복구, timer 해제와 과도한 재조회 없음도 확인해줘. 테스트 중 새 job/recording POST는 0회여야 해.

3. 보완 B — embed.sh의 DB_PORT 우선순위

시작점:
- scripts/embed.sh
- compose.yml 및 .env.example
- README.md, docs/docker-integration.md

확인된 재현:
- Compose는 shell DB_PORT가 .env보다 우선한다.
- embed.sh는 source "$env_file" 뒤 PGPORT를 설정하므로 .env의 DB_PORT가 호출 환경을 덮어쓴다.
- 임시 .env에 DB_PORT=55433, 호출 환경에 DB_PORT=55434를 주면 PGPORT=55433이 됐다. 실제 DB 연결/쓰기 없이 재현한 것이다.

수정 요구:
- 호출 환경에서 명시한 DB_PORT가 있으면 이를 .env보다 우선하도록 보존해줘. 호출 값이 없으면 선택한 ENV_FILE의 값, 둘 다 없으면 기존 기본값 55433을 사용해줘.
- Docker 준비 확인과 Python embedding 프로세스에 전달하는 port가 일치해야 해. 별도 project/ENV_FILE 사용 방법과 실제 데이터 root/DB 선택도 문서에서 일관되게 설명해줘.
- 환경 파일 전체나 암호를 출력하지 말고 기존 연결 자격 증명을 임의로 바꾸지 마. 이번 보완을 이유로 전체 환경 로더를 불필요하게 재작성하지 마.
- 임시 env 파일과 Docker/Python stub 등으로 실제 DB·모델 없이 검증해줘: shell 값 우선, shell 값 없으면 env 값 사용, 둘 다 없으면 55433. 가능한 경우 source/PGPORT 두 줄만 복사한 검증보다 수정된 실제 script 실행 경로를 통해 전달값을 확인해줘.
- 잘못된 대상 DB에 접속하거나 임베딩을 쓰지 않도록 검증을 격리해줘. bash -n도 수행해줘.

4. 완료와 보고

- 기존 후속 작업의 57 unit/77 e2e 숫자를 이번 실행 결과로 복사하지 마. 두 실패를 먼저 확인하고 수정 후 통과하는 증거를 남겨줘.
- frontend typecheck/test/build와 변경에 맞는 e2e, script 회귀 검증을 실행해줘. Spring/AI를 변경하지 않았다면 이 두 문제 때문에 Docker 빌드와 무관한 전체 서버 검사를 다시 돌릴 필요는 없어.
- docs/frontend-integration-checklist.md에 이번 보완/실행 기록을 추가하고, 기존 R-06~R-13 및 검토 문서는 과거 기록으로 보존해줘. 실행 계약 변경은 관련 README/설정 문서에 반영해줘.
- git diff --check와 변경 파일을 확인해줘. secret/모델/원본/생성물이 섞이지 않게 해줘.
- 한국어 최종 보고에 branch/HEAD, 수정 파일과 동작, 수정 전/후 검사 결과, 데이터 종류, 남은 환경 입력을 적어줘. 이번 수정이 실제 nuScenes/CLIP/VESPA 통합 완료라는 뜻은 아니며 A/B/C는 실제 검증 전까지 미완료로 유지해줘.
- 다음 재개는 D-01/D-02 확보 후 I3의 실제 6카메라·GT·LiDAR·GT-only recording 검증이야. 이번 요청에서 원본이 없다는 이유로 위 두 수정 작업을 멈추지 마.
```
