import type { ClassMode } from '@/api/dto';
import { isClassMode } from '@/lib/classes';
import { readStored, writeStored } from '@/lib/storage';

/**
 * Record of a job the browser asked a server to create, taken from the request snapshot (not from whatever scene is
 * on screen when the answer arrives). Scoped by the server's stable instanceId so job 2 of a test DB is never restored
 * as job 2 of another DB. It is local evidence only; job status always comes from the server.
 */
export interface JobReceipt {
  instanceId: string;
  jobId: number;
  datasetId: number;
  datasetChecksum: string | null;
  sceneId: number;
  sceneToken: string;
  sceneName: string;
  paneId: string;
  classMode: ClassMode;
  idempotencyKey: string;
  requestedAt: number;
}

/** Receipts written before instance scoping (v1). Never used directly; see migrateLegacyReceipts. */
export interface LegacyReceipt {
  jobId: number;
  datasetId: number;
  sceneId: number;
  sceneToken: string;
  sceneName: string;
  classMode: ClassMode;
  idempotencyKey: string;
  requestedAt: number;
}

/** Placeholder scope for a backend without the status API (no instanceId). */
export const UNSCOPED = 'unscoped';

const KEY = 'ds2l.jobReceipts.v2';
const VERSION = 2;
const LEGACY_KEY = 'ds2l.jobReceipts';
const LEGACY_DONE_KEY = 'ds2l.jobReceipts.legacyChecked';
const MAX = 120;

function isLegacy(r: unknown): r is LegacyReceipt {
  if (!r || typeof r !== 'object') return false;
  const o = r as Record<string, unknown>;
  return Number.isInteger(o.jobId) && Number.isInteger(o.datasetId) && Number.isInteger(o.sceneId)
    && typeof o.sceneToken === 'string' && typeof o.sceneName === 'string' && isClassMode(o.classMode)
    && typeof o.idempotencyKey === 'string' && typeof o.requestedAt === 'number';
}

function isReceipt(r: unknown): r is JobReceipt {
  if (!isLegacy(r)) return false;
  const o = r as unknown as Record<string, unknown>;
  return typeof o.instanceId === 'string' && typeof o.paneId === 'string' && (o.datasetChecksum === null || typeof o.datasetChecksum === 'string');
}

const isList = <T>(guard: (v: unknown) => v is T) => (v: unknown): v is T[] => Array.isArray(v) && v.every(guard);

type Listener = () => void;
const listeners = new Set<Listener>();
let cache: JobReceipt[] | null = null;

export function loadReceipts(): JobReceipt[] {
  if (!cache) cache = readStored(KEY, VERSION, isList(isReceipt), []);
  return cache;
}

export function saveReceipt(r: JobReceipt): void {
  const rest = loadReceipts().filter((x) => !(x.instanceId === r.instanceId && x.jobId === r.jobId));
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

/** Receipts of one scene on one server, newest first. Shared by every pane showing the scene. */
export function receiptsForScene(all: JobReceipt[], instanceId: string, datasetId: number, sceneToken: string): JobReceipt[] {
  return all.filter((r) => r.instanceId === instanceId && r.datasetId === datasetId && r.sceneToken === sceneToken).sort((a, b) => b.requestedAt - a.requestedAt);
}

export function findReceipt(all: JobReceipt[], instanceId: string, jobId: number): JobReceipt | undefined {
  return all.find((r) => r.instanceId === instanceId && r.jobId === jobId);
}

export function legacyReceipts(): LegacyReceipt[] {
  return readStored(LEGACY_KEY, 1, isList(isLegacy), []);
}

/**
 * Move v1 receipts under an instance only when the server confirms the job's context (same dataset and scene token).
 * Unconfirmed, mismatched or unreachable entries are not restored. Runs once per instance.
 */
export async function migrateLegacyReceipts(instanceId: string, lookup: (jobId: number) => Promise<{ datasetId: number; sceneToken: string | null } | null>): Promise<number> {
  const done = readStored<string[]>(LEGACY_DONE_KEY, 1, (v): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string'), []);
  if (done.includes(instanceId)) return 0;
  let moved = 0;
  for (const r of legacyReceipts().slice(0, 30)) {
    let server: { datasetId: number; sceneToken: string | null } | null = null;
    try {
      server = await lookup(r.jobId);
    } catch {
      return moved; // server not answering: try again next time, do not mark as done
    }
    if (server && server.sceneToken && server.datasetId === r.datasetId && server.sceneToken === r.sceneToken) {
      saveReceipt({ ...r, instanceId, datasetChecksum: null, paneId: 'legacy' });
      moved++;
    }
  }
  writeStored(LEGACY_DONE_KEY, 1, [...done, instanceId].slice(-20));
  return moved;
}

/** Test hook. */
export function _resetReceiptCache(): void {
  cache = null;
}
