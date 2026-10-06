import { describe, expect, it } from 'vitest';
import { boxCorners } from './box';
import { containFit, imageToBox } from './fit';
import { clipToNear, clipToRect, compileCamera, projectBox, worldToCamera, type CameraModel } from './projection';
import { compilePose, quatToMat3, type Mat3, type Quat, type Vec3 } from './transform';

const I: Quat = { w: 1, x: 0, y: 0, z: 0 };
/** nuScenes-style CAM_FRONT orientation: camera z(forward) → ego +x, camera x(right) → ego −y, camera y(down) → ego −z. */
const CAM_FRONT_Q: Quat = { w: 0.5, x: -0.5, y: 0.5, z: -0.5 };
const K: Mat3 = [1000, 0, 800, 0, 1000, 450, 0, 0, 1];

const close = (a: readonly number[], b: readonly number[], eps = 1e-9) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, -Math.log10(eps)));

function frontCamera(ego: { t?: Vec3; q?: Quat } = {}): ReturnType<typeof compileCamera> {
  const m: CameraModel = {
    egoPose: { translation: ego.t ?? [0, 0, 0], rotation: ego.q ?? I },
    calibration: { translation: [0, 0, 0], rotation: CAM_FRONT_Q },
    intrinsic: K,
    width: 1600,
    height: 900,
  };
  return compileCamera(m);
}

describe('quaternion W/X/Y/Z', () => {
  it('maps the camera axes like the nuScenes front camera', () => {
    const r = quatToMat3(CAM_FRONT_Q);
    // columns are the images of the camera axes in ego coordinates
    close([r[2], r[5], r[8]], [1, 0, 0]); // z_cam → +x_ego
    close([r[0], r[3], r[6]], [0, -1, 0]); // x_cam → −y_ego
    close([r[1], r[4], r[7]], [0, 0, -1]); // y_cam → −z_ego
  });
  it('rejects degenerate quaternions', () => {
    expect(compilePose({ translation: [0, 0, 0], rotation: { w: 0, x: 0, y: 0, z: 0 } })).toBeNull();
    expect(compilePose({ translation: [Number.NaN, 0, 0], rotation: I })).toBeNull();
  });
});

describe('box corners (local x=L, y=W, z=H)', () => {
  it('uses size W/L/H with length along local x', () => {
    const c = boxCorners({ center: [1, 2, 3], sizeWLH: [2, 4, 1.5], rotation: I })!;
    close(c[0]!, [1 + 2, 2 + 1, 3 + 0.75]); // front-left-top: +L/2, +W/2, +H/2
    close(c[6]!, [1 - 2, 2 - 1, 3 - 0.75]);
    const xs = c.map((p) => p[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(4); // L
  });
  it('rotates length onto world +y for a 90° yaw', () => {
    const s = Math.SQRT1_2;
    const c = boxCorners({ center: [0, 0, 0], sizeWLH: [2, 4, 1], rotation: { w: s, x: 0, y: 0, z: s } })!;
    const ys = c.map((p) => p[1]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(4);
    close(c[0]!, [-1, 2, 0.5]);
  });
  it('returns null for non-positive sizes', () => {
    expect(boxCorners({ center: [0, 0, 0], sizeWLH: [0, 4, 1], rotation: I })).toBeNull();
  });
});

describe('world → ego → sensor → pixel', () => {
  it('projects a point ahead of the car onto the principal point', () => {
    const cam = frontCamera()!;
    close(worldToCamera(cam, [10, 0, 0]), [0, 0, 10]);
    const p = projectBox(cam, { center: [10, 0, 0], sizeWLH: [1, 1, 1], rotation: I })!;
    const us = p.segments.flatMap((s) => [s.x1, s.x2]);
    expect((Math.min(...us) + Math.max(...us)) / 2).toBeCloseTo(800, 0);
    expect(p.depth).toBeCloseTo(10);
  });
  it('puts an object on the ego-left (+y) at the left of the image, with hand-computed pixels', () => {
    const cam = frontCamera()!;
    // centre (10, 2, 0.5) → camera (−2, −0.5, 10) → u = 800 − 200 = 600, v = 450 − 50 = 400
    const c = worldToCamera(cam, [10, 2, 0.5]);
    close(c, [-2, -0.5, 10]);
    const p = projectBox(cam, { center: [10, 2, 0.5], sizeWLH: [0.2, 0.2, 0.2], rotation: I })!;
    const us = p.segments.flatMap((s) => [s.x1, s.x2]);
    const vs = p.segments.flatMap((s) => [s.y1, s.y2]);
    expect(Math.min(...us)).toBeLessThan(600);
    expect(Math.max(...us)).toBeGreaterThan(600);
    expect(Math.min(...vs)).toBeLessThan(400);
    expect(Math.max(...vs)).toBeGreaterThan(400);
  });
  it('applies each camera’s own ego pose (car moved and turned)', () => {
    const s = Math.SQRT1_2;
    // ego at (100, 50) facing world +y: a box 10 m ahead is at world (100, 60)
    const cam = frontCamera({ t: [100, 50, 0], q: { w: s, x: 0, y: 0, z: s } })!;
    close(worldToCamera(cam, [100, 60, 0]), [0, 0, 10], 1e-6);
  });
  it('drops boxes behind the camera and outside the image', () => {
    const cam = frontCamera()!;
    expect(projectBox(cam, { center: [-10, 0, 0], sizeWLH: [2, 4, 2], rotation: I })).toBeNull();
    expect(projectBox(cam, { center: [1, 50, 0], sizeWLH: [1, 1, 1], rotation: I })).toBeNull();
  });
  it('clips a box that straddles the camera plane without wrap-around lines', () => {
    const cam = frontCamera()!;
    const p = projectBox(cam, { center: [0.5, 0, 0], sizeWLH: [2, 6, 2], rotation: I })!;
    expect(p).not.toBeNull();
    for (const sgm of p.segments) {
      for (const v of [sgm.x1, sgm.x2]) expect(v).toBeGreaterThanOrEqual(-1e-6), expect(v).toBeLessThanOrEqual(1600 + 1e-6);
      for (const v of [sgm.y1, sgm.y2]) expect(v).toBeGreaterThanOrEqual(-1e-6), expect(v).toBeLessThanOrEqual(900 + 1e-6);
    }
  });
  it('refuses cameras without valid intrinsics', () => {
    expect(compileCamera({ egoPose: { translation: [0, 0, 0], rotation: I }, calibration: { translation: [0, 0, 0], rotation: I }, intrinsic: [0, 0, 0, 0, 0, 0, 0, 0, 1], width: 1600, height: 900 })).toBeNull();
  });
});

describe('clipping helpers', () => {
  it('clips a segment at the near plane', () => {
    const r = clipToNear([0, 0, -1], [0, 0, 1], 0.1)!;
    close(r[0], [0, 0, 0.1]);
    close(r[1], [0, 0, 1]);
    expect(clipToNear([0, 0, -1], [0, 0, -2], 0.1)).toBeNull();
  });
  it('clips to the image rectangle', () => {
    expect(clipToRect(-10, 5, 10, 5, 100, 100)).toEqual([0, 5, 10, 5]);
    expect(clipToRect(-10, -10, -5, -5, 100, 100)).toBeNull();
  });
});

describe('object-fit: contain', () => {
  it('letterboxes and maps image pixels like the SVG viewBox', () => {
    const f = containFit(1600, 900, 800, 600)!;
    expect(f.scale).toBeCloseTo(0.5);
    expect(f.offsetY).toBeCloseTo((600 - 450) / 2);
    expect(imageToBox(f, 1600, 900)).toEqual([800, 75 + 450]);
  });
});
