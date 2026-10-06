import { create } from 'zustand';
import { readStored, writeStored } from '@/lib/storage';

/** Display preferences that survive reloads. Applied after URL context; never contain server data. */
export interface LayoutPrefs {
  splitRatio: number;
  compareRatio: number;
  inspectorCollapsed: boolean;
}

const KEY = 'ds2l.layout';
const VERSION = 1;
export const DEFAULT_LAYOUT: LayoutPrefs = { splitRatio: 0.58, compareRatio: 0.5, inspectorCollapsed: false };
export const RATIO_MIN = 0.25;
export const RATIO_MAX = 0.75;

const clampRatio = (r: number) => Math.min(RATIO_MAX, Math.max(RATIO_MIN, r));

function isPrefs(v: unknown): v is LayoutPrefs {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.splitRatio === 'number' && typeof o.compareRatio === 'number' && typeof o.inspectorCollapsed === 'boolean';
}

interface LayoutStore extends LayoutPrefs {
  setSplitRatio: (r: number) => void;
  setCompareRatio: (r: number) => void;
  setInspectorCollapsed: (v: boolean) => void;
  resetSplit: () => void;
  resetCompare: () => void;
}

const loaded = readStored(KEY, VERSION, isPrefs, DEFAULT_LAYOUT);

export const useLayout = create<LayoutStore>()((set, get) => {
  const save = () => {
    const { splitRatio, compareRatio, inspectorCollapsed } = get();
    writeStored(KEY, VERSION, { splitRatio, compareRatio, inspectorCollapsed });
  };
  return {
    splitRatio: clampRatio(loaded.splitRatio),
    compareRatio: clampRatio(loaded.compareRatio),
    inspectorCollapsed: loaded.inspectorCollapsed,
    setSplitRatio: (r) => { set({ splitRatio: clampRatio(r) }); save(); },
    setCompareRatio: (r) => { set({ compareRatio: clampRatio(r) }); save(); },
    setInspectorCollapsed: (v) => { set({ inspectorCollapsed: v }); save(); },
    resetSplit: () => { set({ splitRatio: DEFAULT_LAYOUT.splitRatio }); save(); },
    resetCompare: () => { set({ compareRatio: DEFAULT_LAYOUT.compareRatio }); save(); },
  };
});
