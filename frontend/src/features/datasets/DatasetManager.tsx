import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getJson, requestJson, toApiError } from '@/api/http';
interface Job {
 id: string; datasetId: number | null; name: string; version: string; origin: string;
 status: string; stage: string; uploadedFiles: number; totalImages: number; completedImages: number; errorMessage: string | null;
}
interface Coverage { totalImages: number; completedImages: number }
const labels: Record<string, string> = { UPLOADING: '파일 저장 중', QUEUED: '대기 중', IMPORTING: 'DB 등록 중', EMBEDDING: '검색용 임베딩 생성 중', COMPLETED: '검색 준비 완료', FAILED: '처리 실패' };
const folderProps = { webkitdirectory: '', directory: '' } as InputHTMLAttributes<HTMLInputElement>;
export function DatasetManager({ datasetId, onOpen }: { datasetId: number | null; onOpen: (id: number) => void }) {
 const qc = useQueryClient();
 const [files, setFiles] = useState<File[]>([]);
 const [name, setName] = useState('');
 const [version, setVersion] = useState('v1.0-mini');
 const [origin, setOrigin] = useState('UNKNOWN');
 const [busy, setBusy] = useState(false);
 const [actionBusy, setActionBusy] = useState(false);
 const [sent, setSent] = useState(0);
 const [error, setError] = useState('');
 const session = useRef<string | null>(null);
 const jobs = useQuery({ queryKey: ['dataset-ingestions'], queryFn: ({ signal }) => getJson<Job[]>('/api/dataset-ingestions', signal), refetchInterval: 3000 });
 const coverage = useQuery({ queryKey: ['dataset-index', datasetId], queryFn: () => getJson<Coverage>('/api/datasets/' + datasetId + '/index'), enabled: datasetId != null, refetchInterval: 5000 });
 const active = jobs.data?.some(j => j.datasetId === datasetId && ['QUEUED', 'RUNNING'].includes(j.status));
 const previous = useRef('');
 useEffect(() => {
  const signature = jobs.data?.map(j => j.id + ':' + j.status + ':' + j.datasetId).join('|') ?? '';
  if (signature && signature !== previous.current) {
   previous.current = signature;
   for (const key of ['datasets', 'systemStatus', 'dataset-index', 'sceneSearch']) void qc.invalidateQueries({ queryKey: [key] });
  }
 }, [jobs.data, qc]);
 useEffect(() => {
  if (!busy) return;
  const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
  window.addEventListener('beforeunload', warn);
  return () => window.removeEventListener('beforeunload', warn);
 }, [busy]);
 const refresh = () => { void jobs.refetch(); if (datasetId != null) void coverage.refetch(); };
 const action = async (url: string) => {
  setActionBusy(true); setError('');
  try { await requestJson(url, { method: 'POST' }); refresh(); }
  catch (e) { setError(e instanceof Error ? e.message : '요청에 실패했어요'); }
  finally { setActionBusy(false); }
 };
 const upload = async () => {
  setError(''); setBusy(true); setSent(0);
  try {
   const relative = (f: File) => f.webkitRelativePath.slice(f.webkitRelativePath.indexOf('/') + 1);
   if (!files.some(f => relative(f) === version + '/scene.json')) throw new Error('samples, sweeps, maps, ' + version + ' 폴더가 들어 있는 상위 폴더를 선택해 주세요.');
   if (!session.current) session.current = (await requestJson<Job>('/api/dataset-ingestions', { method: 'POST', body: { name, version, origin } })).data.id;
   const id = session.current;
   const saved = await getJson<Job[]>('/api/dataset-ingestions');
   if (saved.some(j => j.id === id && j.status !== 'UPLOADING')) {
    session.current = null; setFiles([]); refresh(); return;
   }
   let cursor = 0, failed: unknown = null;
   const workers = Array.from({ length: 4 }, async () => {
    while (!failed) {
     const file = files[cursor++];
     if (!file) return;
     try {
      const body = new FormData(); body.append('path', relative(file)); body.append('file', file);
      const path = '/api/dataset-ingestions/' + id + '/files';
      const response = await fetch(path, { method: 'POST', body });
      if (!response.ok) throw await toApiError(response, path);
      setSent(n => n + 1);
     } catch (e) { failed = e; }
    }
   });
   await Promise.all(workers);
   if (failed) throw failed;
   await requestJson('/api/dataset-ingestions/' + id + '/complete', { method: 'POST', body: { fileCount: files.length } });
   session.current = null; setFiles([]); setSent(0); refresh();
  } catch (e) { setError(e instanceof Error ? e.message : '업로드에 실패했어요. 다시 시작하면 같은 작업에 저장해요.'); }
  finally { setBusy(false); }
 };
 return <details className="dataset-manager">
  <summary>데이터 업로드 · 검색 준비 {coverage.data && <span>이미지 {coverage.data.completedImages.toLocaleString()} / {coverage.data.totalImages.toLocaleString()}개 준비</span>}</summary>
  <div className="dataset-manager__body">
   <p>nuScenes 원본 폴더를 선택하면 파일 저장 → DB 등록 → 카메라 키프레임 임베딩을 자동으로 진행해요. JPG·영상만으로는 씬을 구성할 수 없어 메타데이터와 LiDAR가 함께 필요해요.</p>
   <div className="dataset-manager__form">
    <label>이름<input value={name} maxLength={80} disabled={busy || session.current != null} onChange={e => setName(e.target.value)} placeholder="내 주행 데이터" /></label>
    <label>버전<select value={version} disabled={busy || session.current != null} onChange={e => setVersion(e.target.value)}><option>v1.0-mini</option><option>v1.0-trainval</option></select></label>
    <label>출처<select value={origin} disabled={busy || session.current != null} onChange={e => setOrigin(e.target.value)}><option value="UNKNOWN">확인하지 않음</option><option value="NUSCENES">nuScenes 공식 데이터</option><option value="SYNTHETIC">테스트 데이터</option></select></label>
    <label>원본 폴더<input type="file" {...folderProps} multiple disabled={busy} onChange={e => { const selected = Array.from(e.target.files ?? []).filter(f => !f.webkitRelativePath.split('/').some(p => p.startsWith('.')) && !f.name.endsWith('Zone.Identifier')); setFiles(selected); session.current = null; setError(''); if (!name) setName(selected[0]?.webkitRelativePath.split('/')[0] ?? ''); }} /></label>
   </div>
   <p className="dim">폴더 구성: samples/ · sweeps/ · maps/ · {version}/. 업로드 중에는 이 화면을 열어 두세요. 폴더 전송 후에는 창을 닫아도 서버 처리가 계속돼요.</p>
   <div className="dataset-manager__actions">
    <button className="btn btn--primary" disabled={busy || !files.length || !name.trim()} onClick={() => void upload()}>{busy ? '파일 저장 ' + sent + '/' + files.length : session.current ? '업로드 다시 시도' : '업로드하고 검색 준비'}</button>
    {datasetId != null && <button className="btn btn--weak" disabled={actionBusy || active || !coverage.data || coverage.data.totalImages === 0 || coverage.data.completedImages === coverage.data.totalImages} onClick={() => void action('/api/datasets/' + datasetId + '/index')}>{active ? '현재 데이터셋 준비 중' : '현재 데이터셋 임베딩 생성'}</button>}
   </div>
   {busy && <progress max={files.length} value={sent} aria-label="파일 저장 진행률" />}
   {error && <p role="alert">{error}</p>}
   {jobs.isError && <p role="alert">작업 상태를 불러오지 못했어요. 서버 연결을 확인해 주세요.</p>}
   <ul className="dataset-manager__jobs">
    {jobs.data?.slice(0, 8).map(j => <li key={j.id}>
     <strong>{j.name}</strong><span>{labels[j.status === 'RUNNING' ? j.stage : j.status] ?? j.status}</span>
     {j.stage === 'EMBEDDING' || j.status === 'COMPLETED' ? <span>{j.completedImages} / {j.totalImages}개 이미지</span> : <span>{j.uploadedFiles}개 파일 저장</span>}
     {j.stage === 'EMBEDDING' && j.totalImages > 0 && <progress max={j.totalImages} value={j.completedImages} aria-label={j.name + ' 임베딩 진행률'} />}
     {j.errorMessage && <span role="alert">{j.errorMessage}</span>}
     {j.status === 'FAILED' && <button className="btn btn--sm btn--weak" disabled={actionBusy} onClick={() => void action('/api/dataset-ingestions/' + j.id + '/retry')}>이어서 처리</button>}
     {j.datasetId != null && <button className="btn btn--sm btn--ghost" onClick={() => onOpen(j.datasetId!)}>데이터셋 열기</button>}
    </li>)}
   </ul>
  </div>
 </details>;
}
