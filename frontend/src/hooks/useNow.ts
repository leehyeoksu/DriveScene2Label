import { useEffect, useState } from 'react';

/** Current time, re-rendered every `intervalMs` while non-null. */
export function useNow(intervalMs: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (intervalMs == null) {
      setNow(Date.now());
      return;
    }
    const t = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}
