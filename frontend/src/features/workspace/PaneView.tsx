import { AlertTriangle, RotateCcw } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { describeError } from '@/api/http';
import type { Scene } from '@/api/models';
import { CameraDialog } from '@/features/cameras/CameraDialog';
import { CameraGrid } from '@/features/cameras/CameraGrid';
import type { PaneFrames } from '@/features/frames/usePaneFrames';
import { Divider } from '@/features/layout/Divider';
import { LayerToggles } from '@/features/objects/LayerToggles';
import { visibleBoxes, type PredState } from '@/features/objects/useFrameBoxes';
import { RecordingPanel } from '@/features/viewer/RecordingPanel';
import { useLayout } from '@/stores/layout';
import { useWorkspace, type PaneId } from '@/stores/workspace';

export interface PaneData {
  frames: PaneFrames;
  pred: PredState;
}

/** Shared camera body: grid of the displayed frame plus its zoom dialog. */
export function useCameraBody(paneId: PaneId, { frames, pred }: PaneData, prefer?: '3x2' | '2x3') {
  const pane = useWorkspace((s) => s.panes[paneId]);
  const selectBox = useWorkspace((s) => s.selectBox);
  const setFocus = useWorkspace((s) => s.setFocusCamera);
  const [zoom, setZoom] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const boxes = useMemo(() => visibleBoxes(frames.displayed.gt, pred, pane.layers), [frames.displayed.gt, pred, pane.layers]);
  const body = (
    <>
      <FrameStatus frames={frames} />
      {frames.displayed.sample && (
        <CameraGrid
          cameras={frames.displayed.cameras}
          boxes={boxes}
          selectedKey={pane.selectedBoxKey}
          focusCamera={pane.focusCamera}
          onSelect={(k) => selectBox(paneId, pane.selectedBoxKey === k ? null : k)}
          onExpand={(ch) => { opener.current = document.activeElement as HTMLElement | null; setFocus(paneId, ch); setZoom(true); }}
          prefer={prefer}
          label={`카메라 6대, 프레임 ${frames.displayedIndex + 1}`}
        />
      )}
      <CameraDialog paneId={paneId} open={zoom} onOpenChange={setZoom} frames={frames} boxes={boxes} pred={pred} returnFocus={opener} />
    </>
  );
  return body;
}

function FrameStatus({ frames }: { frames: PaneFrames }) {
  if (frames.samplesError) return <div className="lidar-state" role="alert"><AlertTriangle className="icon" aria-hidden="true" /><b>프레임 목록을 불러오지 못했어요</b><span className="mono">{describeError(frames.samplesError)}</span></div>;
  if (frames.samplesLoading || (!frames.displayed.sample && frames.samples.length > 0)) return <div className="lidar-state" role="status"><span className="spin" aria-hidden="true" /><b>첫 프레임을 불러오고 있어요</b></div>;
  if (!frames.samplesLoading && frames.samples.length === 0) return <div className="lidar-state"><b>이 씬에는 프레임이 없어요</b></div>;
  if (frames.displayed.detailError) return <div className="lidar-state" role="alert"><AlertTriangle className="icon" aria-hidden="true" /><b>센서 파일 목록을 불러오지 못했어요</b><span className="mono">{describeError(frames.displayed.detailError)}</span></div>;
  return null;
}

interface SingleProps {
  scene: Scene;
  data: PaneData;
  view: 'split' | 'six';
}

/** Single-scene workspace body: 6 cameras, or cameras + LiDAR/3D with a resizable split. */
export function SinglePaneView({ scene, data, view }: SingleProps) {
  const ratio = useLayout((s) => s.splitRatio);
  const setRatio = useLayout((s) => s.setSplitRatio);
  const reset = useLayout((s) => s.resetSplit);
  const cams = useCameraBody('single', data, view === 'six' ? '3x2' : undefined);
  return (
    <section className="viewer" aria-label="센서 보기">
      <div className="vbar">
        <LayerToggles paneId="single" pred={data.pred} />
        {data.frames.buffering && <span className="buffering" role="status"><span className="spin" aria-hidden="true" />프레임 불러오는 중</span>}
        <span className="vbar-note">이미지는 JPG 키프레임이고 박스는 WORLD 좌표를 카메라별 보정값으로 투영한 결과예요.</span>
        <div className="vbar-end">
          {view === 'split' && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={reset}><RotateCcw className="icon" aria-hidden="true" /><span className="lbl">기본 배치</span></button>
          )}
        </div>
      </div>
      <div className="vbody">
        {view === 'six' ? cams : (
          <div className="split" style={{ ['--ratio' as string]: ratio }}>
            <div className="split-pane split-pane--a">{cams}</div>
            <Divider ratio={ratio} onChange={setRatio} onReset={reset} label="카메라와 LiDAR 영역 비율" />
            <div className="split-pane split-pane--b">
              <div className="lidar"><RecordingPanel paneId="single" scene={scene} enabled /></div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
