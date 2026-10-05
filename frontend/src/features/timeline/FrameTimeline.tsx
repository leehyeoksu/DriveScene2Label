import { Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import type { SampleRef } from '@/api/models';
import { formatOffset, SPEEDS, type Speed } from '@/lib/time/timeline';
import { useWorkspace, type PaneId } from '@/stores/workspace';

interface Props {
  paneId: PaneId;
  samples: SampleRef[];
  requestedIndex: number;
  displayedIndex: number;
  buffering: boolean;
  /** Prefix for accessible names in compare mode, e.g. "씬 A ". */
  prefix?: string;
}

/**
 * Keyframe timeline. Shows the requested position on the slider and the displayed frame number; while the requested
 * frame is still loading a buffering badge is shown and the previous frame stays visible.
 */
export function FrameTimeline({ paneId, samples, requestedIndex, displayedIndex, buffering, prefix = '' }: Props) {
  const playing = useWorkspace((s) => s.panes[paneId].playing);
  const speed = useWorkspace((s) => s.panes[paneId].speed);
  const requestSample = useWorkspace((s) => s.requestSample);
  const setPlaying = useWorkspace((s) => s.setPlaying);
  const setSpeed = useWorkspace((s) => s.setSpeed);

  const n = samples.length;
  const disabled = n === 0;
  const idx = Math.max(0, requestedIndex);
  const go = (i: number) => {
    const s = samples[Math.min(n - 1, Math.max(0, i))];
    if (s) requestSample(paneId, s.token, 'user');
  };
  const togglePlay = () => {
    if (playing) return setPlaying(paneId, false);
    if (idx >= n - 1) go(0); // replay from the start when at the end
    setPlaying(paneId, true);
  };
  const pct = n > 1 ? (idx / (n - 1)) * 100 : 0;
  const shown = displayedIndex >= 0 ? displayedIndex : idx;

  return (
    <div className="timeline" data-pane={paneId}>
      <div className="tl-btns">
        <button type="button" className="btn btn--icon btn--ghost" onClick={() => { setPlaying(paneId, false); go(idx - 1); }} disabled={disabled || idx <= 0} aria-label={`${prefix}이전 프레임`} title="이전 프레임 (←)">
          <SkipBack className="icon" aria-hidden="true" />
        </button>
        <button type="button" className="btn btn--icon tl-play" onClick={togglePlay} disabled={disabled || n < 2} aria-label={`${prefix}${playing ? '일시정지' : '재생'}`} aria-pressed={playing} title="재생 / 일시정지 (Space)">
          {playing ? <Pause className="icon" fill="currentColor" aria-hidden="true" /> : <Play className="icon" fill="currentColor" aria-hidden="true" />}
        </button>
        <button type="button" className="btn btn--icon btn--ghost" onClick={() => { setPlaying(paneId, false); go(idx + 1); }} disabled={disabled || idx >= n - 1} aria-label={`${prefix}다음 프레임`} title="다음 프레임 (→)">
          <SkipForward className="icon" aria-hidden="true" />
        </button>
      </div>
      <div className="tl-track">
        <input
          type="range"
          className="tl-range"
          min={0}
          max={Math.max(0, n - 1)}
          step={1}
          value={idx}
          disabled={disabled}
          style={{ ['--pct' as string]: `${pct}%` }}
          onChange={(e) => { setPlaying(paneId, false); go(Number(e.currentTarget.value)); }}
          aria-label={`${prefix}프레임`}
          aria-valuetext={n ? `${idx + 1} / ${n} 프레임` : '프레임 없음'}
        />
      </div>
      <div className="tl-read">
        <span className="tl-frame" data-testid={`frame-readout-${paneId}`}>
          <b className="tl-cur">{n ? shown + 1 : 0}</b> <span className="tl-tot">/ {n}</span>
        </span>
        <span className="tl-ts" title="장면 시작부터의 sample timestamp 차이">
          {buffering ? <span className="buffering"><span className="spin" aria-hidden="true" />불러오는 중</span> : formatOffset(samples, shown)}
        </span>
      </div>
      <label className="tl-speed" title="실제 키프레임 timestamp 간격 기준">
        <span className="lbl">속도</span>
        <select className="select select--sm" value={speed} onChange={(e) => setSpeed(paneId, Number(e.currentTarget.value) as Speed)} aria-label={`${prefix}재생 속도`}>
          {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
        </select>
      </label>
    </div>
  );
}
