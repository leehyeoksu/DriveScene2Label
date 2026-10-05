import type { JobResults, JobStatus, Scene } from '@/api/models';
import type { JobReceipt } from '@/lib/jobs/receipts';

export type Ownership =
  | { kind: 'verified'; by: 'server' | 'receipt' | 'results' }
  | { kind: 'mismatch'; reason: string }
  | { kind: 'unverified' };

/**
 * Does `jobId` belong to the open scene? Evidence order: server job context (BE-05) → local creation receipt →
 * completed results' sampleTokens. A shared link with an arbitrary jobId is never trusted just because the
 * dataset matches.
 */
export function verifyJob(
  scene: Pick<Scene, 'datasetId' | 'token'>,
  sceneSampleTokens: ReadonlySet<string>,
  status: JobStatus | undefined,
  receipt: JobReceipt | undefined,
  results: JobResults | undefined,
): Ownership {
  if (status && status.datasetId !== scene.datasetId) return { kind: 'mismatch', reason: '다른 데이터셋의 작업이에요' };
  if (status?.sceneToken) {
    return status.sceneToken === scene.token ? { kind: 'verified', by: 'server' } : { kind: 'mismatch', reason: '다른 씬을 대상으로 한 작업이에요' };
  }
  if (receipt) {
    return receipt.datasetId === scene.datasetId && receipt.sceneToken === scene.token
      ? { kind: 'verified', by: 'receipt' }
      : { kind: 'mismatch', reason: '이 브라우저의 실행 기록상 다른 씬의 작업이에요' };
  }
  if (results) {
    if (results.datasetId !== scene.datasetId) return { kind: 'mismatch', reason: '다른 데이터셋의 결과예요' };
    if (!results.sampleTokens.size || sceneSampleTokens.size === 0) return { kind: 'unverified' };
    for (const t of results.sampleTokens) if (!sceneSampleTokens.has(t)) return { kind: 'mismatch', reason: '결과 프레임이 이 씬과 맞지 않아요' };
    return { kind: 'verified', by: 'results' };
  }
  return { kind: 'unverified' };
}

export const STATUS_KO: Record<string, string> = { PENDING: '대기 중', RUNNING: '라벨 생성 중', COMPLETED: '생성 완료', FAILED: '생성 실패' };

/** Status polling cadence: 3 s while active, stop at a terminal state, 5 s while the status GET itself is failing. */
export function pollInterval(status: JobStatus | undefined, fetchFailed: boolean): number | false {
  if (status && (status.status === 'COMPLETED' || status.status === 'FAILED')) return false;
  return fetchFailed ? 5000 : 3000;
}
