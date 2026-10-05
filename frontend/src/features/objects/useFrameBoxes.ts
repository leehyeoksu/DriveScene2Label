import { useQuery } from '@tanstack/react-query';
import type { BoxView, JobResults, SampleRef } from '@/api/models';
import { jobResultsQuery } from '@/api/queries';

export type PredState =
  | { kind: 'none' }
  | { kind: 'loading'; jobId: number }
  | { kind: 'error'; jobId: number; error: unknown; refetch: () => void }
  /** The shown job has no entry for this sample (other scene or dataset): nothing is drawn. */
  | { kind: 'not-in-job'; jobId: number }
  | { kind: 'ready'; jobId: number; boxes: BoxView[] };

/** Predictions of the shown completed job for one sample, matched by datasetId + sampleToken. */
export function predictionsFor(results: JobResults, sample: SampleRef): BoxView[] | null {
  if (results.datasetId !== sample.datasetId || !results.sampleTokens.has(sample.token)) return null;
  return results.boxesBySample.get(sample.token) ?? [];
}

export function usePredictions(resultJobId: number | null, sample: SampleRef | null): PredState {
  const q = useQuery({ ...jobResultsQuery(resultJobId ?? -1), enabled: resultJobId != null });
  if (resultJobId == null) return { kind: 'none' };
  if (q.isPending) return { kind: 'loading', jobId: resultJobId };
  if (q.isError) return { kind: 'error', jobId: resultJobId, error: q.error, refetch: () => void q.refetch() };
  if (!sample) return { kind: 'loading', jobId: resultJobId };
  const boxes = predictionsFor(q.data, sample);
  return boxes ? { kind: 'ready', jobId: resultJobId, boxes } : { kind: 'not-in-job', jobId: resultJobId };
}

export function visibleBoxes(gt: BoxView[] | null, pred: PredState, layers: { gt: boolean; pred: boolean }): BoxView[] {
  const out: BoxView[] = [];
  if (layers.gt && gt) out.push(...gt);
  if (layers.pred && pred.kind === 'ready') out.push(...pred.boxes);
  return out;
}
