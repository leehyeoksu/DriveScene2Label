import { ArrowLeft, ExternalLink, Link2, PanelRightClose, PanelRightOpen, RotateCcw } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import type { SampleRef, Scene } from '@/api/models';
import { compareUrl, parseCompare, searchUrl, workspaceUrl } from '@/app/urls';
import { StateBox } from '@/components/StateBox';
import { usePaneFrames, type PaneFrames } from '@/features/frames/usePaneFrames';
import { Divider } from '@/features/layout/Divider';
import { JobPanel } from '@/features/labeling/JobPanel';
import { LayerToggles } from '@/features/objects/LayerToggles';
import { ObjectInspector } from '@/features/objects/ObjectInspector';
import { usePredictions, type PredState } from '@/features/objects/useFrameBoxes';
import { useScene } from '@/features/scenes/useScene';
import { FrameTimeline } from '@/features/timeline/FrameTimeline';
import { RecordingPanel } from '@/features/viewer/RecordingPanel';
import { usePlaybackLifecycle, useWorkspaceShortcuts } from '@/features/workspace/hooks';
import { useCameraBody } from '@/features/workspace/PaneView';
import { DataOriginBadge } from '@/features/system/DataOriginBadge';
import { mapRelative } from '@/lib/time/timeline';
import { cn } from '@/lib/utils';
import { useLayout } from '@/stores/layout';
import { toast } from '@/stores/toast';
import { useWorkspace, type CompareSide } from '@/stores/workspace';

export default function SceneComparePage() {
  const [sp] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const params = parseCompare(sp);
  const openScene = useWorkspace((s) => s.openScene);
  const setActivePane = useWorkspace((s) => s.setActivePane);
  const setSync = useWorkspace((s) => s.setSync);
  const active = useWorkspace((s) => s.activePane);
  const sync = useWorkspace((s) => s.sync);
  const paneA = useWorkspace((s) => s.panes.A);
  const paneB = useWorkspace((s) => s.panes.B);
  const ratio = useLayout((s) => s.compareRatio);
  const setRatio = useLayout((s) => s.setCompareRatio);
  const resetRatio = useLayout((s) => s.resetCompare);
  const collapsed = useLayout((s) => s.inspectorCollapsed);
  const setCollapsed = useLayout((s) => s.setInspectorCollapsed);

  const written = useRef<string | null>(null);
  useEffect(() => {
    if (location.search === written.current) return;
    for (const side of ['A', 'B'] as const) {
      const p = params[side];
      if (p.datasetId != null && p.sceneId != null) openScene(side, { datasetId: p.datasetId, sceneId: p.sceneId, sampleToken: p.sample, jobId: p.job });
    }
    setActivePane(params.active);
    setSync(params.sync);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  const sceneA = useScene(paneA.datasetId, paneA.sceneId);
  const sceneB = useScene(paneB.datasetId, paneB.sceneId);
  const framesA = usePaneFrames('A');
  const framesB = usePaneFrames('B');
  const predA = usePredictions(paneA.resultJobId, framesA.displayed.sample);
  const predB = usePredictions(paneB.resultJobId, framesB.displayed.sample);
  usePlaybackLifecycle();
  useWorkspaceShortcuts(active, active === 'A' ? framesA : framesB);
  useRelativeSync(framesA.samples, framesB.samples);

  // Store → URL.
  useEffect(() => {
    if (paneA.playing || paneB.playing || framesA.buffering || framesB.buffering) return;
    const t = window.setTimeout(() => {
      const url = compareUrl({
        A: { datasetId: paneA.datasetId, sceneId: paneA.sceneId, sample: paneA.displayedSampleToken, job: paneA.jobId },
        B: { datasetId: paneB.datasetId, sceneId: paneB.sceneId, sample: paneB.displayedSampleToken, job: paneB.jobId },
        sync, active,
      });
      const search = url.slice(url.indexOf('?'));
      if (search !== location.search) {
        written.current = search;
        navigate(url, { replace: true });
      }
    }, 250);
    return () => window.clearTimeout(t);
  }, [paneA, paneB, sync, active, framesA.buffering, framesB.buffering, location.search, navigate]);

  if (params.A.datasetId == null || params.A.sceneId == null || params.B.datasetId == null || params.B.sceneId == null) {
    return (
      <div className="page-state">
        <StateBox kind="error" title="비교할 두 씬 정보가 링크에 없어요" actions={<Link className="btn btn--weak" to={searchUrl(null)}>씬 목록에서 고르기</Link>}>
          datasetA/sceneA와 datasetB/sceneB가 모두 필요해요.
        </StateBox>
      </div>
    );
  }

  const activeScene = active === 'A' ? sceneA.scene : sceneB.scene;
  const activeFrames = active === 'A' ? framesA : framesB;
  const activePred = active === 'A' ? predA : predB;
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(window.location.href); toast('두 씬 비교 링크를 복사했어요', 'ok'); } catch { toast('링크를 복사하지 못했어요', 'error'); }
  };

  return (
    <div className="app app--ws" data-view="compare">
      <header className="topbar">
        <Link className="btn btn--ghost btn--sm" to={searchUrl(paneA.datasetId)}><ArrowLeft className="icon" aria-hidden="true" /><span className="lbl">씬 목록</span></Link>
        <div className="crumb">
          <h1 className="crumb-title">두 씬 비교</h1>
          <span className="crumb-sub">{sceneA.scene?.name ?? '…'}와 {sceneB.scene?.name ?? '…'}를 각자의 타임라인으로 확인해요</span>
        </div>
        <div className="topbar-end">
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => void copyLink()}><Link2 className="icon" aria-hidden="true" /><span className="lbl">링크 복사</span></button>
          <button type="button" className="btn btn--ghost btn--sm btn--icon collapse-toggle" onClick={() => setCollapsed(!collapsed)} aria-pressed={collapsed} aria-label={collapsed ? '오른쪽 패널 펼치기' : '오른쪽 패널 접기'}>
            {collapsed ? <PanelRightOpen className="icon" aria-hidden="true" /> : <PanelRightClose className="icon" aria-hidden="true" />}
          </button>
        </div>
      </header>
      <main className={cn('ws', collapsed && 'is-collapsed')}>
        <section className="viewer" aria-label="두 씬 센서 보기">
          <div className="vbar">
            <label className="switch">
              <input type="checkbox" checked={sync} onChange={(e) => setSync(e.currentTarget.checked)} />
              <span className="switch-ui" />
              <span>상대 위치 동기화</span>
            </label>
            <span className="vbar-note">켜면 다른 씬을 각자 시간 범위의 같은 비율 위치로 맞춰요. 같은 촬영 시각이라는 뜻은 아니에요.</span>
            <div className="vbar-end">
              <button type="button" className="btn btn--ghost btn--sm" onClick={resetRatio}><RotateCcw className="icon" aria-hidden="true" /><span className="lbl">기본 배치</span></button>
            </div>
          </div>
          <div className="vbody">
            <div className="split split--compare" style={{ ['--ratio' as string]: ratio }}>
              <div className="split-pane split-pane--a">
                <ComparePane side="A" scene={sceneA.scene} scenes={sceneA.scenes} frames={framesA} pred={predA} active={active === 'A'} />
              </div>
              <Divider ratio={ratio} onChange={setRatio} onReset={resetRatio} label="씬 A와 씬 B 영역 비율" />
              <div className="split-pane split-pane--b">
                <ComparePane side="B" scene={sceneB.scene} scenes={sceneB.scenes} frames={framesB} pred={predB} active={active === 'B'} />
              </div>
            </div>
          </div>
        </section>
        <aside className="inspector" aria-label="작업 대상 씬의 자동 라벨링과 객체 정보">
          <section className="insp-sec">
            <div className="ts-row target-switch">
              <span className="ts-label" id="ts-l">작업 대상 씬</span>
              <div className="seg seg--full" role="radiogroup" aria-labelledby="ts-l">
                {(['A', 'B'] as const).map((p) => (
                  <button key={p} type="button" role="radio" aria-checked={active === p} onClick={() => setActivePane(p)}>
                    <span className={`pane-dot pane-dot--${p}`}>{p}</span>
                    <span className="mono">{(p === 'A' ? sceneA.scene : sceneB.scene)?.name ?? '…'}</span>
                  </button>
                ))}
              </div>
              <p className="help">아래 실행, 상태, 객체 정보는 선택한 씬에만 적용돼요.</p>
            </div>
          </section>
          {activeScene && (
            <>
              <JobPanel key={active} paneId={active} scene={activeScene} samples={activeFrames.samples} paneLabel={active} />
              <ObjectInspector key={`obj-${active}`} paneId={active} bundle={activeFrames.displayed} frameNumber={activeFrames.displayedIndex + 1} pred={activePred} />
            </>
          )}
        </aside>
      </main>
    </div>
  );
}

/**
 * FR-16: when sync is on, a user/playback/viewer change in one pane moves the other pane to the same relative
 * position of its own time span. Sync-originated changes are not propagated back.
 */
function useRelativeSync(samplesA: SampleRef[], samplesB: SampleRef[]) {
  const sync = useWorkspace((s) => s.sync);
  const seqA = useWorkspace((s) => s.panes.A.changeSeq);
  const seqB = useWorkspace((s) => s.panes.B.changeSeq);
  useEffect(() => {
    if (!sync) return;
    const st = useWorkspace.getState();
    const a = st.panes.A;
    if (a.lastOrigin === 'sync' || a.lastOrigin === 'init') return;
    const i = samplesA.findIndex((s) => s.token === a.requestedSampleToken);
    const j = mapRelative(samplesA, i, samplesB);
    const target = samplesB[j];
    if (i >= 0 && target) st.requestSample('B', target.token, 'sync');
  }, [sync, seqA, samplesA, samplesB]);
  useEffect(() => {
    if (!sync) return;
    const st = useWorkspace.getState();
    const b = st.panes.B;
    if (b.lastOrigin === 'sync' || b.lastOrigin === 'init') return;
    const i = samplesB.findIndex((s) => s.token === b.requestedSampleToken);
    const j = mapRelative(samplesB, i, samplesA);
    const target = samplesA[j];
    if (i >= 0 && target) st.requestSample('A', target.token, 'sync');
  }, [sync, seqB, samplesA, samplesB]);
}

interface PaneProps {
  side: CompareSide;
  scene: Scene | undefined;
  scenes: Scene[] | undefined;
  frames: PaneFrames;
  pred: PredState;
  active: boolean;
}

function ComparePane({ side, scene, scenes, frames, pred, active }: PaneProps) {
  const pane = useWorkspace((s) => s.panes[side]);
  const setActivePane = useWorkspace((s) => s.setActivePane);
  const setPaneView = useWorkspace((s) => s.setPaneView);
  const openScene = useWorkspace((s) => s.openScene);
  const setPlaying = useWorkspace((s) => s.setPlaying);
  const cams = useCameraBody(side, { frames, pred });
  const href = pane.datasetId != null && pane.sceneId != null
    ? workspaceUrl({ datasetId: pane.datasetId, sceneId: pane.sceneId, sample: pane.displayedSampleToken, job: pane.jobId, view: 'split' })
    : null;
  return (
    <section className={cn('pane', `pane--${side}`, active && 'is-active')} aria-label={`씬 ${side}`} data-pane={side}
      onPointerDownCapture={() => { if (!active) setActivePane(side); }}>
      <div className="pane-head">
        <button type="button" className="pane-badge" aria-pressed={active} onClick={() => setActivePane(side)} aria-label={`씬 ${side}를 작업 대상으로 선택`} title="작업 대상으로 선택">{side}</button>
        <DataOriginBadge datasetId={pane.datasetId} />
        <label className="sr-only" htmlFor={`pane-sel-${side}`}>씬 {side} 선택</label>
        <select id={`pane-sel-${side}`} className="select select--sm" value={pane.sceneId ?? ''}
          onChange={(e) => { setPlaying(side, false); openScene(side, { datasetId: pane.datasetId!, sceneId: Number(e.currentTarget.value), sampleToken: null, jobId: null }); }}>
          {!scenes && scene && <option value={scene.id}>{scene.name}</option>}
          {scenes?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <div className="seg seg--sm" role="group" aria-label={`씬 ${side} 표시 방식`}>
          <button type="button" aria-pressed={pane.paneView === 'cams'} onClick={() => setPaneView(side, 'cams')}>카메라</button>
          <button type="button" aria-pressed={pane.paneView === 'lidar'} onClick={() => setPaneView(side, 'lidar')}>3D</button>
        </div>
        {href && <a className="btn btn--ghost btn--sm btn--icon" href={href} target="_blank" rel="noopener" aria-label={`씬 ${side} 작업대를 새 탭에서 열기`} title="작업대 새 탭"><ExternalLink className="icon" aria-hidden="true" /></a>}
        <LayerToggles paneId={side} pred={pred} />
      </div>
      <div className="pane-body">
        {pane.paneView === 'lidar' && scene ? <div className="lidar"><RecordingPanel paneId={side} scene={scene} enabled={active} /></div> : cams}
      </div>
      <div className="pane-tl">
        <FrameTimeline paneId={side} samples={frames.samples} requestedIndex={frames.requestedIndex} displayedIndex={frames.displayedIndex} buffering={frames.buffering} prefix={`씬 ${side} `} />
      </div>
    </section>
  );
}
