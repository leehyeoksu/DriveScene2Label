import type { PredState } from './useFrameBoxes';
import { useWorkspace, type PaneId } from '@/stores/workspace';

/** GT (dashed) / prediction (solid) toggles. Text and line style name the source, not only colour. */
export function LayerToggles({ paneId, pred }: { paneId: PaneId; pred: PredState }) {
  const layers = useWorkspace((s) => s.panes[paneId].layers);
  const toggle = useWorkspace((s) => s.toggleLayer);
  const predHint = pred.kind === 'none' ? '없음' : pred.kind === 'loading' ? '불러오는 중' : pred.kind === 'error' ? '오류' : '';
  return (
    <div className="layer-toggles" style={{ alignItems: 'center' }} role="group" aria-label="카메라 라벨 레이어 (3D 보기에는 적용되지 않음)">
      <span className="scope-note" title="이 토글은 카메라 이미지 위 박스와 객체 목록에만 적용돼요. 3D 보기의 표시는 뷰어 안에서 조절해요.">카메라 라벨</span>
      <button type="button" className="ltog" data-layer="gt" aria-pressed={layers.gt} onClick={() => toggle(paneId, 'gt')} title="카메라의 GT 박스(점선) 표시">
        <span className="swatch swatch--gt" />GT
      </button>
      <button type="button" className="ltog" data-layer="pred" aria-pressed={layers.pred} onClick={() => toggle(paneId, 'pred')} title="카메라의 예측 박스(실선) 표시">
        <span className="swatch swatch--pred" />예측{predHint && <span className="ltog-hint">{predHint}</span>}
      </button>
    </div>
  );
}
