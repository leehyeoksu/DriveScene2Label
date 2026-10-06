import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSystemStatus } from './useSystemStatus';
import type { FeatureKey } from '@/api/system';
import { currentCapability, nextStatusPollMs, toSystemStatus, RESPONSE_MAX_AGE_MS, STATUS_POLL_MIN_MS } from '@/api/system';

/**
 * FU-01: the readiness hook must never keep using a previous READY after the status call failed or the capability
 * expired. Uses the real QueryClient, which keeps the last successful data when a refetch fails.
 */
function statusBody(state: 'READY' | 'CONFIGURED', opts: { checkedAt?: string; ttlMs?: number } = {}) {
  const checkedAt = opts.checkedAt ?? new Date().toISOString();
  // ttlMs is relative to the response's own checkedAt (negative = already expired when the server answered)
  const expiresAt = new Date(Date.parse(checkedAt) + (opts.ttlMs ?? 600_000)).toISOString();
  const cap = { state, canExecute: state === 'READY', reasonCode: state === 'READY' ? null : 'EXECUTOR_NOT_CHECKED', message: null, checkedAt, expiresAt };
  return {
    schemaVersion: 1, instanceId: '11111111-1111-4111-8111-111111111111', checkedAt,
    dataset: { id: 3, version: 'v1.0-mini', origin: 'UNKNOWN', metadataChecksum: 'c'.repeat(64), mediaValidation: 'PARTIAL' },
    capabilities: { catalog: cap, media: cap, search: cap, vespa: { ...cap, executor: 'local' }, recording: cap },
  };
}

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(() => useSystemStatus(3), { wrapper });
  return { client, hook };
}

afterEach(() => vi.restoreAllMocks());

describe('useSystemStatus: no stale READY (FU-01)', () => {
  it.each([
    ['connection failure', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['HTTP 500', () => Promise.resolve(new Response('{"code":"HTTP_500","message":"boom"}', { status: 500 }))],
  ])('READY → %s: current capability is UNKNOWN/not executable, last READY kept only as history', async (_n, failure) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(ok(statusBody('READY')));
    const { hook, client } = setup();
    await waitFor(() => expect(hook.result.current.capability('vespa').canExecute).toBe(true));
    fetchMock.mockImplementation(failure as () => Promise<Response>);
    await act(async () => { await client.refetchQueries(); });
    await waitFor(() => expect(hook.result.current.error).toBeTruthy());
    const vespa = hook.result.current.capability('vespa');
    expect(vespa.state).toBe('UNKNOWN');
    expect(vespa.canExecute).toBe(false);
    expect(vespa.reasonCode).toBe('STATUS_UNREACHABLE');
    expect(hook.result.current.lastKnown('vespa')?.state).toBe('READY'); // shown as "마지막 확인", not used for decisions
    expect(fetchMock.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
  });

  it('a capability already expired when the server answered is not executable', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(ok(statusBody('READY', { ttlMs: -1_000 })));
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.status).toBeTruthy());
    const vespa = hook.result.current.capability('vespa');
    expect(vespa.canExecute).toBe(false);
    expect(vespa.reasonCode).toBe('STATUS_EXPIRED');
  });

  it('READY stops being executable once its TTL (from receipt) passes, and a fresh answer restores it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok(statusBody('READY', { ttlMs: 20_000 })));
      const { hook } = setup();
      await waitFor(() => expect(hook.result.current.capability('vespa').canExecute).toBe(true));
      fetchMock.mockImplementation(() => new Promise(() => {})); // the next re-read hangs: no new answer arrives
      await act(async () => { await vi.advanceTimersByTimeAsync(21_000); });
      expect(hook.result.current.capability('vespa').reasonCode).toBe('STATUS_EXPIRED');
      expect(hook.result.current.capability('vespa').canExecute).toBe(false);
      expect(hook.result.current.lastKnown('vespa')?.state).toBe('READY');
    } finally {
      vi.useRealTimers();
    }
  });

  it('manual refresh and the following GET both failing do not bring READY back; a later success recovers', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(ok(statusBody('READY')));
    const { hook, client } = setup();
    await waitFor(() => expect(hook.result.current.capability('vespa').canExecute).toBe(true));
    fetchMock.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
    await act(async () => { await hook.result.current.refresh(); });
    await waitFor(() => expect(hook.result.current.capability('vespa').canExecute).toBe(false));
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('refresh=true'))).toBe(true);
    fetchMock.mockImplementation(() => Promise.resolve(ok(statusBody('READY'))));
    await act(async () => { await client.refetchQueries(); });
    await waitFor(() => expect(hook.result.current.capability('vespa').canExecute).toBe(true));
    expect(fetchMock.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
  });
});

describe('currentCapability / polling bounds (pure)', () => {
  it('measures validity on the browser clock from receipt, capped by response age', () => {
    const serverAhead = new Date(Date.now() + 3_600_000).toISOString(); // server clock 1 h ahead must not matter
    const data = toSystemStatus(statusBody('READY', { checkedAt: serverAhead, ttlMs: 600_000 }) as never, 1_000_000);
    expect(currentCapability(data, false, 'vespa', 1_000_000 + 60_000).canExecute).toBe(true);
    expect(currentCapability(data, false, 'vespa', 1_000_000 + RESPONSE_MAX_AGE_MS + 1).reasonCode).toBe('STATUS_EXPIRED');
    expect(currentCapability(data, true, 'vespa', 1_000_000).reasonCode).toBe('STATUS_UNREACHABLE');
    expect(currentCapability(undefined, false, 'vespa', 0).reasonCode).toBe('STATUS_CHECKING');
  });
  it('re-reads before the earliest gating capability expires but never faster than the floor', () => {
    const data = toSystemStatus(statusBody('READY', { ttlMs: 15_000 }) as never, 0);
    expect(nextStatusPollMs(data, 0)).toBe(14_000);
    expect(nextStatusPollMs(toSystemStatus(statusBody('READY', { ttlMs: 3_000 }) as never, 0), 0)).toBe(STATUS_POLL_MIN_MS);
    expect(nextStatusPollMs(undefined, 0)).toBe(30_000);
  });
});

/**
 * Different deadlines per feature (15/60/90 s) while every later status GET hangs: each feature must flip to
 * not-executable at its own deadline in what is RENDERED (values captured during render and real button states),
 * not only when the capability function is re-evaluated by the test. No POST, bounded GETs, timers cleaned up.
 */
describe('useSystemStatus: per-feature expiry re-render (expiry follow-up)', () => {
  const T0 = Date.UTC(2026, 9, 6, 4, 0, 0);
  function staggered(checkedAt: string) {
    const base = Date.parse(checkedAt);
    const cap = (ttl: number) => ({ state: 'READY', canExecute: true, reasonCode: null, message: null, checkedAt, expiresAt: new Date(base + ttl).toISOString() });
    return {
      schemaVersion: 1, instanceId: '11111111-1111-4111-8111-111111111111', checkedAt,
      dataset: { id: 3, version: 'v1.0-mini', origin: 'UNKNOWN', metadataChecksum: 'c'.repeat(64), mediaValidation: 'PARTIAL' },
      capabilities: { catalog: cap(600_000), media: cap(15_000), search: cap(15_000), vespa: { ...cap(60_000), executor: 'local' }, recording: cap(90_000) },
    };
  }
  const KEYS: FeatureKey[] = ['media', 'search', 'vespa', 'recording'];
  let rendered: Record<string, boolean> = {};

  function Probe() {
    const s = useSystemStatus(3);
    const values = Object.fromEntries(KEYS.map((k) => [k, s.capability(k).canExecute]));
    rendered = values; // captured during render: what the UI shows right now
    return (
      <div>
        {KEYS.map((k) => <button key={k} type="button" disabled={!values[k]}>{k}</button>)}
        <span data-testid="reason-vespa">{s.capability('vespa').reasonCode ?? ''}</span>
      </div>
    );
  }

  it('blocks media/search at 15 s, VESPA at 60 s, recording at 90 s without any new answer; recovers on a fresh answer', async () => {
    vi.useFakeTimers({ now: T0, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    try {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => Promise.resolve(ok(staggered(new Date(T0).toISOString()))));
      fetchMock.mockImplementation(() => new Promise(() => {})); // every later GET hangs
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const view = render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>);
      const btn = (k: string) => screen.getByRole('button', { name: k }) as HTMLButtonElement;
      await act(async () => { await vi.advanceTimersByTimeAsync(10); });
      expect(rendered).toEqual({ media: true, search: true, vespa: true, recording: true });

      await act(async () => { await vi.advanceTimersByTimeAsync(16_000 - 10); }); // t=16 s
      expect(rendered).toEqual({ media: false, search: false, vespa: true, recording: true });
      expect([btn('media').disabled, btn('vespa').disabled]).toEqual([true, false]);

      await act(async () => { await vi.advanceTimersByTimeAsync(46_000); }); // t=62 s
      expect(rendered.vespa).toBe(false);
      expect(btn('vespa').disabled).toBe(true);
      expect(screen.getByTestId('reason-vespa').textContent).toBe('STATUS_EXPIRED');
      expect([rendered.recording, btn('recording').disabled]).toEqual([true, false]);

      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); }); // t=92 s
      expect([rendered.recording, btn('recording').disabled]).toEqual([false, true]);

      // nothing left to expire: no 0 ms timer / GET loop
      const callsAt92 = fetchMock.mock.calls.length;
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
      expect(fetchMock.mock.calls.length - callsAt92).toBeLessThanOrEqual(2); // only the 30 s poll ceiling
      expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(10);
      expect(fetchMock.mock.calls.every(([u, init]) => String(u).includes('/api/system/status') && (!init?.method || init.method === 'GET'))).toBe(true);

      // a fresh answer restores every feature in the rendered UI
      fetchMock.mockImplementation(() => Promise.resolve(ok(staggered(new Date(Date.now()).toISOString()))));
      await act(async () => { await client.refetchQueries(); await vi.advanceTimersByTimeAsync(10); });
      expect(rendered).toEqual({ media: true, search: true, vespa: true, recording: true });
      expect(btn('vespa').disabled).toBe(false);

      view.unmount();
      client.clear();
      expect(vi.getTimerCount()).toBe(0); // expiry timers released on unmount
    } finally {
      vi.useRealTimers();
    }
  });
});
