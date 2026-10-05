import type { ClassMode } from '@/api/dto';
import { isClassMode } from '@/lib/classes';
import { readStored, writeStored } from '@/lib/storage';

/**
 * What the browser asked for when it created a job. The current job status API cannot be relied on for
 * scene/classMode on older servers, so the receipt links a jobId to its target. It is local evidence only:
 * the job's status always comes from the server.
 */
export interface JobReceipt {
  jobId: number;
  datasetId: number;
  sceneId: number;
  sceneToken: string;
  sceneName: string;
  classMode: ClassMode;
  idempotencyKey: string;
  requestedAt: number;
}

const KEY = 'ds2l.jobReceipts';
const VERSION = 1;
const MAX = 60;

function isReceipt(r: unknown): r is JobReceipt {
  if (!r || typeof r !== 'object') return false;
  const o = r as Record<string, unknown>;
  return Number.isInteger(o.jobId) && Number.isInteger(o.datasetId) && Number.isInteger(o.sceneId)
    && typeof o.sceneToken === 'string' && typeof o.sceneName === 'string' && isClassMode(o.classMode)
    && typeof o.idempotencyKey === 'string' && typeof o.requestedAt === 'number';
}

function isReceiptList(v: unknown): v is JobReceipt[] {
  return Array.isArray(v) && v.every(isReceipt);
}

type Listener = () => void;
const listeners = new Set<Listener>();
let cache: JobReceipt[] | null = null;

export function loadReceipts(): JobReceipt[] {
  if (!cache) cache = readStored(KEY, VERSION, isReceiptList, []);
  return cache;
}

export function saveReceipt(r: JobReceipt): void {
  const rest = loadReceipts().filter((x) => !(x.jobId === r.jobId && x.datasetId === r.datasetId));
  cache = [r, ...rest].slice(0, MAX);
  writeStored(KEY, VERSION, cache);
  listeners.forEach((l) => l());
}

export function subscribeReceipts(l: Listener): () => void {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      cache = null;
      l();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener('storage', onStorage);
  };
}

/** Receipts of one scene, newest first. Shared by every pane that opens the scene. */
export function receiptsForScene(all: JobReceipt[], datasetId: number, sceneToken: string): JobReceipt[] {
  return all.filter((r) => r.datasetId === datasetId && r.sceneToken === sceneToken).sort((a, b) => b.requestedAt - a.requestedAt);
}

export function findReceipt(all: JobReceipt[], jobId: number): JobReceipt | undefined {
  return all.find((r) => r.jobId === jobId);
}

/** Test hook. */
export function _resetReceiptCache(): void {
  cache = null;
}
