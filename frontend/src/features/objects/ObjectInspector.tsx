import { X } from 'lucide-react';
import { useMemo } from 'react';
import { describeError } from '@/api/http';
import type { BoxView, SampleRef } from '@/api/models';
import type { FrameBundle } from '@/features/frames/useFrameBundle';
import { projectBox } from '@/lib/geometry/projection';
import { CLASS_COLORS } from '@/lib/classes';
import { useWorkspace, type PaneId } from '@/stores/workspace';
import { boxClassName, boxColorClass, gtComparisonClass } from './boxLabels';
import type { PredState } from './useFrameBoxes';

interface Props {
  paneId: PaneId;
  bundle: FrameBundle;
  frameNumber: number;
  pred: PredState;
}

interface Row {
  box: BoxView;
  cams: string[];
  dist: number | null;
}

const f2 = (n: number) => n.toFixed(2);
const f3 = (n: number) => n.toFixed(3);
const short = (t: string | null) => (t ? `${t.slice(0, 8)}…` : '-');

/** Objects of the displayed frame. Selecting a row or a box shows source, class, WORLD position, W/L/H and rotation. */
export function ObjectInspector({ paneId, bundle, frameNumber, pred }: Props) {
  const pane = useWorkspace((s) => s.panes[paneId]);
  const selectBox = useWorkspace((s) => s.selectBox);
  const sample: SampleRef | null = bundle.sample;
  const ego = bundle.frame?.lidar?.vehicle ?? bundle.frame?.cameras.get('CAM_FRONT')?.vehicle ?? null;

  const rows = useMemo<Row[]>(() => {
    const all: BoxView[] = [...(bundle.gt ?? []), ...(pred.kind === 'ready' ? pred.boxes : [])];
    return all.map((box) => ({
      box,
      cams: bundle.cameras.filter((c) => c.camera && projectBox(c.camera, box)).map((c) => c.channel),
      dist: ego ? Math.hypot(box.center[0] - ego[0], box.center[1] - ego[1]) : null,
    })).sort((a, b) => (a.dist ?? 0) - (b.dist ?? 0));
  }, [bundle.gt, bundle.cameras, pred, ego]);

  const visible = rows.filter((r) => (r.box.source === 'GT' ? pane.layers.gt : pane.layers.pred));
  const nGt = bundle.gt?.length ?? 0;
  const selected = rows.find((r) => r.box.key === pane.selectedBoxKey);

  return (
    <section className="insp-sec insp-sec--grow" aria-labelledby={`obj-h-${paneId}`}>
      <div className="sec-head"><h2 id={`obj-h-${paneId}`}>객체</h2><span className="sec-aside">{sample ? `프레임 ${frameNumber}` : ''}</span></div>
      {selected ? (
        <ObjectDetail row={selected} sample={sample} paneId={paneId} onClose={() => selectBox(paneId, null)} />
      ) : (
        <p className="empty-note" style={{ marginBottom: 10 }}>카메라의 박스나 아래 목록에서 객체를 골라 보세요.</p>
      )}
      <div className="obj-meta">
        <span><i className="swatch swatch--gt" />GT {bundle.gtError ? '불러오지 못함' : nGt}</span>
        <span><i className="swatch swatch--pred" />예측 {predSummary(pred)}</span>
      </div>
      {pred.kind === 'error' && (
        <p className="list-empty">예측 결과를 불러오지 못했어요 ({describeError(pred.error)}). <button type="button" className="btn btn--sm btn--weak" onClick={pred.refetch}>결과 다시 불러오기</button></p>
      )}
      {bundle.gtError != null && <p className="list-empty">GT를 불러오지 못했어요 ({describeError(bundle.gtError)}).</p>}
      {!visible.length ? (
        <p className="list-empty">
          {!pane.layers.gt && !pane.layers.pred
            ? 'GT와 예측 레이어가 모두 꺼져 있어요. 위쪽 레이어 버튼으로 다시 켤 수 있어요.'
            : pred.kind === 'ready' && pred.boxes.length === 0 && nGt === 0
              ? '이 프레임에는 GT와 검출된 예측 박스가 없어요.'
              : '이 프레임에는 표시할 박스가 없어요.'}
        </p>
      ) : (
        <ul className="obj-list" aria-label={`프레임 ${frameNumber}의 객체`}>
          {visible.map(({ box, cams, dist }) => {
            const cls = boxColorClass(box, pane.classMode);
            return (
              <li key={box.key}>
                <button type="button" className="obj-row" aria-pressed={box.key === pane.selectedBoxKey} onClick={() => selectBox(paneId, box.key === pane.selectedBoxKey ? null : box.key)}>
                  <span className={`swatch swatch--${box.source === 'GT' ? 'gt' : 'pred'}`} aria-hidden="true" />
                  <span className="obj-cls">
                    <i className="cls-dot" style={{ ['--c' as string]: (cls && CLASS_COLORS[cls]) || '#8b95a1' }} />
                    {boxClassName(box)}
                    <span className="sr-only">{box.source === 'GT' ? ', GT' : ', 예측'}</span>
                  </span>
                  <span className="obj-cam">{cams[0]?.replace('CAM_', '') ?? '—'}</span>
                  <span className="obj-dist">{dist != null ? `${dist.toFixed(1)} m` : '-'}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function predSummary(pred: PredState): string {
  switch (pred.kind) {
    case 'none': return '없음 · 완료된 작업을 고르면 보여요';
    case 'loading': return '불러오는 중';
    case 'error': return '오류';
    case 'not-in-job': return `작업 #${pred.jobId}에 이 프레임 결과 없음`;
    case 'ready': return pred.boxes.length ? `${pred.boxes.length} (작업 #${pred.jobId})` : `0 · 검출 박스 없음 (작업 #${pred.jobId})`;
  }
}

function ObjectDetail({ row, sample, paneId, onClose }: { row: Row; sample: SampleRef | null; paneId: PaneId; onClose: () => void }) {
  const mode = useWorkspace((s) => s.panes[paneId].classMode);
  const { box, cams, dist } = row;
  const gt = box.source === 'GT';
  const cmp = gtComparisonClass(box, mode);
  return (
    <div className="obj-detail" data-testid="object-detail">
      <div className="od-head">
        <span className={`swatch swatch--${gt ? 'gt' : 'pred'}`} />
        <span className="od-cls">{boxClassName(box)}</span>
        <span className="tag">{gt ? 'GT' : '예측'}</span>
        <button type="button" className="btn btn--icon btn--ghost" onClick={onClose} aria-label="선택 해제 (Esc)"><X className="icon" aria-hidden="true" /></button>
      </div>
      <dl className="kv">
        {gt ? (
          <>
            <dt>원본 category</dt><dd className="mono">{box.label ?? '클래스 정보 없음'}</dd>
            <dt>{mode}종 비교 분류</dt><dd>{cmp ?? '비교 분류 없음'}</dd>
            <dt>instanceToken</dt><dd className="mono" title={box.instanceToken ?? ''}>{short(box.instanceToken)}</dd>
            <dt>LiDAR 점 수</dt><dd>{box.numLidarPts ?? '-'}</dd>
          </>
        ) : (
          <>
            <dt>detectionName</dt><dd className="mono">{box.label}</dd>
            <dt>작업</dt><dd>#{box.jobId}</dd>
            <dt>속도 X, Y (m/s)</dt><dd className="mono">{box.velocityXY?.map(f2).join(', ') ?? '-'}</dd>
          </>
        )}
        <dt>중심 WORLD (m)</dt><dd className="mono">{box.center.map(f2).join(', ')}</dd>
        <dt>크기 W / L / H (m)</dt><dd className="mono">{box.sizeWLH.map(f2).join(' / ')}</dd>
        <dt>회전 W, X, Y, Z</dt><dd className="mono">{[box.rotation.w, box.rotation.x, box.rotation.y, box.rotation.z].map(f3).join(', ')}</dd>
        <dt>ego 기준 수평 거리</dt><dd>{dist != null ? `${dist.toFixed(1)} m` : '-'}</dd>
        <dt>보이는 카메라</dt><dd className="mono">{cams.length ? cams.map((c) => c.replace('CAM_', '')).join(', ') : '없음'}</dd>
        <dt>sampleToken</dt><dd className="mono" title={sample?.token}>{short(sample?.token ?? null)}</dd>
      </dl>
      <p className="note">
        {gt
          ? '원본 nuScenes category를 그대로 보여 주고, 비교 분류는 VESPA mapping 표를 따라요. 예측과의 일대일 대응은 추정하지 않아요.'
          : '예측은 datasetId와 sampleToken으로 이 프레임에 연결돼요. detectionScore는 VESPA 고정값이라 신뢰도로 보여 드리지 않아요.'}
      </p>
    </div>
  );
}
