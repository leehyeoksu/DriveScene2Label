import { memo, useMemo } from 'react';
import type { BoxView } from '@/api/models';
import { projectBox, type CompiledCamera, type ProjectedBox } from '@/lib/geometry/projection';
import { boxShortLabel } from '@/features/objects/boxLabels';

export interface ProjectedItem {
  box: BoxView;
  proj: ProjectedBox;
}

export function projectAll(camera: CompiledCamera | null, boxes: readonly BoxView[]): ProjectedItem[] {
  if (!camera) return [];
  const out: ProjectedItem[] = [];
  for (const box of boxes) {
    const proj = projectBox(camera, box);
    if (proj) out.push({ box, proj });
  }
  // Far boxes first so near ones are drawn (and clicked) on top.
  return out.sort((a, b) => b.proj.depth - a.proj.depth);
}

interface Props {
  items: ProjectedItem[];
  width: number;
  height: number;
  /** Screen pixels per image pixel, for constant-size labels and hit areas. */
  scale: number;
  selectedKey: string | null;
  onSelect?: (key: string) => void;
  showLabels?: boolean;
}

const COLOR = { GT: '#ffcc4d', VESPA: '#4fe0d5' } as const;
const INK = { GT: '#2a1e00', VESPA: '#002e2a' } as const;

function pathOf(p: ProjectedBox): string {
  return p.segments.map((s) => `M${s.x1.toFixed(1)} ${s.y1.toFixed(1)}L${s.x2.toFixed(1)} ${s.y2.toFixed(1)}`).join('');
}

/**
 * SVG in original image pixels (viewBox = width×height) with `xMidYMid meet`, the same mapping as the image's
 * `object-fit: contain`, so boxes stay aligned through split drags, zoom and window resizes.
 * GT = yellow dashed, prediction = mint solid; the legend and labels also name the source.
 */
export const CameraOverlay = memo(function CameraOverlay({ items, width, height, scale, selectedKey, onSelect, showLabels }: Props) {
  const s = scale > 0 ? 1 / scale : 1;
  const font = 11 * s;
  const ordered = useMemo(() => {
    const sel = items.filter((i) => i.box.key === selectedKey);
    return [...items.filter((i) => i.box.key !== selectedKey), ...sel];
  }, [items, selectedKey]);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {ordered.map(({ box, proj }) => {
        const selected = box.key === selectedKey;
        const d = pathOf(proj);
        const color = COLOR[box.source];
        return (
          <g key={box.key} data-box-key={box.key} data-source={box.source}>
            {onSelect && (
              <path
                className="box-hit"
                d={d}
                stroke="transparent"
                strokeWidth={14}
                vectorEffect="non-scaling-stroke"
                fill="none"
                pointerEvents="stroke"
                onClick={(e) => { e.stopPropagation(); onSelect(box.key); }}
              />
            )}
            {selected && <path d={d} stroke="rgba(0,0,0,.65)" strokeWidth={5} vectorEffect="non-scaling-stroke" fill="none" pointerEvents="none" />}
            <path
              d={d}
              stroke={color}
              strokeWidth={selected ? 3 : 1.6}
              strokeDasharray={box.source === 'GT' ? '6 4' : undefined}
              vectorEffect="non-scaling-stroke"
              fill="none"
              strokeLinecap="round"
              pointerEvents="none"
              opacity={selectedKey && !selected ? 0.55 : 1}
            />
            {(selected || showLabels) && (
              <Label x={proj.anchor[0]} y={proj.anchor[1]} text={boxShortLabel(box)} font={font} s={s} fill={color} ink={INK[box.source]} width={width} />
            )}
          </g>
        );
      })}
    </svg>
  );
});

function Label({ x, y, text, font, s, fill, ink, width }: { x: number; y: number; text: string; font: number; s: number; fill: string; ink: string; width: number }) {
  const w = Math.max(24 * s, text.length * font * 0.6 + 10 * s);
  const h = font + 8 * s;
  const lx = Math.min(Math.max(0, x - w / 2), width - w);
  const ly = Math.max(0, y - h - 4 * s);
  return (
    <g pointerEvents="none">
      <rect x={lx} y={ly} width={w} height={h} rx={4 * s} fill={fill} />
      <text x={lx + 5 * s} y={ly + h - 5 * s} fontSize={font} fontWeight={700} fill={ink} fontFamily="var(--font)">{text}</text>
    </g>
  );
}
