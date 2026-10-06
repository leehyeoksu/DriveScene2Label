import { AlertTriangle, SearchX } from 'lucide-react';
import type { ReactNode } from 'react';

export function StateBox({ kind = 'info', title, children, actions }: { kind?: 'info' | 'error' | 'empty'; title: string; children?: ReactNode; actions?: ReactNode }) {
  const Icon = kind === 'error' ? AlertTriangle : SearchX;
  return (
    <div className={kind === 'error' ? 'state-box state-box--error' : 'state-box'} role={kind === 'error' ? 'alert' : undefined}>
      <Icon className="icon" aria-hidden="true" />
      <div>
        <b>{title}</b>
        {children && <p>{children}</p>}
        {actions && <div className="state-actions">{actions}</div>}
      </div>
    </div>
  );
}
