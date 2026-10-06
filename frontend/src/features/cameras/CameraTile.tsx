import { AlertTriangle, CameraOff, Maximize2 } from 'lucide-react';
import { memo, useMemo } from 'react';
import type { BoxView } from '@/api/models';
import type { CameraSlot } from '@/features/frames/useFrameBundle';
import { containFit } from '@/lib/geometry/fit';
import { useElementSize } from '@/hooks/useElementSize';
import { cn } from '@/lib/utils';
import { CameraGlyph } from './CameraGlyph';
import { CameraOverlay, projectAll } from './CameraOverlay';
import { cameraKo } from './cameraMeta';

const OVERLAY_NOTE: Record<string, string> = {
  'no-calibration': '보정값이 없어 박스를 표시할 수 없어요',
  'no-pose': '차량 자세(pose)가 없어 박스를 표시할 수 없어요',
  'no-intrinsic': '카메라 내부 파라미터가 없어 박스를 표시할 수 없어요',
  invalid: '보정값이 올바르지 않아 박스를 표시할 수 없어요',
};

interface MediaProps {
  slot: CameraSlot;
  boxes: readonly BoxView[];
  selectedKey: string | null;
  onSelect?: (key: string) => void;
  showLabels?: boolean;
}

/** Image + projected boxes of one camera at one sample. Used by tiles and the zoom dialog. */
export function CameraMedia({ slot, boxes, selectedKey, onSelect, showLabels }: MediaProps) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const { file, image, camera, overlayIssue } = slot;
  const items = useMemo(() => projectAll(camera, boxes), [camera, boxes]);
  if (!file) {
    return (
      <div className="cam-state" data-state="missing">
        <CameraOff className="icon" aria-hidden="true" />
        <b>이 프레임에 카메라 파일이 없어요</b>
        <span>다른 카메라와 탐색은 그대로 쓸 수 있어요</span>
      </div>
    );
  }
  if (!image || image.status === 'loading') return <div className="cam-state cam-state--loading" data-state="loading" aria-label="이미지 불러오는 중" />;
  if (image.status === 'error') {
    const msg = image.error === 'missing' ? '서버에 이미지 파일이 없어요' : image.error === 'decode' ? '이미지를 읽을 수 없어요' : '이미지를 내려받지 못했어요';
    return (
      <div className="cam-state cam-state--error" data-state="error">
        <AlertTriangle className="icon" aria-hidden="true" />
        <b>{msg}</b>
        <span className="mono">{file.channel}</span>
      </div>
    );
  }
  const fit = containFit(file.width, file.height, size.width, size.height);
  return (
    <div className="cam-media" ref={ref} data-state="ready" data-sample-data={file.token}>
      <img src={image.src ?? undefined} alt={`${cameraKo(file.channel)} 카메라 (${file.channel})`} draggable={false} />
      {camera && fit && (
        <CameraOverlay items={items} width={file.width} height={file.height} scale={fit.scale} selectedKey={selectedKey} onSelect={onSelect} showLabels={showLabels} />
      )}
      {overlayIssue && overlayIssue !== 'loading' && boxes.length > 0 && <span className="cam-note">{OVERLAY_NOTE[overlayIssue]}</span>}
    </div>
  );
}

interface TileProps extends MediaProps {
  current?: boolean;
  onExpand: () => void;
}

export const CameraTile = memo(function CameraTile({ slot, current, onExpand, ...media }: TileProps) {
  return (
    <div className={cn('cam-tile', current && 'is-current')} style={{ gridArea: areaOf(slot.channel) }} data-channel={slot.channel}>
      <CameraMedia slot={slot} {...media} />
      <div className="cam-head">
        <CameraGlyph channel={slot.channel} />
        <span className="cam-ko">{cameraKo(slot.channel)}</span>
        <span className="cam-ch">{slot.channel}</span>
      </div>
      <button type="button" className="cam-expand" onClick={onExpand} aria-label={`${cameraKo(slot.channel)} 카메라 크게 보기`} title="크게 보기">
        <Maximize2 className="icon" aria-hidden="true" />
      </button>
    </div>
  );
});

function areaOf(channel: string): string {
  return ({ CAM_FRONT_LEFT: 'fl', CAM_FRONT: 'f', CAM_FRONT_RIGHT: 'fr', CAM_BACK_LEFT: 'bl', CAM_BACK: 'b', CAM_BACK_RIGHT: 'br' } as Record<string, string>)[channel] ?? 'auto';
}
