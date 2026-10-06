import { queryOptions } from '@tanstack/react-query';
import type { CapabilityDto, CapabilityState, DataOrigin, SystemStatusDto } from './dto';
import { ApiError, getJson, isApiError, qs } from './http';

export type FeatureKey = 'catalog' | 'media' | 'search' | 'vespa' | 'recording';

export interface Capability {
  state: CapabilityState;
  canExecute: boolean;
  reasonCode: string | null;
  message: string | null;
  checkedAt: number | null;
  expiresAt: number | null;
  executor: string | null;
  /**
   * Client-clock time until which this answer may be used for decisions: receivedAt + (server expiresAt − server
   * checkedAt), capped by RESPONSE_MAX_AGE_MS. Server clocks are never compared with the browser clock directly.
   */
  validUntil: number | null;
}

/** An answer older than this is not used to allow new work even if its capability TTL is longer. */
export const RESPONSE_MAX_AGE_MS = 90_000;
/** Bounds for re-reading the status (light GET; never the heavy refresh). */
export const STATUS_POLL_MAX_MS = 30_000;
export const STATUS_POLL_MIN_MS = 10_000;

export interface SystemStatus {
  /** false when the server has no /api/system/status (older backend): every feature is UNKNOWN. */
  supported: boolean;
  /** Browser time when this answer was received. */
  receivedAt: number;
  instanceId: string | null;
  checkedAt: number;
  dataset: { id: number; version: string; origin: DataOrigin; metadataChecksum: string; mediaValidation: string } | null;
  capabilities: Record<FeatureKey, Capability>;
}

const FEATURES: FeatureKey[] = ['catalog', 'media', 'search', 'vespa', 'recording'];

const t = (s: string | null | undefined) => {
  const v = s ? Date.parse(s) : NaN;
  return Number.isFinite(v) ? v : null;
};

function toCapability(c: CapabilityDto | undefined, serverNow: number | null, receivedAt: number): Capability {
  if (!c) return { state: 'UNKNOWN', canExecute: false, reasonCode: 'STATUS_FIELD_MISSING', message: null, checkedAt: null, expiresAt: null, executor: null, validUntil: receivedAt };
  const expiresAt = t(c.expiresAt);
  const ttl = expiresAt != null && serverNow != null ? expiresAt - serverNow : RESPONSE_MAX_AGE_MS;
  return {
    state: c.state, canExecute: c.canExecute === true, reasonCode: c.reasonCode, message: c.message,
    checkedAt: t(c.checkedAt), expiresAt, executor: c.executor ?? null,
    validUntil: receivedAt + Math.min(ttl, RESPONSE_MAX_AGE_MS),
  };
}

export function toSystemStatus(d: SystemStatusDto, receivedAt = Date.now()): SystemStatus {
  const serverNow = t(d.checkedAt);
  const capabilities = Object.fromEntries(FEATURES.map((k) => [k, toCapability(d.capabilities?.[k], serverNow, receivedAt)])) as Record<FeatureKey, Capability>;
  return { supported: true, receivedAt, instanceId: d.instanceId ?? null, checkedAt: serverNow ?? receivedAt, dataset: d.dataset ?? null, capabilities };
}

/** Older backend without the status API. Nothing is assumed ready; the catalog itself is still usable. */
export function unsupportedStatus(receivedAt = Date.now()): SystemStatus {
  const unknown: Capability = { state: 'UNKNOWN', canExecute: false, reasonCode: 'STATUS_API_UNSUPPORTED', message: null, checkedAt: null, expiresAt: null, executor: null, validUntil: receivedAt + RESPONSE_MAX_AGE_MS };
  return {
    supported: false, receivedAt, instanceId: null, checkedAt: receivedAt, dataset: null,
    capabilities: { catalog: { ...unknown, state: 'READY', canExecute: true, reasonCode: null }, media: unknown, search: unknown, vespa: unknown, recording: unknown },
  };
}

const GATING: FeatureKey[] = ['media', 'search', 'vespa', 'recording'];

/**
 * The capability to use for decisions NOW. A failed latest status call (even with older data kept by the cache) or an
 * expired/too-old answer gives UNKNOWN with canExecute=false; the previous answer is only "last known" information.
 */
export function currentCapability(data: SystemStatus | undefined, lastFetchFailed: boolean, key: FeatureKey, now: number): Capability {
  if (lastFetchFailed) return unreachableCapability();
  if (!data) return checkingCapability();
  const c = data.capabilities[key];
  if (c.validUntil != null && c.validUntil <= now) {
    return { ...c, state: 'UNKNOWN', canExecute: false, reasonCode: 'STATUS_EXPIRED', message: null };
  }
  return c;
}

/** Next re-read delay: before the earliest gating capability expires, within [STATUS_POLL_MIN_MS, STATUS_POLL_MAX_MS]. */
export function nextStatusPollMs(data: SystemStatus | undefined, now: number): number {
  if (!data) return STATUS_POLL_MAX_MS;
  const upcoming = GATING.map((k) => data.capabilities[k].validUntil).filter((v): v is number => v != null && v > now);
  if (!upcoming.length) return STATUS_POLL_MAX_MS;
  return Math.min(STATUS_POLL_MAX_MS, Math.max(STATUS_POLL_MIN_MS, Math.min(...upcoming) - now - 1000));
}

/** Earliest future moment a gating capability stops being usable (to re-render exactly then), or null. */
export function nextExpiry(data: SystemStatus | undefined, now: number): number | null {
  if (!data) return null;
  const upcoming = GATING.map((k) => data.capabilities[k].validUntil).filter((v): v is number => v != null && v > now);
  return upcoming.length ? Math.min(...upcoming) : null;
}

export async function fetchSystemStatus(datasetId: number | null, refresh: boolean, signal?: AbortSignal): Promise<SystemStatus> {
  try {
    const d = await getJson<SystemStatusDto>(`/api/system/status${qs({ datasetId, refresh: refresh || undefined })}`, signal);
    if (!d || typeof d !== 'object' || d.schemaVersion !== 1) throw new ApiError('format', '/api/system/status', '지원하지 않는 상태 응답 형식이에요');
    return toSystemStatus(d);
  } catch (e) {
    // A business 404 ("Dataset not found") is a real answer; Spring's default 404 for an unknown route means an older
    // backend without the status API.
    if (isApiError(e) && e.kind === 'http' && e.status === 404 && e.message !== 'Dataset not found') return unsupportedStatus();
    throw e;
  }
}

export const systemStatusKey = (datasetId: number | null) => ['systemStatus', datasetId] as const;

/** Polled every 30 s while visible (hidden tabs pause); a refresh is a separate explicit action. */
export const systemStatusQuery = (datasetId: number | null) =>
  queryOptions({
    queryKey: systemStatusKey(datasetId),
    queryFn: ({ signal }) => fetchSystemStatus(datasetId, false, signal),
    // Re-read before the earliest capability expires (bounded); hidden tabs pause. Light GET only, never refresh=true.
    refetchInterval: (q) => nextStatusPollMs(q.state.data, Date.now()),
    refetchIntervalInBackground: false,
    staleTime: 10_000,
    retry: false,
  });

export const ORIGIN_LABEL: Record<DataOrigin, string> = {
  SYNTHETIC: '테스트 데이터',
  NUSCENES: 'nuScenes 원본',
  UNKNOWN: '데이터 출처 미확인',
};

const STATE_LABEL: Record<CapabilityState, string> = { READY: '준비됨', CONFIGURED: '확인 필요', UNAVAILABLE: '사용 불가', UNKNOWN: '확인 불가' };
export const stateLabel = (s: CapabilityState) => STATE_LABEL[s];

/** Korean guidance; the server message wins, this covers client-only reasons and missing messages. */
const REASON_KO: Record<string, string> = {
  STATUS_API_UNSUPPORTED: '이 서버는 기능 준비 상태 확인을 지원하지 않아요(이전 버전).',
  STATUS_FIELD_MISSING: '서버 응답에 이 기능의 상태가 없어요.',
  STATUS_UNREACHABLE: '서버에서 준비 상태를 가져오지 못했어요. 확인될 때까지 새 작업은 막아 둘게요.',
  STATUS_EXPIRED: '준비 상태 확인이 오래돼 다시 확인하고 있어요. 확인될 때까지 새 작업은 막아 둘게요.',
  STATUS_CHECKING: '준비 상태를 확인하고 있어요.',
};
export function capabilityMessage(c: Capability): string | null {
  return c.message ?? (c.reasonCode ? REASON_KO[c.reasonCode] ?? `사용할 수 없어요 (${c.reasonCode})` : null);
}

/** Status for a feature when the status query itself failed (server unreachable): never assume ready. */
export function unreachableCapability(): Capability {
  return { state: 'UNKNOWN', canExecute: false, reasonCode: 'STATUS_UNREACHABLE', message: null, checkedAt: null, expiresAt: null, executor: null, validUntil: null };
}

export function checkingCapability(): Capability {
  return { state: 'UNKNOWN', canExecute: false, reasonCode: 'STATUS_CHECKING', message: null, checkedAt: null, expiresAt: null, executor: null, validUntil: null };
}
