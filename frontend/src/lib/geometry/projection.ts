import { BOX_EDGES, boxCorners, type Box3, type EdgeKind } from './box';
import { applyPoseInverse, compilePose, type CompiledPose, type Mat3, type Pose, type Vec3 } from './transform';

/**
 * One camera at one sample: its own ego pose (ego→world, at this file's timestamp), its calibration (sensor→ego),
 * intrinsics and the original image size. Never share an ego pose across cameras.
 */
export interface CameraModel {
  readonly egoPose: Pose;
  readonly calibration: Pose;
  readonly intrinsic: Mat3;
  readonly width: number;
  readonly height: number;
}

export interface CompiledCamera {
  readonly ego: CompiledPose;
  readonly cal: CompiledPose;
  readonly k: Mat3;
  readonly width: number;
  readonly height: number;
}

export function compileCamera(c: CameraModel): CompiledCamera | null {
  const ego = compilePose(c.egoPose);
  const cal = compilePose(c.calibration);
  if (!ego || !cal || !c.intrinsic.every(Number.isFinite) || !(c.width > 0 && c.height > 0)) return null;
  if (!(c.intrinsic[0] > 0 && c.intrinsic[4] > 0)) return null;
  return { ego, cal, k: c.intrinsic, width: c.width, height: c.height };
}

/** world → ego (inverse ego pose) → sensor (inverse calibration). Camera frame: x right, y down, z forward. */
export function worldToCamera(cam: CompiledCamera, p: Vec3): Vec3 {
  return applyPoseInverse(cam.cal, applyPoseInverse(cam.ego, p));
}

/** Pinhole projection of a camera-frame point with depth z > 0. */
export function projectPoint(k: Mat3, p: Vec3): [number, number] {
  const x = k[0] * p[0] + k[1] * p[1] + k[2] * p[2];
  const y = k[3] * p[0] + k[4] * p[1] + k[5] * p[2];
  const z = k[6] * p[0] + k[7] * p[1] + k[8] * p[2];
  return [x / z, y / z];
}

export interface Segment2 {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly kind: EdgeKind;
}

export interface ProjectedBox {
  /** Edges after near-plane and image-rectangle clipping, in original image pixels. */
  readonly segments: Segment2[];
  /** Anchor for a label: the top-most visible point. */
  readonly anchor: [number, number];
  /** Camera-frame depth of the box centre (m). */
  readonly depth: number;
}

/** Default near plane (m). Edges are clipped against z = near before division, so nothing behind wraps around. */
export const NEAR_PLANE = 0.1;

/** Clip a 3D segment to z >= near. Returns null if fully behind. */
export function clipToNear(a: Vec3, b: Vec3, near = NEAR_PLANE): [Vec3, Vec3] | null {
  const ina = a[2] >= near;
  const inb = b[2] >= near;
  if (ina && inb) return [a, b];
  if (!ina && !inb) return null;
  const t = (near - a[2]) / (b[2] - a[2]);
  const c: Vec3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, near];
  return ina ? [a, c] : [c, b];
}

/** Liang–Barsky clip of a 2D segment to [0,w]×[0,h]. */
export function clipToRect(x1: number, y1: number, x2: number, y2: number, w: number, h: number): [number, number, number, number] | null {
  const dx = x2 - x1;
  const dy = y2 - y1;
  let t0 = 0;
  let t1 = 1;
  const checks: Array<[number, number]> = [[-dx, x1], [dx, w - x1], [-dy, y1], [dy, h - y1]];
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return null;
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }
  return [x1 + t0 * dx, y1 + t0 * dy, x1 + t1 * dx, y1 + t1 * dy];
}

/**
 * Project a WORLD box into one camera. Returns null when nothing of the box is in front of the camera
 * and inside the image (box behind the camera, outside the frustum, or invalid geometry).
 */
export function projectBox(cam: CompiledCamera, box: Box3, near = NEAR_PLANE): ProjectedBox | null {
  const corners = boxCorners(box);
  if (!corners) return null;
  const camPts = corners.map((p) => worldToCamera(cam, p));
  const segments: Segment2[] = [];
  let anchor: [number, number] | null = null;
  for (const [i, j, kind] of BOX_EDGES) {
    const clipped = clipToNear(camPts[i]!, camPts[j]!, near);
    if (!clipped) continue;
    const [u1, v1] = projectPoint(cam.k, clipped[0]);
    const [u2, v2] = projectPoint(cam.k, clipped[1]);
    if (![u1, v1, u2, v2].every(Number.isFinite)) continue;
    const inImage = clipToRect(u1, v1, u2, v2, cam.width, cam.height);
    if (!inImage) continue;
    const [a, b, c, d] = inImage;
    segments.push({ x1: a, y1: b, x2: c, y2: d, kind });
    for (const [x, y] of [[a, b], [c, d]] as const) if (!anchor || y < anchor[1]) anchor = [x, y];
  }
  if (!segments.length || !anchor) return null;
  const center = worldToCamera(cam, box.center);
  return { segments, anchor, depth: center[2] };
}
