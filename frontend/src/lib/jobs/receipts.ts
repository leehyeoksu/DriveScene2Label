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

/**
 * Receipts written before instance scoping (v1). Their original database is unknown, and a server answering with the
 * same datasetId/sceneToken for the same jobId does NOT prove it was the same request (a re-imported dataset gets the
 * same tokens and ids). They are kept untouched as unverified history and never attached to a server (FU-02).
 */
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
/** paneId given to v2 entries by the former automatic v1 migration; their origin is equally unproven. */
export const LEGACY_PANE = 'legacy';
const verified = (r: JobReceipt) => r.paneId !== LEGACY_PANE;

const KEY = 'ds2l.jobReceipts.v2';
const VERSION = 2;
const LEGACY_KEY = 'ds2l.jobReceipts';
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

/** Receipts of one scene on one server, newest first. Shared by every pane showing the scene. Unverified entries excluded. */
export function receiptsForScene(all: JobReceipt[], instanceId: string, datasetId: number, sceneToken: string): JobReceipt[] {
  return all.filter((r) => verified(r) && r.instanceId === instanceId && r.datasetId === datasetId && r.sceneToken === sceneToken).sort((a, b) => b.requestedAt - a.requestedAt);
}

export function findReceipt(all: JobReceipt[], instanceId: string, jobId: number): JobReceipt | undefined {
  return all.find((r) => verified(r) && r.instanceId === instanceId && r.jobId === jobId);
}

/**
 * Unverified history for a scene: v1 receipts plus v2 entries created by the former migration. Shown only as a count
 * ("이 서버 작업으로 연결하지 않음"); never restored, selected or used to verify job ownership.
 */
export function unverifiedReceiptsForScene(all: JobReceipt[], datasetId: number, sceneToken: string): Array<LegacyReceipt> {
  const fromV1 = legacyReceipts().filter((r) => r.datasetId === datasetId && r.sceneToken === sceneToken);
  const fromV2 = all.filter((r) => !verified(r) && r.datasetId === datasetId && r.sceneToken === sceneToken);
  const seen = new Set<string>();
  return [...fromV1, ...fromV2].filter((r) => {
    const k = `${r.jobId}:${r.idempotencyKey}:${r.requestedAt}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function legacyReceipts(): LegacyReceipt[] {
  return readStored(LEGACY_KEY, 1, isList(isLegacy), []);
}

/** Test hook. */
export function _resetReceiptCache(): void {
  cache = null;
}
