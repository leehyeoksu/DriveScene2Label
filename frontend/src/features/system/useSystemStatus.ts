import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { fetchSystemStatus, systemStatusKey, systemStatusQuery, unreachableCapability, type Capability, type FeatureKey, type SystemStatus } from '@/api/system';

const CHECKING: Capability = { state: 'UNKNOWN', canExecute: false, reasonCode: 'STATUS_CHECKING', message: '준비 상태를 확인하고 있어요.', checkedAt: null, expiresAt: null, executor: null };

/**
 * Feature readiness for a dataset. While loading or when the status call itself fails, every feature is UNKNOWN with
 * canExecute=false (never assumed ready). `refresh()` asks the server to re-check (read-only) and replaces the cache.
 */
export function useSystemStatus(datasetId: number | null) {
  const qc = useQueryClient();
  const q = useQuery(systemStatusQuery(datasetId));
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const fresh = await fetchSystemStatus(datasetId, true);
      qc.setQueryData(systemStatusKey(datasetId), fresh);
    } catch {
      await q.refetch();
    } finally {
      setRefreshing(false);
    }
  }, [datasetId, qc, q]);
  const capability = (key: FeatureKey): Capability => {
    if (q.data) return q.data.capabilities[key];
    if (q.isError) return unreachableCapability();
    return CHECKING;
  };
  return { status: q.data as SystemStatus | undefined, error: q.error, isPending: q.isPending, capability, refresh, refreshing, lastChecked: q.dataUpdatedAt };
}
