import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Box, RefreshCw } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import type { RecordingCreatedDto } from '@/api/dto';
import { describeError, isApiError, requestJson } from '@/api/http';
import type { Recording, Scene } from '@/api/models';
import { qk, recordingQuery, recordingsQuery } from '@/api/queries';
import { useWorkspace, type PaneId } from '@/stores/workspace';
import { RerunViewer } from './RerunViewer';

const RECORDING_STATUS_KO: Record<string, string> = { PENDING: '대기 중', RUNNING: '생성 중', READY: '준비됨', FAILED: '생성 실패' };

/** Pick the recording to show: the pane's explicit choice, else the newest one for the shown job (or GT-only). */
export function pickRecording(list: Recording[], jobId: number | null, explicit: number | null): Recording | undefined {
  if (explicit != null) {
    const found = list.find((r) => r.recordingId === explicit);
    if (found) return found;
  }
  const same = list.filter((r) => r.jobId === jobId).sort((a, b) => b.createdAt - a.createdAt || b.recordingId - a.recordingId);
  return same.find((r) => r.status !== 'FAILED') ?? same[0];
}

async function createRecording(sceneId: number, jobId: number | null): Promise<RecordingCreatedDto> {
  const res = await requestJson<RecordingCreatedDto>(`/api/scenes/${sceneId}/recordings`, { method: 'POST', body: jobId != null ? { jobId } : {} });
  return res.data;
}

interface Props {
  paneId: PaneId;
  scene: Scene;
  /** Draw only for the active pane in compare mode (single Rerun instance). */
  enabled: boolean;
}

/**
 * LiDAR/3D area. Recording readiness (PENDING/RUNNING/READY/FAILED) is separate from the label job status, and a
 * failed recording is retried by asking for a recording again — never by re-running VESPA.
 */
export function RecordingPanel({ paneId, scene, enabled }: Props) {
  const pane = useWorkspace((s) => s.panes[paneId]);
  const setRecording = useWorkspace((s) => s.setRecording);
  const qc = useQueryClient();
  const listQ = useQuery({ ...recordingsQuery(scene.id), enabled });
  const targetJob = pane.resultJobId;
  const picked = useMemo(() => (listQ.data ? pickRecording(listQ.data, targetJob, pane.recordingId) : undefined), [listQ.data, targetJob, pane.recordingId]);
  const detailQ = useQuery({
    ...recordingQuery(picked?.recordingId ?? -1),
    enabled: enabled && !!picked,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === 'PENDING' || s === 'RUNNING' || (!s && q.state.status !== 'error') ? 3000 : q.state.status === 'error' ? 5000 : false;
    },
  });
  const rec = detailQ.data;

  // If the shown job changes, drop an explicit choice that belonged to another job.
  useEffect(() => {
    if (pane.recordingId != null && rec && rec.recordingId === pane.recordingId && rec.jobId !== targetJob) setRecording(paneId, null);
  }, [rec, pane.recordingId, targetJob, paneId, setRecording]);

  const create = useMutation({
    mutationFn: () => createRecording(scene.id, targetJob),
    onSuccess: (r) => {
      setRecording(paneId, r.recordingId);
      void qc.invalidateQueries({ queryKey: qk.recordings(scene.id) });
      void qc.invalidateQueries({ queryKey: qk.recording(r.recordingId) });
    },
  });

  if (!enabled) {
    return (
      <div className="lidar-state">
        <Box className="icon" aria-hidden="true" />
        <b>3D 보기는 작업 대상 패널 하나에서만 열려요</b>
        <span>이 패널을 작업 대상으로 고르면 3D 뷰어가 이쪽으로 옮겨 와요.</span>
      </div>
    );
  }
  if (listQ.isPending) return <div className="lidar-state" role="status"><span className="spin" aria-hidden="true" />3D recording 정보를 확인하고 있어요</div>;
  if (listQ.isError) {
    const unsupported = isApiError(listQ.error) && (listQ.error.status === 404 || listQ.error.status === 405);
    return (
      <div className="lidar-state" role="alert">
        <b>{unsupported ? '이 서버는 3D recording을 제공하지 않아요' : '3D recording 정보를 불러오지 못했어요'}</b>
        <span className="mono">{describeError(listQ.error)}</span>
        <button type="button" className="btn btn--sm btn--weak" onClick={() => void listQ.refetch()}><RefreshCw className="icon" aria-hidden="true" />다시 확인</button>
      </div>
    );
  }

  const jobText = targetJob != null ? `작업 #${targetJob} 예측 포함` : 'GT·센서만';
  const createButton = (labelText: string) => (
    <button type="button" className="btn btn--primary" onClick={() => create.mutate()} disabled={create.isPending}>
      {create.isPending ? <span className="spin" aria-hidden="true" /> : <Box className="icon" aria-hidden="true" />}{labelText}
    </button>
  );

  if (!picked) {
    return (
      <div className="lidar-state">
        <Box className="icon" aria-hidden="true" />
        <b>아직 3D recording이 없어요</b>
        <span>실제 LiDAR 점군과 GT{targetJob != null ? `, 작업 #${targetJob}의 예측` : ''}을 담은 recording을 서버에서 만들어요.</span>
        {createButton(`3D recording 만들기 (${jobText})`)}
        {create.isError && <span className="mono">{describeError(create.error)}</span>}
      </div>
    );
  }
  const status = rec?.status ?? picked.status;
  if (status === 'READY' && rec?.contentUrl) {
    return (
      <>
        <RerunViewer key={rec.recordingId} paneId={paneId} recording={rec} displayedSampleToken={pane.displayedSampleToken} />
        <div className="lidar-badge" data-testid="recording-badge">
          <b>LiDAR · 3D</b>
          <span className="dim">recording #{rec.recordingId} · {rec.jobId != null ? `작업 #${rec.jobId}` : 'GT·센서'} · Rerun {rec.sdkVersion}</span>
        </div>
      </>
    );
  }
  if (status === 'FAILED') {
    return (
      <div className="lidar-state" role="alert">
        <b>3D recording을 만들지 못했어요</b>
        <span className="mono">{rec?.errorMessage ?? picked.errorMessage ?? '오류 메시지 없음'}</span>
        <span>recording만 다시 만들어요. 라벨 작업은 다시 실행하지 않아요.</span>
        {createButton('recording 다시 만들기')}
        {create.isError && <span className="mono">{describeError(create.error)}</span>}
      </div>
    );
  }
  return (
    <div className="lidar-state" role="status">
      <span className="spin" aria-hidden="true" />
      <b>3D recording {RECORDING_STATUS_KO[status] ?? status}</b>
      <span>recording #{picked.recordingId} · {jobText}. 준비되면 자동으로 열려요.</span>
      {detailQ.isError && <span className="mono">상태를 확인하지 못했어요 · {describeError(detailQ.error)}</span>}
    </div>
  );
}
