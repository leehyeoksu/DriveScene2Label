import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { systemStatusQuery } from '@/api/system';
import { readStored, writeStored } from '@/lib/storage';
import { useServer } from '@/stores/server';
import { toast } from '@/stores/toast';
import { useWorkspace } from '@/stores/workspace';

const LAST = 'ds2l.lastInstance';

/**
 * Tracks which backend instance this tab talks to. When it changes (another DB behind the same URL), cached server
 * data and pane job/recording selections are dropped so ids from the old instance are never shown as this one's.
 */
export function InstanceWatcher() {
  const qc = useQueryClient();
  const { data, refetch } = useQuery(systemStatusQuery(null));
  // A tab coming back to the foreground re-checks which server it is talking to (polling pauses while hidden).
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') void refetch(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refetch]);
  const setInstance = useServer((s) => s.setInstance);
  useEffect(() => {
    if (!data) return;
    const id = data.instanceId;
    setInstance(id, data.supported);
    if (!id) return;
    const last = readStored<string | null>(LAST, 1, (v): v is string => typeof v === 'string', null);
    if (last && last !== id) {
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'systemStatus' });
      useWorkspace.getState().resetServerContext();
      toast('다른 서버(DB)에 연결됐어요. 이전 서버의 작업 기록은 연결하지 않아요', 'info');
    }
    writeStored(LAST, 1, id);
    // v1 receipts (no instanceId) are deliberately NOT migrated: their database cannot be proven (FU-02).
  }, [data, qc, setInstance]);
  return null;
}
