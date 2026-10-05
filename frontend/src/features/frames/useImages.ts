import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { imageCache, type ImageEntry } from '@/lib/imageCache';

export interface ImageState {
  status: 'loading' | 'ready' | 'error';
  src: string | null;
  width: number;
  height: number;
  error: ImageEntry['error'];
}

const LOADING: ImageState = { status: 'loading', src: null, width: 0, height: 0, error: null };

function snapshot(urls: readonly string[]): string {
  return urls.map((u) => {
    const e = imageCache.get(u);
    return e ? `${e.status}:${e.objectUrl ?? ''}:${e.error ?? ''}` : 'none';
  }).join('|');
}

/**
 * Holds the given image URLs in the shared cache for as long as the component shows them,
 * and returns their load state. Released (not revoked) on change/unmount; the cache decides when to revoke.
 */
export function useImages(urls: readonly string[]): Map<string, ImageState> {
  const key = urls.join('\n');
  // Acquire synchronously during render so the entries exist for the snapshot; balanced in the effect cleanup.
  const list = useMemo(() => (key ? key.split('\n') : []), [key]);
  useEffect(() => {
    list.forEach((u) => imageCache.acquire(u));
    return () => list.forEach((u) => imageCache.release(u));
  }, [list]);

  const snap = useSyncExternalStore(
    (cb) => {
      list.forEach((u) => { if (!imageCache.get(u)) imageCache.prefetch(u); });
      const unsubs = list.map((u) => imageCache.subscribe(u, cb));
      return () => unsubs.forEach((f) => f());
    },
    () => snapshot(list),
  );

  return useMemo(() => {
    void snap;
    const out = new Map<string, ImageState>();
    for (const u of list) {
      const e = imageCache.get(u);
      out.set(u, e ? { status: e.status, src: e.objectUrl, width: e.width, height: e.height, error: e.error } : LOADING);
    }
    return out;
  }, [list, snap]);
}
