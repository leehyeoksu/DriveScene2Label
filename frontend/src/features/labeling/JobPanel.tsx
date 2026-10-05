import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Box, RefreshCw, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ClassMode } from '@/api/dto';
import { describeError, isApiError } from '@/api/http';
import type { SampleRef, Scene } from '@/api/models';
import { jobResultsQuery, jobStatusQuery, qk } from '@/api/queries';
import { CLASS_COLORS, CLASS_MODES } from '@/lib/classes';
import { createJob, elapsedMs, formatElapsed, newRunIntent, type RunIntent } from '@/lib/jobs/createJob';
import { findReceipt, receiptsForScene, saveReceipt } from '@/lib/jobs/receipts';
import { useNow } from '@/hooks/useNow';
import { toast } from '@/stores/toast';
import { useWorkspace, type PaneId } from '@/stores/workspace';
import { pollInterval, STATUS_KO, verifyJob } from './jobLogic';
import { useReceipts } from './useReceipts';

interface Props {
  paneId: PaneId;
  scene: Scene;
  samples: SampleRef[];
  /** Compare mode shows which pane (A/B) the actions apply to. */
  paneLabel?: 'A' | 'B';
}

const fmtClock = (t: number) => {
  const d = new Date(t);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
};

export function JobPanel({ paneId, scene, samples, paneLabel }: Props) {
  const pane = useWorkspace((s) => s.panes[paneId]);
  const watchJob = useWorkspace((s) => s.watchJob);
  const showResult = useWorkspace((s) => s.showResult);
  const setClassMode = useWorkspace((s) => s.setClassMode);
  const qc = useQueryClient();
  const receipts = useReceipts();
  const sceneReceipts = useMemo(() => receiptsForScene(receipts, scene.datasetId, scene.token), [receipts, scene.datasetId, scene.token]);
  const sampleTokens = useMemo(() => new Set(samples.map((s) => s.token)), [samples]);
  const jobId = pane.jobId;

  // Restore: no job in the URL → the newest receipt of this scene (shared by every pane showing the scene).
  useEffect(() => {
    if (jobId == null && sceneReceipts[0]) watchJob(paneId, sceneReceipts[0].jobId);
  }, [jobId, sceneReceipts, paneId, watchJob]);

  const statusQ = useQuery({
    ...jobStatusQuery(jobId ?? -1),
    enabled: jobId != null,
    refetchInterval: (q) => pollInterval(q.state.data, q.state.status === 'error'),
    refetchIntervalInBackground: false,
  });
  const status = statusQ.data;
  const completed = status?.status === 'COMPLETED';
  const resultsQ = useQuery({ ...jobResultsQuery(jobId ?? -1), enabled: jobId != null && completed });
  const receipt = jobId != null ? findReceipt(receipts, jobId) : undefined;
  const ownership = jobId != null ? verifyJob(scene, sampleTokens, status, receipt, resultsQ.data) : null;

  useEffect(() => {
    if (jobId != null && completed && ownership?.kind === 'verified') showResult(paneId, jobId);
  }, [jobId, completed, ownership?.kind, paneId, showResult]);

  const active = status?.status === 'PENDING' || status?.status === 'RUNNING';
  const now = useNow(active ? 1000 : null);

  const [pendingIntent, setPendingIntent] = useState<RunIntent | null>(null);
  const run = useMutation({
    mutationFn: (intent: RunIntent) => createJob(intent),
    onMutate: (intent) => setPendingIntent(intent),
    onSuccess: (created, intent) => {
      saveReceipt({
        jobId: created.jobId, datasetId: scene.datasetId, sceneId: scene.id, sceneToken: scene.token, sceneName: scene.name,
        classMode: intent.body.classMode, idempotencyKey: intent.key, requestedAt: Date.now(),
      });
      setPendingIntent(null);
      void qc.invalidateQueries({ queryKey: qk.jobStatus(created.jobId) });
      watchJob(paneId, created.jobId);
      toast(`작업 #${created.jobId}을 만들었어요`, 'ok');
    },
  });
  const lostResponse = run.isError && isApiError(run.error) && run.error.transient;
  const startNewRun = () => run.mutate(newRunIntent({ sceneToken: scene.token, datasetId: scene.datasetId, classMode: pane.classMode }));
  const resendSame = () => { if (pendingIntent) run.mutate(pendingIntent); };

  const busy = run.isPending || (active && ownership?.kind !== 'mismatch');
  const label = run.isPending ? '요청 보내는 중' : busy ? '작업 진행 중' : paneLabel ? `씬 ${paneLabel} 전체 라벨 생성` : '씬 전체 라벨 생성';

  return (
    <>
      <section className="insp-sec" aria-labelledby={`job-h-${paneId}`}>
        <div className="sec-head"><h2 id={`job-h-${paneId}`}>자동 라벨링</h2><span className="sec-aside">VESPA</span></div>
        <div className="target">
          {paneLabel ? <span className={`pane-dot pane-dot--${paneLabel}`}>{paneLabel}</span> : <Box className="icon" aria-hidden="true" />}
          <div>
            <div className="target-name">{scene.name}</div>
            <div className="target-sub">씬 전체 {scene.nbrSamples}개 프레임에 실행해요</div>
          </div>
        </div>
        <div className="field">
          <div className="field-label"><span id={`cm-${paneId}`}>클래스 모드</span><span className="dim">다음 실행에 적용</span></div>
          <div className="seg seg--full" role="radiogroup" aria-labelledby={`cm-${paneId}`}>
            {([1, 3, 8] as ClassMode[]).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={pane.classMode === m} onClick={() => setClassMode(paneId, m)}>{m}개 클래스</button>
            ))}
          </div>
          <div className="class-chips">
            {CLASS_MODES[pane.classMode].map((c) => <span key={c} className="cls-chip"><i className="cls-dot" style={{ ['--c' as string]: CLASS_COLORS[c] }} />{c}</span>)}
          </div>
        </div>
        <button type="button" className="btn btn--primary btn--block" onClick={startNewRun} disabled={busy}>
          {busy ? <span className="spin" aria-hidden="true" /> : <Sparkles className="icon" aria-hidden="true" />}{label}
        </button>
        {busy && !run.isPending && <p className="help">진행 중인 작업이 끝나면 다시 실행할 수 있어요.</p>}
        {run.isError && (
          <div className={lostResponse ? 'alert alert--warn' : 'alert'} role="alert">
            {lostResponse ? (
              <>
                <b>요청 결과를 확인하지 못했어요</b>
                서버가 요청을 받았을 수 있어요. 같은 요청을 다시 보내면 이미 만들어진 작업이 있을 때 그 작업을 그대로 돌려받아요.
                <span className="mono">{describeError(run.error)}</span>
                <button type="button" className="btn btn--sm btn--weak" onClick={resendSame}><RefreshCw className="icon" aria-hidden="true" />같은 요청 다시 보내기</button>
              </>
            ) : (
              <>
                <b>작업을 만들지 못했어요</b>
                <span className="mono">{describeError(run.error)}</span>
              </>
            )}
          </div>
        )}
      </section>

      <section className="insp-sec" aria-labelledby={`st-h-${paneId}`}>
        <div className="sec-head">
          <h2 id={`st-h-${paneId}`}>작업 상태</h2>
          {active && <span className="sec-aside">3초마다 확인</span>}
        </div>
        {jobId == null ? (
          <p className="empty-note">아직 연결된 작업이 없어요. 라벨을 생성하면 상태와 경과 시간을 여기서 볼 수 있어요.</p>
        ) : (
          <div className="job" aria-live="polite" data-testid={`job-card-${paneId}`}>
            <div className="job-row">
              {statusQ.isPending ? (
                <span className="status status--UNKNOWN"><i />확인 중</span>
              ) : status ? (
                <span className={`status status--${status.status}`} data-status={status.status}><i />{STATUS_KO[status.status]}</span>
              ) : (
                <span className="status status--OFFLINE"><i />확인할 수 없음</span>
              )}
              <span className="job-code">작업 #{jobId}</span>
            </div>

            {statusQ.isError && (isApiError(statusQ.error) && statusQ.error.status === 404 ? (
              <div className="alert" role="alert">
                <b>작업을 찾을 수 없어요</b>
                링크의 작업 번호가 이 서버에 없어요.
                <span className="mono">job {jobId}</span>
                <button type="button" className="btn btn--sm btn--weak" onClick={() => watchJob(paneId, null)}>연결 해제</button>
              </div>
            ) : (
              <div className="alert alert--warn" role="status">
                <b>연결을 확인할 수 없어요</b>
                상태를 조회하지 못했어요. 작업 자체가 실패했다는 뜻은 아니에요.
                <span className="mono">{describeError(statusQ.error)}{statusQ.dataUpdatedAt ? ` · 마지막 확인 ${fmtClock(statusQ.dataUpdatedAt)}` : ''}</span>
                <button type="button" className="btn btn--sm btn--weak" onClick={() => void statusQ.refetch()}><RefreshCw className="icon" aria-hidden="true" />다시 조회</button>
              </div>
            ))}

            {ownership?.kind === 'mismatch' && (
              <div className="alert" role="alert"><b>이 씬의 작업이 아니에요</b>{ownership.reason}. 결과를 이 씬에 표시하지 않아요.</div>
            )}
            {ownership?.kind === 'unverified' && status && (
              <p className="result-note dim">작업 대상 확인 필요 · 서버 상태 응답과 이 브라우저의 실행 기록으로는 이 씬의 작업인지 아직 확인할 수 없어요.{completed ? '' : ' 완료 후 결과 프레임으로 확인해요.'}</p>
            )}

            {active && (
              <>
                <div className={status.status === 'PENDING' ? 'indet indet--pending' : 'indet'} />
                <p className="help">{status.status === 'PENDING' ? '작업 대기열에 있어요.' : 'VESPA가 씬 전체를 처리하고 있어요.'} 진행률은 제공되지 않아 단계나 퍼센트는 표시하지 않아요.</p>
              </>
            )}

            {status?.status === 'FAILED' && (
              <div className="alert" role="alert">
                <b>작업이 실패했어요</b>
                원인을 확인한 뒤 새 작업으로 다시 실행해 주세요. GT와 이전 결과는 그대로 남아 있어요.
                <span className="mono">{status.errorMessage || '오류 메시지 없음'}</span>
                <button type="button" className="btn btn--sm btn--weak" onClick={startNewRun} disabled={run.isPending}><RefreshCw className="icon" aria-hidden="true" />새 작업으로 다시 실행</button>
              </div>
            )}

            {completed && (
              resultsQ.isPending ? <p className="result-note">결과를 불러오고 있어요</p>
                : resultsQ.isError ? (
                  <div className="alert alert--warn" role="alert">
                    <b>결과를 불러오지 못했어요</b>
                    작업은 완료되었어요. 결과만 다시 읽어요(새 작업을 만들지 않아요).
                    <span className="mono">{describeError(resultsQ.error)}</span>
                    <button type="button" className="btn btn--sm btn--weak" onClick={() => void resultsQ.refetch()}><RefreshCw className="icon" aria-hidden="true" />결과 다시 불러오기</button>
                  </div>
                ) : resultsQ.data && (
                  <p className="result-note">
                    예측 박스 {resultsQ.data.boxCount.toLocaleString('ko-KR')}개 · 처리 프레임 {resultsQ.data.sampleTokens.size}개
                    {resultsQ.data.boxCount === 0 && ' · 검출된 박스가 없어요'}
                  </p>
                )
            )}

            {pane.resultJobId != null && pane.resultJobId !== jobId && (
              <p className="result-note dim">지금은 이전 작업 #{pane.resultJobId}의 결과를 보여 주고 있어요.</p>
            )}

            {status && (
              <dl className="kv">
                <dt>경과 시간</dt><dd>{status.startedAt || status.completedAt ? formatElapsed(elapsedMs(status, now)) : '시작 전'}</dd>
                <dt>클래스 모드</dt><dd>{status.classMode ?? receipt?.classMode ?? '확인 불가'}</dd>
                <dt>생성 시각</dt><dd>{fmtClock(status.createdAt)}</dd>
                {status.completedAt && <><dt>완료 시각</dt><dd>{fmtClock(status.completedAt)}</dd></>}
              </dl>
            )}
          </div>
        )}
        <JobHistory paneId={paneId} jobIds={sceneReceipts.map((r) => r.jobId)} current={jobId} />
        <JobLookup onOpen={(id) => watchJob(paneId, id)} />
      </section>
    </>
  );
}

function JobHistory({ paneId, jobIds, current }: { paneId: PaneId; jobIds: number[]; current: number | null }) {
  const watchJob = useWorkspace((s) => s.watchJob);
  const rest = jobIds.filter((id) => id !== current).slice(0, 5);
  if (!rest.length) return null;
  return (
    <ul className="job-history" aria-label="이 브라우저에서 실행한 이 씬의 다른 작업">
      {rest.map((id) => <HistoryRow key={id} jobId={id} onPick={() => watchJob(paneId, id)} />)}
    </ul>
  );
}

function HistoryRow({ jobId, onPick }: { jobId: number; onPick: () => void }) {
  // Cached status only; history rows do not poll.
  const q = useQuery({ ...jobStatusQuery(jobId), staleTime: 60_000 });
  const st = q.data?.status;
  const color = st === 'COMPLETED' ? 'var(--st-ok)' : st === 'FAILED' ? 'var(--st-err)' : st === 'RUNNING' ? 'var(--st-run)' : 'var(--st-pend)';
  return (
    <li>
      <button type="button" onClick={onPick}>
        <span className="dot" style={{ background: color }} />
        <span className="mono">#{jobId}</span>
        <span>{st ? STATUS_KO[st] : q.isError ? '확인할 수 없음' : '확인 중'}</span>
        <span className="dim" style={{ marginLeft: 'auto' }}>보기</span>
      </button>
    </li>
  );
}

function JobLookup({ onOpen }: { onOpen: (id: number) => void }) {
  const [value, setValue] = useState('');
  const id = Number(value);
  const valid = Number.isSafeInteger(id) && id > 0;
  return (
    <form className="job-lookup" onSubmit={(e) => { e.preventDefault(); if (valid) { onOpen(id); setValue(''); } }}>
      <label className="sr-only" htmlFor="job-lookup">작업 번호</label>
      <input id="job-lookup" inputMode="numeric" placeholder="작업 번호로 열기" value={value} onChange={(e) => setValue(e.currentTarget.value.trim())} />
      <button type="submit" className="btn btn--sm" disabled={!valid}>열기</button>
    </form>
  );
}
