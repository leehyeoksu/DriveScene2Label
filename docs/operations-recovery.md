# 작업·recording 운영 복구 절차

작성 2026-10-05. 대상: 운영자(백엔드/AI 담당). 현재 자동 heartbeat·lease·취소 API는 없다(후속 범위). 이 문서는 수동 복구 절차와, 코드로 보장되는 방어를 구분해 적는다. 단순히 오래 걸린다는 이유로 새 GPU 작업을 다시 제출하지 않는다.

## 코드로 보장되는 것 (검증: Spring `AutoLabelTests.lateResultAfterOperatorFailureIsRejected`, `RecordingTests`, `WorkerConcurrencyTests`)

| 항목 | 동작 |
|---|---|
| 실행 토큰 | worker는 claim 때 새 `execution_token`을 기록한다. 결과 저장은 `status='RUNNING' AND execution_token=<같은 값>`인 행만 COMPLETED/READY로 바꾼다. |
| 늦은 결과 | 운영자가 RUNNING을 FAILED로 정리한 뒤 이전 실행의 결과가 도착하면 저장하지 않는다(예측·artifact 0건, 운영자 사유 유지). 이전 실행의 늦은 실패 기록도 덮어쓰지 않는다. |
| 실행 분리 | VESPA와 recording은 각자 1스레드 scheduler에서 실행된다. 긴 VESPA 호출 중에도 recording은 진행된다. 각 계통은 동시에 1개만 실행하며 AI의 VESPA lock도 유지된다. |
| 유실 READY 파일 | recording root가 읽히고 파일만 없음이 확인되면 content 조회 또는 같은 설정의 생성 요청 시 `FAILED(RECORDING_FILE_MISSING)`로 조건부 전환되고 recording만 새로 만든다. root 자체를 읽을 수 없으면(마운트 누락 등) 유실로 보지 않고 503 `RECORDING_STORAGE_UNAVAILABLE`. |

## 1. RUNNING에서 멈춘 라벨 job

1. 상태 확인: `GET /api/auto-label/jobs/{id}` → `startedAt`, `sceneName`, `classMode`. 상태 GET 실패는 job 실패가 아니다.
2. 실제 실행 확인 (멈췄다고 판단하기 전에 반드시):
   - local: AI 서버 로그의 `[VESPA] job=<id> ... run=<run_id>`로 run 폴더를 찾고 `VESPA_OUTPUT_ROOT/<run_id>/execution.log`와 프로세스(`ps`)를 확인한다.
   - ssh: 로그의 `slurm job <N>`으로 클러스터에서 `squeue -j N`, `sacct -j N`을 확인한다. AI 서버와 연결이 끊겨도 원격 job은 계속 돌 수 있다.
3. 아직 실행 중이면 기다린다. 끝났는데 Spring이 결과를 받지 못했다면(Spring 재시작 등) 그 job은 FAILED로 정리하고, 필요한 경우 사용자가 **새 실행**(새 Idempotency-Key)을 한다. 같은 결과 파일을 수동으로 DB에 넣는 경로는 없다.
4. FAILED 정리(조건부, 다른 상태는 바꾸지 않음):

```sql
UPDATE auto_label_job SET status='FAILED', completed_at=now(),
  failure_reason='operator: worker/AI contact lost', error_code='AI_TIMEOUT'
WHERE id=<id> AND status='RUNNING';
```

   원인을 모르면 error_code는 NULL로 둔다(추측해서 채우지 않는다). 이후 이전 실행의 결과가 도착해도 위 토큰 방어로 저장되지 않는다.
5. ssh에서 원격 job이 아직 살아 있고 결과가 필요 없으면 클러스터에서 `scancel N`을 수동으로 실행한다. 같은 scene/EXP를 다른 곳에서 동시에 실행하면 원격 고정 출력 경로를 공유할 수 있다([VESPA_Seraph.md](../ai-server/VESPA_Seraph.md)).

## 2. RUNNING에서 멈춘 recording

recording은 결과가 파일 하나이고 VESPA를 다시 실행하지 않으므로 같은 방식으로 정리한 뒤 사용자가 recording만 다시 만든다.

```sql
UPDATE scene_recording SET status='FAILED', completed_at=now(),
  failure_reason='operator: exporter contact lost'
WHERE id=<id> AND status='RUNNING';
```

FAILED가 되면 재사용 index에서 빠지므로 같은 요청이 새 recording을 만든다.

## 3. READY인데 파일이 없을 때

- 자동: 위 표의 조건에서 서버가 정정한다. 화면에서는 "같은 recording 다시 열기"가 404 `RECORDING_FILE_MISSING`을 받으면 recording 상태를 다시 읽고 "recording 다시 만들기"를 보여 준다.
- 수동 확인: backend 컨테이너에서 `recording.root`(기본 `/recordings`)가 마운트되어 읽히는지 먼저 본다. 마운트 문제를 유실로 정리하지 않는다.

## 4. 다른 DB로 바뀐 경우

브라우저는 `/api/system/status`의 `instanceId`가 바뀌면 캐시와 화면의 job/recording 선택을 비우고, 이전 instance의 receipt를 새 서버에 연결하지 않는다. 같은 jobId라도 다른 DB의 작업으로 보지 않는다. instance 범위가 없던 v1 receipt와 이전 자동 이전이 만든 `legacy` 항목은 어느 서버에도 연결하지 않고 "확인되지 않은 이전 기록 N건"으로만 표시한다(2026-10-06, FU-02). 운영자가 수동으로 옮기는 경로도 없다. 필요한 작업은 현재 서버에서 jobId로 직접 열어 서버 문맥으로 확인한다.

## 중단·재시작·늦은 응답 검증 (2026-10-06, FU-05)

격리 project `ds2l-fu05`(별도 DB/volume, DB_PORT 55533, APP_PORT 18180)에서 실제 Spring image(`drivescene2label-backend`, 2026-10-05 build, backend 코드는 4adf57b 이후 변경 없음)와 **fake AI**(호스트 Python stdlib 서버, `/auto-label`·`/recordings`를 붙잡았다가 성공 또는 `VESPA_FAILED`/`RECORDING_EXPORT_FAILED`로 응답)를 사용했다. 데이터는 합성 1 scene이며 서버의 SYNTHETIC 차단을 피하려고 이 격리 DB만 origin을 UNKNOWN으로 import했다. VESPA·exporter·GPU는 실행하지 않았다. 32/32 검사 통과.

|시나리오|확인한 것|
|---|---|
|S1 job: AI 응답 대기 중 운영자 조건부 FAILED → 늦은 성공|FAILED·운영자 사유 유지, predicted_annotation·artifact 0건|
|S2 job: 운영자 FAILED 후 늦은 `VESPA_FAILED`|사유·error_code(NULL) 덮어쓰지 않음|
|S3 job: 호출 중 backend `docker kill` → 재시작|RUNNING 유지(자동 실패·재claim 없음), AI 재호출 0회, 같은 Idempotency-Key는 같은 job 반환, 운영자 FAILED 후에도 같은 key는 FAILED job 반환, 새 key는 새 job COMPLETED, 이전 job 불변|
|S4 recording: 운영자 FAILED 후 늦은 파일 응답|FAILED·contentUrl 없음, content 409/404, 같은 요청은 새 recording(202) READY, content는 새 파일, job 생성 0|
|S5 recording(예측 포함): export 중 backend kill → 재시작|RUNNING 유지, exporter 재호출 0, 같은 요청은 RUNNING 재사용(200), 운영자 FAILED 후 새 recording READY, job 행 불변|
|S6 recording: 운영자 FAILED 후 늦은 `RECORDING_EXPORT_FAILED`|사유·error_code 유지|

확인된 운영상 한계(설계 그대로, 후속 항목):

- backend가 재시작되면 이전 실행의 RUNNING 행은 운영자가 정리할 때까지 RUNNING으로 남는다(lease 없음). 화면은 계속 "실행 중"으로 보인다.
- 운영자 정리 뒤 도착한 늦은 recording 응답이 쓴 `.rrd` 파일은 DB에 연결되지 않고 recording root에 남는다(`<recordingId>-<executionToken>/`). 자동 정리하지 않으므로 용량 점검 때 DB에 없는 폴더를 확인한다.
- 실제 Seraph(SSH/Slurm) 잔존 job 실험은 접속 정보(D-02/D-03)가 없어 미실행.

## 후속 (이번 범위 아님)

자동 heartbeat/lease와 만료 판단, worker 식별, 원격 Slurm job id 저장과 취소 API, 실행별 원격 output 분리.
