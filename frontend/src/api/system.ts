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
}

export interface SystemStatus {
  /** false when the server has no /api/system/status (older backend): every feature is UNKNOWN. */
  supported: boolean;
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

function toCapability(c: CapabilityDto | undefined): Capability {
  if (!c) return { state: 'UNKNOWN', canExecute: false, reasonCode: 'STATUS_FIELD_MISSING', message: null, checkedAt: null, expiresAt: null, executor: null };
  return {
    state: c.state, canExecute: c.canExecute === true, reasonCode: c.reasonCode, message: c.message,
    checkedAt: t(c.checkedAt), expiresAt: t(c.expiresAt), executor: c.executor ?? null,
  };
}

export function toSystemStatus(d: SystemStatusDto): SystemStatus {
  const capabilities = Object.fromEntries(FEATURES.map((k) => [k, toCapability(d.capabilities?.[k])])) as Record<FeatureKey, Capability>;
  return { supported: true, instanceId: d.instanceId ?? null, checkedAt: t(d.checkedAt) ?? Date.now(), dataset: d.dataset ?? null, capabilities };
}

/** Older backend without the status API. Nothing is assumed ready; the catalog itself is still usable. */
export function unsupportedStatus(): SystemStatus {
  const unknown: Capability = { state: 'UNKNOWN', canExecute: false, reasonCode: 'STATUS_API_UNSUPPORTED', message: null, checkedAt: null, expiresAt: null, executor: null };
  return {
    supported: false, instanceId: null, checkedAt: Date.now(), dataset: null,
    capabilities: { catalog: { ...unknown, state: 'READY', canExecute: true, reasonCode: null }, media: unknown, search: unknown, vespa: unknown, recording: unknown },
  };
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
    refetchInterval: 30_000,
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
  STATUS_UNREACHABLE: '서버에서 준비 상태를 가져오지 못했어요.',
};
export function capabilityMessage(c: Capability): string | null {
  return c.message ?? (c.reasonCode ? REASON_KO[c.reasonCode] ?? `사용할 수 없어요 (${c.reasonCode})` : null);
}

/** Status for a feature when the status query itself failed (server unreachable): never assume ready. */
export function unreachableCapability(): Capability {
  return { state: 'UNKNOWN', canExecute: false, reasonCode: 'STATUS_UNREACHABLE', message: null, checkedAt: null, expiresAt: null, executor: null };
}
