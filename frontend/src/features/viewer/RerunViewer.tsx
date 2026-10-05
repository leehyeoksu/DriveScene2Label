import { useEffect, useRef, useState } from 'react';
import type { Recording } from '@/api/models';
import { useWorkspace, type PaneId } from '@/stores/workspace';
import { boxKeyForSelection, indexForSample, normalizeEntity } from './recordingMap';

type WebViewerType = import('@rerun-io/web-viewer').WebViewer;

interface Props {
  paneId: PaneId;
  recording: Recording;
  /** Displayed sample of the pane (React is the timeline's source of truth). */
  displayedSampleToken: string | null;
}

type Phase = 'loading' | 'ready' | 'error';

/**
 * Rerun Web Viewer 0.38.1 bound to one pane.
 * - React → Viewer: when the displayed frame changes, set the "sample" timeline to that index.
 * - Viewer → React: a time change on the "sample" timeline requests the matching sample (origin 'viewer').
 *   Echoes of our own set_current_time are ignored, so the two never ping-pong.
 * - Box selection maps (entity path, instance id, current sample) → REST box id via the recording metadata.
 * The viewer, its WASM memory and listeners are released on unmount or recording change.
 */
export function RerunViewer({ paneId, recording, displayedSampleToken }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<WebViewerType | null>(null);
  const rrIdRef = useRef<string | null>(null);
  const lastSentRef = useRef<number | null>(null);
  const currentIdxRef = useRef<number>(-1);
  const activeTimelineRef = useRef<string>(recording.timeline);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const requestSample = useWorkspace((s) => s.requestSample);
  const selectBox = useWorkspace((s) => s.selectBox);
  const contentUrl = recording.contentUrl;

  const recRef = useRef(recording);
  recRef.current = recording;

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !contentUrl) return;
    let disposed = false;
    const offs: Array<() => void> = [];
    setPhase('loading');
    setError(null);
    const controller = new AbortController();
    let channel: { close: () => void } | null = null;
    (async () => {
      try {
        // Rerun 0.38.1 only treats HTTP URLs ending in `.rrd` as recordings, so the Spring content endpoint is fetched
        // here (cancellable, HTTP errors visible) and the bytes are pushed through a log channel.
        const [{ WebViewer }, bytes] = await Promise.all([
          import('@rerun-io/web-viewer'),
          fetch(contentUrl, { signal: controller.signal }).then(async (res) => {
            if (!res.ok) throw new Error(`recording 파일을 받지 못했어요 (HTTP ${res.status})`);
            return new Uint8Array(await res.arrayBuffer());
          }),
        ]);
        if (disposed) return;
        const viewer = new WebViewer();
        viewerRef.current = viewer;
        await viewer.start(null, host, { hide_welcome_screen: true, width: '100%', height: '100%', theme: 'dark' });
        if (disposed) {
          viewer.stop();
          return;
        }
        // The React timeline/inspector own frame and object state; keep the viewer to its 3D view.
        viewer.override_panel_state('top', 'hidden');
        viewer.override_panel_state('blueprint', 'collapsed');
        viewer.override_panel_state('selection', 'collapsed');
        viewer.override_panel_state('time', 'collapsed');
        offs.push(viewer.on('recording_open', (e) => {
          rrIdRef.current = e.recording_id;
          viewer.set_active_timeline(e.recording_id, recRef.current.timeline);
          viewer.set_playing(e.recording_id, false);
          const idx = currentIdxRef.current;
          if (idx >= 0) {
            lastSentRef.current = idx;
            viewer.set_current_time(e.recording_id, recRef.current.timeline, idx);
          }
          setPhase('ready');
        }));
        offs.push(viewer.on('timeline_change', (e) => { activeTimelineRef.current = e.timeline; }));
        offs.push(viewer.on('time_update', (e) => {
          // Last time reported by the viewer itself; lets tests and diagnostics confirm React → viewer sync.
          host.dataset.viewerTime = String(e.time);
          if (activeTimelineRef.current !== recRef.current.timeline) return;
          const idx = Math.round(e.time);
          if (idx === lastSentRef.current || idx === currentIdxRef.current) return;
          const s = recRef.current.samples.find((x) => x.index === idx);
          if (s) {
            lastSentRef.current = idx;
            requestSample(paneId, s.sampleToken, 'viewer');
          }
        }));
        offs.push(viewer.on('selection_change', (e) => {
          const rec = recRef.current;
          const item = e.items.find((i) => i.type === 'entity' && i.instance_id != null);
          if (!item || item.type !== 'entity') return;
          const key = boxKeyForSelection(rec, normalizeEntity(item.entity_path), item.instance_id ?? -1, currentIdxRef.current);
          if (key) selectBox(paneId, key);
        }));
        const ch = viewer.open_channel(`ds2l-recording-${recRef.current.recordingId}`);
        channel = ch;
        ch.send_rrd(bytes);
      } catch (e) {
        if (!disposed && !controller.signal.aborted) {
          setPhase('error');
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => {
      disposed = true;
      controller.abort();
      offs.forEach((off) => off());
      try { channel?.close(); } catch { /* viewer already stopped */ }
      viewerRef.current?.stop();
      viewerRef.current = null;
      rrIdRef.current = null;
      lastSentRef.current = null;
    };
  }, [contentUrl, paneId, requestSample, selectBox]);

  // React timeline → viewer.
  useEffect(() => {
    const idx = indexForSample(recording, displayedSampleToken);
    currentIdxRef.current = idx;
    const viewer = viewerRef.current;
    const rr = rrIdRef.current;
    if (!viewer || !rr || idx < 0 || phase !== 'ready') return;
    lastSentRef.current = idx;
    viewer.set_current_time(rr, recording.timeline, idx);
  }, [displayedSampleToken, recording, phase]);

  return (
    <>
      {/* Rerun sets `position: relative` on the element it is given, so it gets a full-size child of an absolute frame. */}
      <div className="lidar-frame"><div ref={hostRef} className="lidar-host" data-testid="rerun-host" data-phase={phase} /></div>
      {phase === 'loading' && <div className="lidar-state" role="status"><span className="spin" aria-hidden="true" /><b>3D 뷰어를 불러오고 있어요</b><span>recording {(recording.sizeBytes ?? 0) > 0 ? `${((recording.sizeBytes ?? 0) / 1e6).toFixed(1)} MB` : ''}</span></div>}
      {phase === 'error' && <div className="lidar-state" role="alert"><b>3D 뷰어를 열지 못했어요</b><span className="mono">{error}</span><span>카메라와 작업 조회는 그대로 쓸 수 있어요.</span></div>}
    </>
  );
}
