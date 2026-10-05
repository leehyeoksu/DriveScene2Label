import { X } from 'lucide-react';
import type { BoxView } from '@/api/models';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type { CameraSlot } from '@/features/frames/useFrameBundle';
import type { PaneFrames } from '@/features/frames/usePaneFrames';
import { LayerToggles } from '@/features/objects/LayerToggles';
import type { PredState } from '@/features/objects/useFrameBoxes';
import { FrameTimeline } from '@/features/timeline/FrameTimeline';
import { useWorkspace, type PaneId } from '@/stores/workspace';
import { CameraGlyph } from './CameraGlyph';
import { CameraMedia } from './CameraTile';
import { cameraKo } from './cameraMeta';

interface Props {
  paneId: PaneId;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  frames: PaneFrames;
  boxes: readonly BoxView[];
  pred: PredState;
  /** Element to focus after closing (the dialog is opened programmatically, not by a Radix trigger). */
  returnFocus?: { current: HTMLElement | null };
}

/** Zoomed camera with the same overlay. Radix provides the focus trap, Esc and focus return to the opener. */
export function CameraDialog({ paneId, open, onOpenChange, frames, boxes, pred, returnFocus }: Props) {
  const focus = useWorkspace((s) => s.panes[paneId].focusCamera);
  const selectedKey = useWorkspace((s) => s.panes[paneId].selectedBoxKey);
  const setFocus = useWorkspace((s) => s.setFocusCamera);
  const selectBox = useWorkspace((s) => s.selectBox);
  const requestSample = useWorkspace((s) => s.requestSample);
  const slots = frames.displayed.cameras;
  const slot: CameraSlot | undefined = slots.find((c) => c.channel === focus) ?? slots[1];
  const channel = slot?.channel ?? focus ?? 'CAM_FRONT';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby="cam-dialog-desc"
        onCloseAutoFocus={(e) => {
          const el = returnFocus?.current;
          if (el && el.isConnected) {
            e.preventDefault();
            el.focus();
          }
        }}
        onKeyDown={(e) => {
          const t = e.target as HTMLElement;
          if (t.closest('input,select,textarea')) return;
          const i = frames.requestedIndex;
          const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null;
          if (next == null) return;
          const s = frames.samples[next];
          if (s) requestSample(paneId, s.token, 'user');
          e.preventDefault();
        }}
      >
        <div className="modal-head">
          <DialogTitle className="modal-title">
            <CameraGlyph channel={channel} />
            {cameraKo(channel)} <span className="mono dim">{channel}</span>
          </DialogTitle>
          <DialogDescription id="cam-dialog-desc" className="sr-only">
            선택한 카메라 이미지를 크게 보고 GT와 예측 박스를 확인해요. 왼쪽·오른쪽 화살표로 프레임을 옮길 수 있어요.
          </DialogDescription>
          <div className="seg seg--sm modal-cams" role="radiogroup" aria-label="카메라 선택">
            {slots.map((c) => (
              <button key={c.channel} type="button" role="radio" aria-checked={c.channel === channel} onClick={() => setFocus(paneId, c.channel)}>
                {cameraKo(c.channel)}
              </button>
            ))}
          </div>
          <LayerToggles paneId={paneId} pred={pred} />
          <DialogClose className="btn btn--icon modal-close" aria-label="닫기 (Esc)">
            <X className="icon" aria-hidden="true" />
          </DialogClose>
        </div>
        <div className="modal-stage">
          <div className="modal-frame">
            {slot && <CameraMedia slot={slot} boxes={boxes} selectedKey={selectedKey} onSelect={(k) => selectBox(paneId, k)} showLabels />}
          </div>
        </div>
        <div className="modal-foot">
          <FrameTimeline paneId={paneId} samples={frames.samples} requestedIndex={frames.requestedIndex} displayedIndex={frames.displayedIndex} buffering={frames.buffering} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
