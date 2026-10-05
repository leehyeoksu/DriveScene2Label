import { useToasts } from '@/stores/toast';

export function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => <div key={t.id} className={`toast toast--${t.kind}`}>{t.message}</div>)}
    </div>
  );
}
