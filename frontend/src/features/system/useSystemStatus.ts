import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import {
  currentCapability, fetchSystemStatus, nextExpiry, systemStatusKey, systemStatusQuery, type Capability, type FeatureKey, type SystemStatus,
} from '@/api/system';

/**
 * Feature readiness for a dataset (FU-01).
 * - `capability(key)` is the decision value: UNKNOWN + canExecute=false while loading, when the LATEST status call
 *   failed (the query cache keeps older data on a failed refetch — that data is never used for decisions), and when an
 *   answer's validity (server TTL, measured from receipt on the browser clock, capped by response age) has passed.
 * - `lastKnown(key)` is the last successful answer, for "마지막 확인" display only.
 * - `refresh()` asks the server for a read-only re-check; if it and the following GET fail, the result stays UNKNOWN.
 * Existing results, READY recordings and job status reads do not depend on this.
 */
export function useSystemStatus(datasetId: number | null) {
  const qc = useQueryClient();
  const q = useQuery(systemStatusQuery(datasetId));
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const failed = q.status === 'error';
  const data = q.data as SystemStatus | undefined;

  // Clock of the last evaluation: a new answer, a failed call or an expiry timer moves it forward.
  const evaluatedAt = Math.max(now, q.dataUpdatedAt, q.errorUpdatedAt);
  // Next future capability deadline after that clock. Each expiry re-render moves the clock past the deadline it handled,
  // so the following one (e.g. media 15 s → VESPA 60 s → recording 90 s) is scheduled without a new answer. Deadlines
  // already passed at evaluation are excluded (no 0 ms timer / GET loop for an answer that arrived expired).
  const deadline = nextExpiry(data, evaluatedAt);
  useEffect(() => {
    if (deadline == null) return;
    const timer = window.setTimeout(() => {
      setNow(Date.now());
      // Every component using this hook has its own timer: join a status GET already in flight instead of cancelling
      // and re-sending it (one GET per deadline at most, even while a GET hangs). The re-render above does not wait for it.
      if (document.visibilityState === 'visible') void qc.refetchQueries({ queryKey: systemStatusKey(datasetId), exact: true }, { cancelRefetch: false });
    }, Math.max(0, deadline - Date.now()) + 50);
    return () => window.clearTimeout(timer);
  }, [deadline, datasetId, qc]);

  // Coming back to a hidden tab: re-evaluate and re-read (polling pauses while hidden).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      setNow(Date.now());
      void qc.refetchQueries({ queryKey: systemStatusKey(datasetId), exact: true });
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [datasetId, qc]);

  const refetch = q.refetch;
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const fresh = await fetchSystemStatus(datasetId, true);
      qc.setQueryData(systemStatusKey(datasetId), fresh);
    } catch {
      // The refresh failed: re-read with a plain GET. If that fails too the query is in error → UNKNOWN.
      await refetch();
    } finally {
      setRefreshing(false);
      setNow(Date.now());
    }
  }, [datasetId, qc, refetch]);

  const capability = (key: FeatureKey): Capability => currentCapability(data, failed, key, Math.max(evaluatedAt, Date.now()));
  const lastKnown = (key: FeatureKey): Capability | undefined => data?.capabilities[key];
  /** A status-call problem is fixed by a light re-read; a capability reason by the explicit (read-only) refresh. */
  const recheck = (c: Capability) => ((c.reasonCode ?? '').startsWith('STATUS_') ? refetch().then(() => setNow(Date.now())) : refresh());
  return {
    status: data, error: q.error, failed, isPending: q.isPending, capability, lastKnown, refresh, refetch, recheck, refreshing,
    lastChecked: q.dataUpdatedAt,
  };
}
