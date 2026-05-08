import { useRef, useState } from 'react';
import { Droplets } from 'lucide-react';
import { notifyDataChanged, serverApi } from '../api/client';
import type { WaterIntakeRecord } from '../types/models';
import { todayISO } from '../utils/date';

const cupMl = 500;
const targetCups = 6;
const holdMs = 3000;

function tone(cups: number) {
  if (cups <= 0) return { className: 'border-rose-200 bg-rose-50 text-rose-800', label: '还没喝水' };
  if (cups < targetCups) return { className: 'border-amber-200 bg-amber-50 text-amber-800', label: '继续补水' };
  return { className: 'border-emerald-200 bg-emerald-50 text-emerald-800', label: '今日达标' };
}

export function WaterIntakeCard({ record, readOnly = false }: { record?: WaterIntakeRecord; readOnly?: boolean }) {
  const [cups, setCups] = useState(record?.cups ?? 0);
  const [holding, setHolding] = useState(false);
  const [progress, setProgress] = useState(0);
  const startedAt = useRef(0);
  const frameId = useRef<number | null>(null);
  const timeoutId = useRef<number | null>(null);
  const today = todayISO();
  const currentCups = record?.cups ?? cups;
  const style = tone(currentCups);
  const percent = Math.min(100, Math.round((currentCups / targetCups) * 100));

  const clearTimers = () => {
    if (frameId.current) window.cancelAnimationFrame(frameId.current);
    if (timeoutId.current) window.clearTimeout(timeoutId.current);
    frameId.current = null;
    timeoutId.current = null;
  };

  const saveCups = async (nextCups: number) => {
    setCups(nextCups);
    await serverApi.saveWaterIntake({ date: today, cups: nextCups, cupMl, targetCups });
    notifyDataChanged();
  };

  const startHold = () => {
    if (readOnly || currentCups >= targetCups || holding) return;
    setHolding(true);
    setProgress(0);
    startedAt.current = Date.now();

    const tick = () => {
      const next = Math.min(100, ((Date.now() - startedAt.current) / holdMs) * 100);
      setProgress(next);
      if (next < 100) frameId.current = window.requestAnimationFrame(tick);
    };
    frameId.current = window.requestAnimationFrame(tick);
    timeoutId.current = window.setTimeout(() => {
      clearTimers();
      setHolding(false);
      setProgress(0);
      void saveCups(Math.min(targetCups, currentCups + 1));
    }, holdMs);
  };

  const cancelHold = () => {
    if (!holding) return;
    clearTimers();
    setHolding(false);
    setProgress(0);
  };

  const reset = async () => {
    if (readOnly) return;
    if (!confirm('确定把今天的喝水记录清零吗？')) return;
    await saveCups(0);
  };

  return (
    <section
      className={`card relative block h-full cursor-pointer overflow-hidden border p-5 text-left select-none ${style.className}`}
      onMouseDown={startHold}
      onMouseUp={cancelHold}
      onMouseLeave={cancelHold}
      onTouchStart={startHold}
      onTouchEnd={cancelHold}
    >
      <span className="absolute inset-y-0 left-0 bg-current opacity-10 transition-all" style={{ width: `${progress}%` }} />
      <div className="relative">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold"><Droplets size={17} />喝水</p>
          <h2 className="mt-2 text-2xl font-semibold">{currentCups}/{targetCups} 杯</h2>
          <p className="mt-1 text-sm opacity-80">{targetCups * cupMl}ml · {style.label}</p>
        </div>
        {!readOnly ? <button className="rounded-lg bg-white/70 px-2 py-1 text-xs font-semibold" onMouseDown={(event) => event.stopPropagation()} onTouchStart={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); void reset(); }}>清零</button> : null}
      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/70">
        <div className="h-full rounded-full bg-current transition-all" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-3 text-xs font-medium opacity-75">{readOnly ? '只读模式不可记录' : currentCups >= targetCups ? '今天喝够了' : holding ? '继续按住...' : '长按卡片任意位置 3 秒记一杯'}</p>
      </div>
    </section>
  );
}
