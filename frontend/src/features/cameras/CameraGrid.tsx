import type { BoxView } from '@/api/models';
import type { CameraSlot } from '@/features/frames/useFrameBundle';
import { useElementSize } from '@/hooks/useElementSize';
import { CameraTile } from './CameraTile';

const GAP = 8;
const PAD_X = 24;
const PAD_Y = 16;
const ASPECT = 16 / 9;

/** Pick 3×2 or 2×3 so that tiles are as large as possible in the available area. */
export function chooseLayout(width: number, height: number): { layout: '3x2' | '2x3'; tileWidth: number } {
  const W = Math.max(0, width - PAD_X);
  const H = Math.max(0, height - PAD_Y);
  const fit = (cols: number, rows: number) => Math.max(0, Math.min((W - GAP * (cols - 1)) / cols, ((H - GAP * (rows - 1)) / rows) * ASPECT));
  const a = fit(3, 2);
  const b = fit(2, 3);
  return a >= b ? { layout: '3x2', tileWidth: Math.floor(a) } : { layout: '2x3', tileWidth: Math.floor(b) };
}

interface Props {
  cameras: CameraSlot[];
  boxes: readonly BoxView[];
  selectedKey: string | null;
  focusCamera: string | null;
  onSelect: (key: string) => void;
  onExpand: (channel: string) => void;
  /** Force a layout (6-camera mode uses 3×2 on wide screens). */
  prefer?: '3x2' | '2x3';
  label: string;
}

export function CameraGrid({ cameras, boxes, selectedKey, focusCamera, onSelect, onExpand, prefer, label }: Props) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const auto = chooseLayout(size.width, size.height);
  const layout = prefer ?? auto.layout;
  const cols = layout === '3x2' ? 3 : 2;
  const tile = prefer ? chooseLayoutFor(prefer, size.width, size.height) : auto.tileWidth;
  return (
    <div
      ref={ref}
      className="camgrid"
      data-layout={layout}
      role="group"
      aria-label={label}
      style={tile > 40 ? { gridTemplateColumns: `repeat(${cols}, ${tile}px)` } : { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {cameras.map((slot) => (
        <CameraTile
          key={slot.channel}
          slot={slot}
          boxes={boxes}
          selectedKey={selectedKey}
          onSelect={onSelect}
          current={focusCamera === slot.channel}
          onExpand={() => onExpand(slot.channel)}
        />
      ))}
    </div>
  );
}

function chooseLayoutFor(layout: '3x2' | '2x3', width: number, height: number): number {
  const [cols, rows] = layout === '3x2' ? [3, 2] : [2, 3];
  const W = Math.max(0, width - PAD_X);
  const H = Math.max(0, height - PAD_Y);
  return Math.floor(Math.max(0, Math.min((W - GAP * (cols - 1)) / cols, ((H - GAP * (rows - 1)) / rows) * ASPECT)));
}
