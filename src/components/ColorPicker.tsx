import { ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

const presetColors = [
  '#2563eb',
  '#16a34a',
  '#f97316',
  '#ef4444',
  '#8b5cf6',
  '#06b6d4',
  '#eab308',
  '#ec4899',
  '#14b8a6',
  '#6366f1',
  '#84cc16',
  '#f43f5e',
  '#0ea5e9',
  '#a855f7',
  '#22c55e',
  '#f59e0b',
  '#64748b',
  '#78350f',
  '#111827',
  '#7f1d1d',
];

export function ColorPicker({ value, onChange }: { value?: string; onChange: (color: string) => void }) {
  const selected = value || presetColors[0];
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button type="button" className="field flex h-11 items-center justify-between gap-3" onClick={() => setOpen((current) => !current)}>
        <span className="flex items-center gap-2 text-sm text-slate-700">
          <span className="h-4 w-4 rounded-full ring-1 ring-slate-200" style={{ background: selected }} />
          选择颜色
        </span>
        <ChevronDown size={16} className={`text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <div className="absolute left-0 top-12 z-40 w-64 rounded-lg border border-slate-200 bg-white p-3 shadow-xl">
          <div className="grid grid-cols-5 gap-2">
            {presetColors.map((color) => (
              <button
                key={color}
                type="button"
                className={`h-8 w-8 rounded-full border transition hover:scale-105 ${selected === color ? 'border-slate-950 ring-2 ring-slate-300' : 'border-white ring-1 ring-slate-200'}`}
                style={{ background: color }}
                title={color}
                aria-label={`选择颜色 ${color}`}
                onClick={() => {
                  onChange(color);
                  setOpen(false);
                }}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
