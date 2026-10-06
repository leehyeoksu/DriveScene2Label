import { QueryClient } from '@tanstack/react-query';
import { isApiError } from '@/api/http';

/**
 * GETs retry only on connection loss / 502–504, at most twice. 4xx answers are final.
 * Mutations never retry automatically here (job creation has its own same-key retry).
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (count, err) => isApiError(err) && err.transient && count < 2,
        retryDelay: (n) => Math.min(4000, 600 * 2 ** n),
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });
}
