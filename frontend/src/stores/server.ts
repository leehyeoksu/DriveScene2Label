import { create } from 'zustand';
import { UNSCOPED } from '@/lib/jobs/receipts';

/**
 * The backend this tab is talking to, identified by the DB's stable instanceId (GET /api/system/status).
 * `scope` is what receipts and request snapshots are keyed by; an older backend without the status API is UNSCOPED.
 */
interface ServerStore {
  instanceId: string | null;
  supported: boolean | null;
  scope: string;
  setInstance: (instanceId: string | null, supported: boolean) => void;
}

export const useServer = create<ServerStore>()((set) => ({
  instanceId: null,
  supported: null,
  scope: UNSCOPED,
  setInstance: (instanceId, supported) => set({ instanceId, supported, scope: instanceId ?? UNSCOPED }),
}));
