import { useEffect } from 'react';
import { imageCache } from '@/lib/imageCache';
import { useWorkspace, type PaneId } from '@/stores/workspace';
import type { PaneFrames } from '@/features/frames/usePaneFrames';

/** Pause playback when the tab is hidden; on leaving the workspace also stop and release idle images. */
export function usePlaybackLifecycle(): void {
  const pauseAll = useWorkspace((s) => s.pauseAll);
  useEffect(() => {
    const onVis = () => { if (document.hidden) pauseAll(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      pauseAll();
      imageCache.trim(0);
    };
  }, [pauseAll]);
}

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return !!el.closest('input,select,textarea,[contenteditable="true"],[role="dialog"],[role="separator"],canvas');
}

/** Space: play/pause, ←/→: frame, Esc: clear selection — for the active pane, outside inputs and dialogs. */
export function useWorkspaceShortcuts(paneId: PaneId, frames: PaneFrames): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || isTyping(e.target)) return;
      const st = useWorkspace.getState();
      const pane = st.panes[paneId];
      const i = frames.requestedIndex;
      if (e.key === ' ' && !(e.target as HTMLElement)?.closest('button,a')) {
        if (frames.samples.length > 1) st.setPlaying(paneId, !pane.playing);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const s = frames.samples[i + (e.key === 'ArrowRight' ? 1 : -1)];
        if (!s) return;
        st.setPlaying(paneId, false);
        st.requestSample(paneId, s.token, 'user');
      } else if (e.key === 'Escape') {
        if (!pane.selectedBoxKey) return;
        st.selectBox(paneId, null);
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paneId, frames.requestedIndex, frames.samples]);
}
