import { create } from 'zustand';
import type { ClassMode } from '@/api/dto';
import type { Speed } from '@/lib/time/timeline';

/**
 * Per-pane UI state. A/B are fully independent even when they show the same scene: server data is shared through
 * the TanStack Query cache, but frame, playback, layers, selection and job choice live here per pane.
 * The store never copies server arrays (samples, boxes); it keeps identifiers only.
 */
export type PaneId = 'single' | 'A' | 'B';
export type CompareSide = 'A' | 'B';
export type ChangeOrigin = 'user' | 'playback' | 'sync' | 'viewer' | 'url' | 'init';

export interface PaneState {
  datasetId: number | null;
  sceneId: number | null;
  /** The frame the user (or playback/sync) asked for. */
  requestedSampleToken: string | null;
  /** The frame whose images and boxes are on screen. Switches only when the requested frame is fully prepared. */
  displayedSampleToken: string | null;
  lastOrigin: ChangeOrigin;
  changeSeq: number;
  playing: boolean;
  speed: Speed;
  layers: { gt: boolean; pred: boolean };
  selectedBoxKey: string | null;
  focusCamera: string | null;
  classMode: ClassMode;
  /** Job whose status is watched in the inspector. */
  jobId: number | null;
  /** Completed job whose predictions are drawn. Kept while a newer run is pending or failed. */
  resultJobId: number | null;
  recordingId: number | null;
  /** Compare panes only: camera grid or 3D. */
  paneView: 'cams' | 'lidar';
  /**
   * UI context generation. Bumped whenever the pane shows another scene (A→B→A ends on a new number), so a late
   * answer to a request made in an older context is recorded but never attached to the current view.
   */
  generation: number;
}

export const initialPane = (): PaneState => ({
  datasetId: null,
  sceneId: null,
  requestedSampleToken: null,
  displayedSampleToken: null,
  lastOrigin: 'init',
  changeSeq: 0,
  playing: false,
  speed: 1,
  layers: { gt: true, pred: true },
  selectedBoxKey: null,
  focusCamera: null,
  classMode: 8,
  jobId: null,
  resultJobId: null,
  recordingId: null,
  paneView: 'cams',
  generation: 0,
});

let generationSeq = 0;
const nextGeneration = () => ++generationSeq;

interface OpenScene {
  datasetId: number;
  sceneId: number;
  sampleToken?: string | null;
  jobId?: number | null;
}

interface WorkspaceStore {
  panes: Record<PaneId, PaneState>;
  activePane: CompareSide;
  sync: boolean;
  openScene: (pane: PaneId, s: OpenScene) => void;
  closePane: (pane: PaneId) => void;
  resetServerContext: () => void;
  requestSample: (pane: PaneId, token: string, origin: ChangeOrigin) => void;
  markDisplayed: (pane: PaneId, token: string) => void;
  setPlaying: (pane: PaneId, playing: boolean) => void;
  setSpeed: (pane: PaneId, speed: Speed) => void;
  toggleLayer: (pane: PaneId, layer: 'gt' | 'pred') => void;
  selectBox: (pane: PaneId, key: string | null) => void;
  setFocusCamera: (pane: PaneId, channel: string | null) => void;
  setClassMode: (pane: PaneId, mode: ClassMode) => void;
  watchJob: (pane: PaneId, jobId: number | null) => void;
  showResult: (pane: PaneId, jobId: number | null) => void;
  setRecording: (pane: PaneId, recordingId: number | null) => void;
  setPaneView: (pane: PaneId, view: 'cams' | 'lidar') => void;
  setActivePane: (pane: CompareSide) => void;
  setSync: (on: boolean) => void;
  pauseAll: () => void;
}

const patch = (s: WorkspaceStore, pane: PaneId, p: Partial<PaneState>): Pick<WorkspaceStore, 'panes'> => ({
  panes: { ...s.panes, [pane]: { ...s.panes[pane], ...p } },
});

export const useWorkspace = create<WorkspaceStore>()((set) => ({
  panes: { single: initialPane(), A: initialPane(), B: initialPane() },
  activePane: 'A',
  sync: false,

  openScene: (pane, o) =>
    set((s) => {
      const cur = s.panes[pane];
      const same = cur.datasetId === o.datasetId && cur.sceneId === o.sceneId;
      // Pane key = paneId + datasetId + sceneId: a different scene starts from a clean UI state.
      const base: PaneState = same ? cur : { ...initialPane(), classMode: cur.classMode, layers: cur.layers, speed: cur.speed, paneView: cur.paneView, generation: nextGeneration() };
      const next: PaneState = { ...base, datasetId: o.datasetId, sceneId: o.sceneId };
      if (o.sampleToken !== undefined && o.sampleToken !== next.requestedSampleToken) {
        next.requestedSampleToken = o.sampleToken;
        next.lastOrigin = 'url';
        next.changeSeq = cur.changeSeq + 1;
        next.selectedBoxKey = null;
      }
      if (o.jobId !== undefined && o.jobId !== next.jobId) {
        next.jobId = o.jobId;
        if (o.jobId === null) next.resultJobId = null;
      }
      if (same && next === cur) return s;
      return patch(s, pane, next);
    }),

  closePane: (pane) => set((s) => patch(s, pane, { ...initialPane(), generation: nextGeneration() })),
  resetServerContext: () =>
    set((s) => {
      // A different backend instance: job/recording ids of the old one mean nothing here.
      const clear = (p: PaneState): PaneState => ({ ...p, jobId: null, resultJobId: null, recordingId: null, selectedBoxKey: null, generation: nextGeneration() });
      return { panes: { single: clear(s.panes.single), A: clear(s.panes.A), B: clear(s.panes.B) } };
    }),

  requestSample: (pane, token, origin) =>
    set((s) => {
      const cur = s.panes[pane];
      if (cur.requestedSampleToken === token) return s;
      // A box id is not a track id: selection never carries over to another frame.
      return patch(s, pane, { requestedSampleToken: token, lastOrigin: origin, changeSeq: cur.changeSeq + 1, selectedBoxKey: null });
    }),

  markDisplayed: (pane, token) =>
    set((s) => (s.panes[pane].displayedSampleToken === token ? s : patch(s, pane, { displayedSampleToken: token }))),

  setPlaying: (pane, playing) => set((s) => (s.panes[pane].playing === playing ? s : patch(s, pane, { playing }))),
  setSpeed: (pane, speed) => set((s) => patch(s, pane, { speed })),
  toggleLayer: (pane, layer) =>
    set((s) => {
      const layers = { ...s.panes[pane].layers, [layer]: !s.panes[pane].layers[layer] };
      return patch(s, pane, { layers });
    }),
  selectBox: (pane, key) => set((s) => patch(s, pane, { selectedBoxKey: key })),
  setFocusCamera: (pane, channel) => set((s) => patch(s, pane, { focusCamera: channel })),
  setClassMode: (pane, classMode) => set((s) => patch(s, pane, { classMode })),
  watchJob: (pane, jobId) => set((s) => patch(s, pane, { jobId })),
  showResult: (pane, resultJobId) => set((s) => (s.panes[pane].resultJobId === resultJobId ? s : patch(s, pane, { resultJobId }))),
  setRecording: (pane, recordingId) => set((s) => (s.panes[pane].recordingId === recordingId ? s : patch(s, pane, { recordingId }))),
  setPaneView: (pane, paneView) => set((s) => patch(s, pane, { paneView })),
  setActivePane: (activePane) => set({ activePane }),
  setSync: (sync) => set({ sync }),
  pauseAll: () =>
    set((s) => ({
      panes: {
        single: { ...s.panes.single, playing: false },
        A: { ...s.panes.A, playing: false },
        B: { ...s.panes.B, playing: false },
      },
    })),
}));

export function usePane(pane: PaneId): PaneState {
  return useWorkspace((s) => s.panes[pane]);
}

/** Test helper. */
export function resetWorkspace(): void {
  useWorkspace.setState({ panes: { single: initialPane(), A: initialPane(), B: initialPane() }, activePane: 'A', sync: false });
}
