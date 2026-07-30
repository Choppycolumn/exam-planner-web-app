import type { ReactNode } from 'react';

export function MetricCard({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: string; icon?: ReactNode }) {
  return (
    <div className="card metric-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="metric-card-label">{label}</p>
          <div className="metric-card-value">{value}</div>
          {hint ? <p className="metric-card-hint">{hint}</p> : null}
        </div>
        {icon ? <div className="metric-card-icon" aria-hidden="true">{icon}</div> : null}
      </div>
    </div>
  );
}
