import { useQueries, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { CAMERA_CHANNELS } from '@/api/mappers';
import type { BoxView, SampleFrame, SampleRef, SensorFile } from '@/api/models';
import { annotationsQuery, calibrationQuery, poseQuery, sampleDetailQuery } from '@/api/queries';
import { compileCamera, type CompiledCamera } from '@/lib/geometry/projection';
import { useImages, type ImageState } from './useImages';

export type OverlayIssue = null | 'loading' | 'no-calibration' | 'no-pose' | 'no-intrinsic' | 'invalid';

export interface CameraSlot {
  channel: string;
  file: SensorFile | null;
  image: ImageState | null;
  camera: CompiledCamera | null;
  overlayIssue: OverlayIssue;
}

export interface FrameBundle {
  sample: SampleRef | null;
  /** Everything needed to draw this frame (images, GT, calibration, pose) has settled — success or error. */
  ready: boolean;
  frame: SampleFrame | null;
  detailError: unknown;
  gt: BoxView[] | null;
  gtError: unknown;
  cameras: CameraSlot[];
}

/**
 * Collects one sample's data from the shared query/image caches. Panes call it for the requested and the displayed
 * sample separately, so a frame being prepared never mixes into the frame on screen.
 */
export function useFrameBundle(sample: SampleRef | null): FrameBundle {
  const detail = useQuery({ ...sampleDetailQuery(sample?.id ?? -1), enabled: !!sample });
  const gt = useQuery({ ...annotationsQuery(sample?.id ?? -1), enabled: !!sample });
  const frame = detail.data ?? null;
  const files = useMemo(
    () => CAMERA_CHANNELS.map((ch) => frame?.cameras.get(ch) ?? null),
    [frame],
  );
  const present = files.filter((f): f is SensorFile => !!f);
  const datasetId = sample?.datasetId ?? -1;
  const cals = useQueries({ queries: present.map((f) => calibrationQuery(datasetId, f)) });
  const poses = useQueries({ queries: present.map((f) => poseQuery(f)) });
  const images = useImages(present.map((f) => f.contentUrl));

  // Recomputed every render: cheap, and avoids a dependency list whose length changes with the camera count.
  {
    const cameras: CameraSlot[] = CAMERA_CHANNELS.map((channel, i) => {
      const file = files[i] ?? null;
      if (!file) return { channel, file: null, image: null, camera: null, overlayIssue: null };
      const j = present.indexOf(file);
      const cal = cals[j];
      const pose = poses[j];
      let camera: CompiledCamera | null = null;
      let overlayIssue: OverlayIssue = null;
      if (cal?.isPending || pose?.isPending) overlayIssue = 'loading';
      else if (!cal?.data) overlayIssue = 'no-calibration';
      else if (!pose?.data) overlayIssue = 'no-pose';
      else if (!cal.data.intrinsic) overlayIssue = 'no-intrinsic';
      else {
        camera = compileCamera({
          egoPose: pose.data.egoToWorld, calibration: cal.data.sensorToEgo, intrinsic: cal.data.intrinsic,
          width: file.width, height: file.height,
        });
        if (!camera) overlayIssue = 'invalid';
      }
      return { channel, file, image: images.get(file.contentUrl) ?? null, camera, overlayIssue };
    });
    const detailSettled = !sample || !detail.isPending;
    const ready = !!sample && detailSettled && !gt.isPending
      && cameras.every((c) => !c.file || (c.image?.status !== 'loading' && c.overlayIssue !== 'loading'));
    return {
      sample, ready, frame, detailError: detail.error, gt: gt.data ?? null, gtError: gt.error, cameras,
    };
  }
}
