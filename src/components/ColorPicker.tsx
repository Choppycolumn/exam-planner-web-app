const presetColors = [
  '#2563eb',
  '#16a34a',
  '#f97316',
  '#9333ea',
  '#dc2626',
  '#0f766e',
  '#ca8a04',
  '#64748b',
  '#0891b2',
  '#be185d',
  '#4f46e5',
  '#059669',
  '#ea580c',
  '#7c3aed',
  '#b91c1c',
  '#0d9488',
  '#a16207',
  '#475569',
  '#0284c7',
  '#c026d3',
];

export function ColorPicker({ value, onChange }: { value?: string; onChange: (color: string) => void }) {
  const selected = value || presetColors[0];

  return (
    <div className="grid grid-cols-10 gap-2">
      {presetColors.map((color) => (
        <button
          key={color}
          type="button"
          className={`h-7 w-7 rounded-full border transition hover:scale-105 ${selected === color ? 'border-slate-950 ring-2 ring-slate-300' : 'border-white ring-1 ring-slate-200'}`}
          style={{ background: color }}
          title={color}
          aria-label={`选择颜色 ${color}`}
          onClick={() => onChange(color)}
        />
      ))}
    </div>
  );
}
