import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

export function MetricCard({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: string; icon?: ReactNode }) {
  return (
    <motion.div className="card p-5" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <div className="mt-2 text-2xl font-semibold text-slate-950">{value}</div>
          {hint ? <p className="mt-2 text-sm text-slate-500">{hint}</p> : null}
        </div>
        {icon ? <div className="rounded-lg bg-slate-100 p-2 text-slate-600">{icon}</div> : null}
      </div>
    </motion.div>
  );
}
