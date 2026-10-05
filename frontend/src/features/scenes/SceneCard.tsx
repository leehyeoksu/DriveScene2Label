import { useQuery } from '@tanstack/react-query';
import { ExternalLink, GitCompare } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { getJson, qs } from '@/api/http';
import type { SampleDetailDto, SampleDto } from '@/api/dto';
import { workspaceUrl } from '@/app/urls';

interface Props {
  datasetId: number;
  sceneId: number;
  name: string;
  description: string;
  nbrSamples?: number;
  /** Search hit: representative image + frame. Absent for the plain scene list. */
  hit?: { score: number; contentUrl: string; bestSampleToken: string; matchedImages: number };
  selectedForCompare: boolean;
  onToggleCompare: () => void;
}

/** First frame's CAM_FRONT for list cards, fetched only once the card is on screen. */
function useFirstFrameImage(sceneId: number, visible: boolean) {
  return useQuery({
    queryKey: ['sceneThumb', sceneId],
    enabled: visible,
    staleTime: Infinity,
    queryFn: async ({ signal }) => {
      const first = await getJson<SampleDto[]>(`/api/scenes/${sceneId}/samples${qs({ limit: 1, offset: 0 })}`, signal);
      if (!first[0]) return null;
      const detail = await getJson<SampleDetailDto>(`/api/samples/${first[0].id}${qs({ keyframesOnly: true })}`, signal);
      const cam = detail.sensorFiles.find((f) => f.channel === 'CAM_FRONT') ?? detail.sensorFiles.find((f) => f.modality === 'camera');
      return cam?.contentUrl ?? null;
    },
  });
}

export function SceneCard({ datasetId, sceneId, name, description, nbrSamples, hit, selectedForCompare, onToggleCompare }: Props) {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || hit) return;
    if (typeof IntersectionObserver === 'undefined') return setVisible(true);
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { setVisible(true); io.disconnect(); } }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hit]);
  const thumb = useFirstFrameImage(sceneId, visible && !hit);
  const imgUrl = hit ? hit.contentUrl : thumb.data;
  const href = workspaceUrl({ datasetId, sceneId, sample: hit?.bestSampleToken ?? null, view: 'split' });

  return (
    <article className="scene-card" ref={ref} data-scene-id={sceneId}>
      <Link className="scene-open" to={href} aria-label={`${name} 열기. ${description}`}>
        <span className="thumb">
          {imgUrl ? <img src={imgUrl} alt="" loading="lazy" /> : (
            <span className={!hit && (thumb.isPending || !visible) ? 'thumb-empty skel' : 'thumb-empty'}>
              {thumb.isError ? '대표 이미지를 불러오지 못했어요' : thumb.data === null ? '카메라 이미지 없음' : ''}
            </span>
          )}
          {imgUrl && <span className="thumb-tag">{hit ? '검색 대표 이미지 · CAM' : '첫 프레임 · 전방'}</span>}
        </span>
        <span className="card-body">
          <span className="card-top">
            <span className="card-name">{name}</span>
            {hit && (
              <span className="sim" title="텍스트와 이미지 임베딩의 유사도 점수예요. 확률이나 정확도가 아니에요.">
                유사도 점수<span className="sim-val">{hit.score.toFixed(3)}</span>
              </span>
            )}
          </span>
          <span className="card-desc">{description || '설명 없음'}</span>
          <span className="card-meta">
            {nbrSamples != null && <span>{nbrSamples} 프레임</span>}
            {hit && <span>대표 프레임으로 열기</span>}
          </span>
        </span>
      </Link>
      <div className="card-actions">
        <button type="button" className="btn" aria-pressed={selectedForCompare} onClick={onToggleCompare} aria-label={`${name} ${selectedForCompare ? '비교에서 빼기' : '비교에 담기'}`} title={selectedForCompare ? '비교에서 빼기' : '비교에 담기'}>
          <GitCompare className="icon" aria-hidden="true" />
        </button>
        <a className="btn" href={href} target="_blank" rel="noopener" aria-label={`${name} 새 탭에서 열기`} title="새 탭에서 열기">
          <ExternalLink className="icon" aria-hidden="true" />
        </a>
      </div>
    </article>
  );
}
