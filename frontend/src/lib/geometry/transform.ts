/**
 * Rigid transforms in nuScenes conventions.
 *
 * - Quaternions are stored with explicit field names `{w,x,y,z}` so the API's W/X/Y/Z order can never be confused
 *   with an `[x,y,z,w]` library convention.
 * - A `Pose` maps child coordinates into its parent: `p_parent = R · p_child + t`.
 *   calibrated_sensor is sensor→ego, ego_pose is ego→world (README_API.md).
 */
export type Vec3 = readonly [number, number, number];
export type Mat3 = readonly [number, number, number, number, number, number, number, number, number]; // row-major

export interface Quat {
  readonly w: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Pose {
  readonly translation: Vec3;
  readonly rotation: Quat;
}

export function isFiniteVec(v: readonly number[]): boolean {
  return v.every((n) => Number.isFinite(n));
}

export function quatNorm(q: Quat): number {
  return Math.hypot(q.w, q.x, q.y, q.z);
}

/** Unit quaternion or null when the input is degenerate/non-finite. */
export function normalizeQuat(q: Quat): Quat | null {
  const n = quatNorm(q);
  if (!Number.isFinite(n) || n < 1e-9) return null;
  return { w: q.w / n, x: q.x / n, y: q.y / n, z: q.z / n };
}

export function quatToMat3(q: Quat): Mat3 {
  const { w, x, y, z } = q;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ];
}

export function mulMat3Vec(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

/** Rᵀ·v — inverse rotation for an orthonormal matrix. */
export function mulMat3TVec(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
    m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
    m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
  ];
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/** Precomputed pose for repeated use. */
export interface CompiledPose {
  readonly t: Vec3;
  readonly r: Mat3;
}

export function compilePose(p: Pose): CompiledPose | null {
  const q = normalizeQuat(p.rotation);
  if (!q || !isFiniteVec(p.translation)) return null;
  return { t: p.translation, r: quatToMat3(q) };
}

/** child → parent */
export function applyPose(p: CompiledPose, v: Vec3): Vec3 {
  return add(mulMat3Vec(p.r, v), p.t);
}

/** parent → child */
export function applyPoseInverse(p: CompiledPose, v: Vec3): Vec3 {
  return mulMat3TVec(p.r, sub(v, p.t));
}

/** Yaw (rotation about +z) of a quaternion, radians. Informational only. */
export function yawOf(q: Quat): number {
  return Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));
}
