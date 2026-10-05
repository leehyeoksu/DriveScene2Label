import { applyPose, compilePose, type Quat, type Vec3 } from './transform';

/**
 * 3D box in WORLD metres. `sizeWLH` keeps the API order (width, length, height).
 * Local axes follow nuScenes devkit `Box.corners()`: x = length, y = width, z = height.
 */
export interface Box3 {
  readonly center: Vec3;
  readonly sizeWLH: Vec3;
  readonly rotation: Quat;
}

/**
 * Eight corners in devkit order. Corners 0–3 form the front face (+x / +length side),
 * 4–7 the rear face; `i` and `i+4` are joined by the side edges.
 */
export function boxCorners(box: Box3): Vec3[] | null {
  const [w, l, h] = box.sizeWLH;
  if (!(w > 0 && l > 0 && h > 0)) return null;
  const pose = compilePose({ translation: box.center, rotation: box.rotation });
  if (!pose) return null;
  const xs = [1, 1, 1, 1, -1, -1, -1, -1];
  const ys = [1, -1, -1, 1, 1, -1, -1, 1];
  const zs = [1, 1, -1, -1, 1, 1, -1, -1];
  const out: Vec3[] = [];
  for (let i = 0; i < 8; i++) {
    out.push(applyPose(pose, [(l / 2) * xs[i]!, (w / 2) * ys[i]!, (h / 2) * zs[i]!]));
  }
  return out;
}

export type EdgeKind = 'front' | 'rear' | 'side';

/** 12 box edges as corner index pairs. */
export const BOX_EDGES: ReadonlyArray<readonly [number, number, EdgeKind]> = [
  [0, 1, 'front'], [1, 2, 'front'], [2, 3, 'front'], [3, 0, 'front'],
  [4, 5, 'rear'], [5, 6, 'rear'], [6, 7, 'rear'], [7, 4, 'rear'],
  [0, 4, 'side'], [1, 5, 'side'], [2, 6, 'side'], [3, 7, 'side'],
];
