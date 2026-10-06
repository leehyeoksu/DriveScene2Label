import type { CreateJobRequestDto, CreatedJobDto } from '@/api/dto';
import { ApiError, requestJson } from '@/api/http';

/**
 * One user intent to run VESPA = one Idempotency-Key. `newRunIntent()` is called only when the user starts a new run;
 * network-level retries (and a manual "같은 요청 다시 보내기") reuse the intent's key so the server returns the same job.
 */
export interface RunIntent {
  readonly key: string;
  readonly body: CreateJobRequestDto;
}

export function newIdempotencyKey(): string {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `ds2l-${id}`;
}

export function newRunIntent(body: CreateJobRequestDto): RunIntent {
  return { key: newIdempotencyKey(), body };
}

export interface CreateOptions {
  /** Automatic retries for lost responses / 502–504 with the same key. */
  retries?: number;
  delayMs?: (attempt: number) => number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * POST /api/auto-label/jobs. Retries only when the answer was lost or the service was temporarily unavailable;
 * 4xx answers (bad request, unknown scene, key conflict) are final. Every attempt sends the same key.
 */
export async function createJob(intent: RunIntent, opts: CreateOptions = {}): Promise<CreatedJobDto> {
  const retries = opts.retries ?? 2;
  const delay = opts.delayMs ?? ((n: number) => 800 * 2 ** n);
  const sleep = opts.sleep ?? defaultSleep;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await requestJson<CreatedJobDto>('/api/auto-label/jobs', {
        method: 'POST',
        body: intent.body,
        headers: { 'Idempotency-Key': intent.key },
      });
      if (!res.data || !Number.isInteger(res.data.jobId)) throw new ApiError('format', '/api/auto-label/jobs', '응답에 jobId가 없어요', res.status);
      return res.data;
    } catch (e) {
      const retryable = e instanceof ApiError && e.transient;
      if (!retryable || attempt >= retries) throw e;
      await sleep(delay(attempt));
    }
  }
}

export const TERMINAL = new Set(['COMPLETED', 'FAILED']);

/** Elapsed run time. Stops at the server's completedAt; never invents a finish time. */
export function elapsedMs(s: { createdAt: number; startedAt: number | null; completedAt: number | null }, now: number): number {
  const from = s.startedAt ?? s.createdAt;
  const to = s.completedAt ?? now;
  return Math.max(0, to - from);
}

export function formatElapsed(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}시간 ${m}분 ${s}초` : m ? `${m}분 ${s}초` : `${s}초`;
}
