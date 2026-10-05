/**
 * Camera JPG cache: fetch (cancellable) → blob URL → decode, with reference counting.
 *
 * - Images in use are held by `acquire`; released ones stay in a small LRU for back/forward and prefetch,
 *   then their blob URLs are revoked and in-flight downloads aborted.
 * - Errors keep their kind so the UI can tell "file missing" (404) from "download failed" and "decode failed".
 * - The cache is keyed by URL only; which frame an image belongs to is decided by the caller.
 */
export type ImageErrorKind = 'missing' | 'download' | 'decode';

export interface ImageEntry {
  readonly url: string;
  status: 'loading' | 'ready' | 'error';
  objectUrl: string | null;
  width: number;
  height: number;
  error: ImageErrorKind | null;
}

interface Internal extends ImageEntry {
  refs: number;
  controller: AbortController | null;
  listeners: Set<() => void>;
  promise: Promise<void>;
}

export interface ImageCacheOptions {
  maxIdle?: number;
  fetchImpl?: typeof fetch;
  decode?: (objectUrl: string) => Promise<{ width: number; height: number }>;
  createObjectURL?: (b: Blob) => string;
  revokeObjectURL?: (u: string) => void;
}

async function defaultDecode(objectUrl: string): Promise<{ width: number; height: number }> {
  const img = new Image();
  img.src = objectUrl;
  await img.decode();
  return { width: img.naturalWidth, height: img.naturalHeight };
}

export class ImageCache {
  private entries = new Map<string, Internal>();
  /** Idle (refs = 0) URLs in least-recently-used order. */
  private idle: string[] = [];
  private readonly maxIdle: number;
  private readonly fetchImpl: typeof fetch;
  private readonly decodeImpl: (u: string) => Promise<{ width: number; height: number }>;
  private readonly createUrl: (b: Blob) => string;
  private readonly revokeUrl: (u: string) => void;

  constructor(opts: ImageCacheOptions = {}) {
    this.maxIdle = opts.maxIdle ?? 48;
    this.fetchImpl = opts.fetchImpl ?? ((...a) => fetch(...a));
    this.decodeImpl = opts.decode ?? defaultDecode;
    this.createUrl = opts.createObjectURL ?? ((b) => URL.createObjectURL(b));
    this.revokeUrl = opts.revokeObjectURL ?? ((u) => URL.revokeObjectURL(u));
  }

  get(url: string): ImageEntry | undefined {
    return this.entries.get(url);
  }

  /** Hold an image. Starts loading if needed. Pair every call with `release`. */
  acquire(url: string): ImageEntry {
    const e = this.ensure(url);
    e.refs++;
    this.idle = this.idle.filter((u) => u !== url);
    return e;
  }

  release(url: string): void {
    const e = this.entries.get(url);
    if (!e) return;
    e.refs = Math.max(0, e.refs - 1);
    if (e.refs === 0) this.park(url);
  }

  /** Load without holding (adjacent-frame prefetch). Lands in the idle LRU. */
  prefetch(url: string): Promise<void> {
    const existed = this.entries.has(url);
    const e = this.ensure(url);
    if (!existed && e.refs === 0) this.park(url);
    return e.promise;
  }

  subscribe(url: string, cb: () => void): () => void {
    const e = this.entries.get(url);
    if (!e) return () => {};
    e.listeners.add(cb);
    return () => e.listeners.delete(cb);
  }

  /** Drop every idle entry (e.g. when leaving the workspace). Held images stay. */
  trim(keep = 0): void {
    while (this.idle.length > keep) this.evict(this.idle.shift()!);
  }

  get size(): number {
    return this.entries.size;
  }

  private park(url: string): void {
    this.idle = [...this.idle.filter((u) => u !== url), url];
    while (this.idle.length > this.maxIdle) this.evict(this.idle.shift()!);
  }

  private evict(url: string): void {
    const e = this.entries.get(url);
    if (!e || e.refs > 0) return;
    e.controller?.abort();
    if (e.objectUrl) this.revokeUrl(e.objectUrl);
    e.listeners.clear();
    this.entries.delete(url);
  }

  private ensure(url: string): Internal {
    const found = this.entries.get(url);
    // A failed image nobody is showing is retried on the next request instead of staying broken forever.
    if (found && !(found.status === 'error' && found.refs === 0)) return found;
    if (found) {
      this.idle = this.idle.filter((u) => u !== url);
      this.entries.delete(url);
    }
    const controller = new AbortController();
    const e: Internal = {
      url, status: 'loading', objectUrl: null, width: 0, height: 0, error: null,
      refs: 0, controller, listeners: new Set(), promise: Promise.resolve(),
    };
    this.entries.set(url, e);
    e.promise = this.load(e, controller.signal);
    return e;
  }

  private async load(e: Internal, signal: AbortSignal): Promise<void> {
    let objectUrl: string | null = null;
    try {
      const res = await this.fetchImpl(e.url, { signal });
      if (!res.ok) throw Object.assign(new Error('http'), { kind: res.status === 404 ? 'missing' : 'download' });
      const blob = await res.blob();
      if (signal.aborted) return;
      objectUrl = this.createUrl(blob);
      let size: { width: number; height: number };
      try {
        size = await this.decodeImpl(objectUrl);
      } catch {
        throw Object.assign(new Error('decode'), { kind: 'decode' });
      }
      if (signal.aborted || this.entries.get(e.url) !== e) {
        this.revokeUrl(objectUrl);
        return;
      }
      Object.assign(e, { status: 'ready', objectUrl, width: size.width, height: size.height, controller: null });
    } catch (err) {
      if (objectUrl) this.revokeUrl(objectUrl);
      if (signal.aborted) return;
      const kind = (err as { kind?: ImageErrorKind }).kind ?? 'download';
      Object.assign(e, { status: 'error', error: kind, controller: null });
    }
    e.listeners.forEach((l) => l());
  }
}

export const imageCache = new ImageCache();
