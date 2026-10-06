import { useQuery } from '@tanstack/react-query';
import type { Scene } from '@/api/models';
import { scenesQuery } from '@/api/queries';

/**
 * There is no single-scene endpoint: the scene is looked up by numeric id in its dataset's scene list.
 * `notFound` means the list loaded but did not contain the id (stale/foreign link).
 */
export function useScene(datasetId: number | null, sceneId: number | null) {
  const q = useQuery({ ...scenesQuery(datasetId ?? -1), enabled: datasetId != null });
  const scene: Scene | undefined = q.data?.find((s) => s.id === sceneId);
  return { scene, scenes: q.data, isPending: q.isPending && datasetId != null, error: q.error, notFound: !!q.data && !scene, refetch: q.refetch };
}
