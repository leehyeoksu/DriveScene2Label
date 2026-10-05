import { useRef, useState } from 'react';
import { RATIO_MAX, RATIO_MIN } from '@/stores/layout';
import { cn } from '@/lib/utils';

interface Props {
  ratio: number;
  onChange: (ratio: number) => void;
  onReset: () => void;
  label: string;
}

/** Vertical split handle: pointer drag, ←/→ (5%), Home/End, double-click or Enter to reset. */
export function Divider({ ratio, onChange, onReset, label }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const fromPointer = (clientX: number) => {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const r = parent.getBoundingClientRect();
    if (r.width <= 12) return;
    onChange((clientX - r.left - 6) / (r.width - 12));
  };
  return (
    <div
      ref={ref}
      className={cn('divider', dragging && 'is-dragging')}
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={Math.round(RATIO_MIN * 100)}
      aria-valuemax={Math.round(RATIO_MAX * 100)}
      aria-valuenow={Math.round(ratio * 100)}
      title="드래그 또는 ←/→ 키로 비율 조절, 더블클릭하면 기본 배치"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
      }}
      onPointerMove={(e) => { if (dragging) fromPointer(e.clientX); }}
      onPointerUp={(e) => {
        setDragging(false);
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={() => setDragging(false)}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') onChange(ratio - 0.05);
        else if (e.key === 'ArrowRight') onChange(ratio + 0.05);
        else if (e.key === 'Home') onChange(RATIO_MIN);
        else if (e.key === 'End') onChange(RATIO_MAX);
        else if (e.key === 'Enter') onReset();
        else return;
        e.preventDefault();
      }}
    >
      <span className="divider-grip" />
    </div>
  );
}
