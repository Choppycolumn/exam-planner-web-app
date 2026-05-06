import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

export function Page({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.22 }}>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
        </div>
      </div>
      {children}
    </motion.section>
  );
}
