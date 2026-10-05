import { FlaskConical, HelpCircle, ShieldCheck } from 'lucide-react';
import { ORIGIN_LABEL } from '@/api/system';
import { useSystemStatus } from './useSystemStatus';

/** Always-visible data origin. SYNTHETIC/UNKNOWN never count as real-data verification. */
export function DataOriginBadge({ datasetId }: { datasetId: number | null }) {
  const { status, error } = useSystemStatus(datasetId);
  if (datasetId == null) return null;
  if (error) return <span className="origin-badge origin-badge--unknown" title="준비 상태 API에 연결하지 못했어요"><HelpCircle className="icon" aria-hidden="true" />출처 확인 불가</span>;
  if (!status) return null;
  if (!status.supported) return <span className="origin-badge origin-badge--unknown" title="이 서버는 데이터 출처 정보를 제공하지 않아요"><HelpCircle className="icon" aria-hidden="true" />출처 정보 없음</span>;
  const origin = status.dataset?.origin ?? 'UNKNOWN';
  const Icon = origin === 'SYNTHETIC' ? FlaskConical : origin === 'NUSCENES' ? ShieldCheck : HelpCircle;
  const title = origin === 'SYNTHETIC'
    ? '합성 테스트 데이터예요. 실제 주행 원본이 아니며 실제 VESPA 실행은 막혀 있어요.'
    : origin === 'NUSCENES'
      ? `import 설정으로 기록된 nuScenes 원본이에요. 원본 파일 검증: ${status.dataset?.mediaValidation ?? '-'}`
      : '데이터 출처가 기록되지 않았어요. 실제 데이터 검증 결과로 보지 않아요.';
  return (
    <span className={`origin-badge origin-badge--${origin.toLowerCase()}`} title={title} data-testid="origin-badge" data-origin={origin}>
      <Icon className="icon" aria-hidden="true" />{ORIGIN_LABEL[origin]}
    </span>
  );
}
