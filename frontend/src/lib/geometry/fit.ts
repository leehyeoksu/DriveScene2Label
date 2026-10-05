/**
 * object-fit: contain placement of an image of size (iw, ih) inside a box (bw, bh).
 * The camera overlay uses an SVG with the image's own viewBox and `preserveAspectRatio="xMidYMid meet"`,
 * which applies exactly this mapping; this helper exists to verify it and to convert pointer positions.
 */
export interface ContainFit {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly width: number;
  readonly height: number;
}

export function containFit(iw: number, ih: number, bw: number, bh: number): ContainFit | null {
  if (!(iw > 0 && ih > 0 && bw > 0 && bh > 0)) return null;
  const scale = Math.min(bw / iw, bh / ih);
  const width = iw * scale;
  const height = ih * scale;
  return { scale, offsetX: (bw - width) / 2, offsetY: (bh - height) / 2, width, height };
}

export function imageToBox(fit: ContainFit, x: number, y: number): [number, number] {
  return [fit.offsetX + x * fit.scale, fit.offsetY + y * fit.scale];
}
