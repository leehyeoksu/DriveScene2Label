import { useSyncExternalStore } from 'react';
import { loadReceipts, subscribeReceipts, type JobReceipt } from '@/lib/jobs/receipts';

export function useReceipts(): JobReceipt[] {
  return useSyncExternalStore(subscribeReceipts, loadReceipts, loadReceipts);
}
