import { CAMERA_META } from './cameraMeta';

/** Small top-down car with the camera's viewing direction. Decorative; the channel name is always shown as text. */
export function CameraGlyph({ channel, className = 'glyph' }: { channel: string; className?: string }) {
  const meta = CAMERA_META[channel];
  if (!meta) return null;
  const deg = Math.PI / 180;
  const a = meta.glyphYaw * deg;
  const hw = (channel === 'CAM_BACK' ? 44 : 32) * deg;
  const r = 9.5;
  const pt = (t: number) => [10 - Math.sin(t) * r, 10 - Math.cos(t) * r] as const;
  const [x1, y1] = pt(a + hw);
  const [x2, y2] = pt(a - hw);
  return (
    <svg className={className} viewBox="0 0 20 20" aria-hidden="true">
      <path className="glyph-fov" d={`M10 10L${x1.toFixed(2)} ${y1.toFixed(2)}A${r} ${r} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}Z`} />
      <rect className="glyph-car" x="7.3" y="5" width="5.4" height="10" rx="1.7" />
    </svg>
  );
}
