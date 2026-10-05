import type { PredState } from './useFrameBoxes';
import { useWorkspace, type PaneId } from '@/stores/workspace';

/** GT (dashed) / prediction (solid) toggles. Text and line style name the source, not only colour. */
export function LayerToggles({ paneId, pred }: { paneId: PaneId; pred: PredState }) {
  const layers = useWorkspace((s) => s.panes[paneId].layers);
  const toggle = useWorkspace((s) => s.toggleLayer);
  const predHint = pred.kind === 'none' ? '없음' : pred.kind === 'loading' ? '불러오는 중' : pred.kind === 'error' ? '오류' : '';
  return (
    <div className="layer-toggles" role="group" aria-label="라벨 레이어">
      <button type="button" className="ltog" data-layer="gt" aria-pressed={layers.gt} onClick={() => toggle(paneId, 'gt')} title="GT 박스(점선) 표시">
        <span className="swatch swatch--gt" />GT
      </button>
      <button type="button" className="ltog" data-layer="pred" aria-pressed={layers.pred} onClick={() => toggle(paneId, 'pred')} title="예측 박스(실선) 표시">
        <span className="swatch swatch--pred" />예측{predHint && <span className="ltog-hint">{predHint}</span>}
      </button>
    </div>
  );
}
