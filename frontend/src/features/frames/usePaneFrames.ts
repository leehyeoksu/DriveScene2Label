import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { CAMERA_CHANNELS } from '@/api/mappers';
import type { SampleRef } from '@/api/models';
import { annotationsQuery, calibrationQuery, poseQuery, sampleDetailQuery, sceneSamplesQuery } from '@/api/queries';
import { imageCache } from '@/lib/imageCache';
import { indexOfToken, playbackDelayMs } from '@/lib/time/timeline';
import { useWorkspace, type PaneId } from '@/stores/workspace';
import { useFrameBundle, type FrameBundle } from './useFrameBundle';

export interface PaneFrames {
  samples: SampleRef[];
  samplesError: unknown;
  samplesLoading: boolean;
  requestedIndex: number;
  displayedIndex: number;
  displayed: FrameBundle;
  /** Waiting for the requested frame while the previous one stays on screen. */
  buffering: boolean;
}

const PREFETCH_AHEAD = 2;
const PREFETCH_BEHIND = 1;

/**
 * Frame state machine for one pane:
 * requested sample → prepare (detail, GT, per-camera calibration/pose, decoded images) → displayed sample.
 * Images and boxes of a frame switch together; a slow response for an older request is never shown because the
 * displayed bundle is always derived from `displayedSampleToken`.
 */
export function usePaneFrames(paneId: PaneId): PaneFrames {
  const pane = useWorkspace((s) => s.panes[paneId]);
  const requestSample = useWorkspace((s) => s.requestSample);
  const markDisplayed = useWorkspace((s) => s.markDisplayed);
  const setPlaying = useWorkspace((s) => s.setPlaying);
  const qc = useQueryClient();

  const samplesQ = useQuery({ ...sceneSamplesQuery(pane.sceneId ?? -1), enabled: pane.sceneId != null });
  const samples = useMemo(() => samplesQ.data ?? [], [samplesQ.data]);

  // Unknown or missing sample → first frame of the scene (FR: invalid `sample` falls back to the first frame).
  useEffect(() => {
    if (!samples.length) return;
    if (indexOfToken(samples, pane.requestedSampleToken) < 0) requestSample(paneId, samples[0]!.token, 'init');
  }, [samples, pane.requestedSampleToken, paneId, requestSample]);

  const requestedIndex = indexOfToken(samples, pane.requestedSampleToken);
  const displayedIndex = indexOfToken(samples, pane.displayedSampleToken);
  const requested = useFrameBundle(samples[requestedIndex] ?? null);
  const displayed = useFrameBundle(samples[displayedIndex] ?? null);

  useEffect(() => {
    if (requested.ready && requested.sample && requested.sample.token === pane.requestedSampleToken) {
      markDisplayed(paneId, requested.sample.token);
    }
  }, [requested.ready, requested.sample, pane.requestedSampleToken, paneId, markDisplayed]);

  // Playback: advance only after the current frame is on screen; stop at the end.
  useEffect(() => {
    if (!pane.playing || !samples.length) return;
    if (pane.displayedSampleToken !== pane.requestedSampleToken) return; // buffering: wait
    const i = displayedIndex;
    if (i < 0) return;
    if (i >= samples.length - 1) {
      setPlaying(paneId, false);
      return;
    }
    const t = window.setTimeout(() => requestSample(paneId, samples[i + 1]!.token, 'playback'), playbackDelayMs(samples, i, pane.speed));
    return () => window.clearTimeout(t);
  }, [pane.playing, pane.speed, pane.displayedSampleToken, pane.requestedSampleToken, displayedIndex, samples, paneId, requestSample, setPlaying]);

  // Prefetch a couple of neighbours: metadata through the query cache, JPGs into the idle image LRU.
  useEffect(() => {
    if (requestedIndex < 0) return;
    const ahead = pane.playing ? PREFETCH_AHEAD : 1;
    const targets: SampleRef[] = [];
    for (let d = 1; d <= ahead; d++) if (samples[requestedIndex + d]) targets.push(samples[requestedIndex + d]!);
    for (let d = 1; d <= PREFETCH_BEHIND; d++) if (samples[requestedIndex - d]) targets.push(samples[requestedIndex - d]!);
    let cancelled = false;
    const timer = window.setTimeout(() => {
      for (const s of targets) {
        void qc.prefetchQuery(annotationsQuery(s.id));
        void qc.fetchQuery(sampleDetailQuery(s.id)).then((frame) => {
          if (cancelled) return;
          for (const ch of CAMERA_CHANNELS) {
            const f = frame.cameras.get(ch);
            if (!f) continue;
            void imageCache.prefetch(f.contentUrl);
            void qc.prefetchQuery(calibrationQuery(s.datasetId, f));
            void qc.prefetchQuery(poseQuery(f));
          }
        }).catch(() => {});
      }
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [requestedIndex, samples, pane.playing, qc]);

  return {
    samples,
    samplesError: samplesQ.error,
    samplesLoading: samplesQ.isPending && pane.sceneId != null,
    requestedIndex,
    displayedIndex,
    displayed,
    buffering: !!pane.requestedSampleToken && pane.requestedSampleToken !== pane.displayedSampleToken,
  };
}
