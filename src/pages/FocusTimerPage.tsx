import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlarmClock,
  BookOpen,
  Check,
  CirclePause,
  Coffee,
  Flag,
  MoonStar,
  Play,
  RotateCcw,
  Settings2,
  Square,
  TimerReset,
  Utensils,
  WifiOff,
} from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { Page } from '../components/Page';
import { Toast } from '../components/Toast';
import { createFocusTimerId } from '../features/focus-timer/offlineQueue';
import { useAccountSession } from '../hooks/useAccountSession';
import { useDashboardData } from '../hooks/useDashboardData';
import { useFocusTimer } from '../hooks/useFocusTimer';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useStudyTimeData } from '../hooks/useStudyTimeData';
import { todayISO } from '../utils/date';

function formatClock(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = safe % 60;
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function formatStudyTime(seconds: number) {
  const minutes = Math.round(Math.max(0, seconds) / 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} 分钟`;
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
}

function currentStateTime(startedAt: string | null, targetSeconds: number, now: number) {
  const started = startedAt ? Date.parse(startedAt) : now;
  const elapsed = Math.max(0, Math.floor((now - started) / 1000));
  return {
    elapsed,
    remaining: targetSeconds > 0 ? Math.max(0, targetSeconds - elapsed) : 0,
    expired: targetSeconds > 0 && elapsed >= targetSeconds,
  };
}

let audioContext: AudioContext | null = null;

function primeAudio() {
  try {
    audioContext ??= new AudioContext();
    void audioContext.resume();
  } catch {
    // Visual alert remains available when audio is blocked by the browser.
  }
}

function playBreakAlert() {
  try {
    primeAudio();
    if (!audioContext) return;
    const startedAt = audioContext.currentTime;
    [0, 0.32, 0.64].forEach((delay, index) => {
      const oscillator = audioContext!.createOscillator();
      const gain = audioContext!.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = index === 1 ? 740 : 880;
      gain.gain.setValueAtTime(0.0001, startedAt + delay);
      gain.gain.exponentialRampToValueAtTime(0.18, startedAt + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, startedAt + delay + 0.24);
      oscillator.connect(gain);
      gain.connect(audioContext!.destination);
      oscillator.start(startedAt + delay);
      oscillator.stop(startedAt + delay + 0.25);
    });
  } catch {
    // Visual alert remains the primary signal.
  }
}

export function FocusTimerPage() {
  const { data: session } = useAccountSession();
  const { online } = useNetworkStatus();
  const { studyTargetMinutes } = useDashboardData();
  const { activeProjects, readOnly: projectsReadOnly } = useStudyTimeData(todayISO());
  const userId = session?.userId || 0;
  const timer = useFocusTimer(userId, online);
  const dispatchTimerAction = timer.dispatch;
  const dashboard = timer.dashboard;
  const [now, setNow] = useState(() => Date.now());
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [focusMinutes, setFocusMinutes] = useState(50);
  const [breakMinutes, setBreakMinutes] = useState(10);
  const [note, setNote] = useState('');
  const [toast, setToast] = useState('');
  const autoCompletedSession = useRef('');
  const alertedBreak = useRef('');

  const state = dashboard?.state;
  const timing = currentStateTime(state?.startedAt ?? null, state?.targetSeconds ?? 0, now);
  const activeSegment = state?.segments.find((segment) => !segment.endedAt);
  const effectiveProjectId = activeProjects.some((project) => project.id === selectedProjectId)
    ? selectedProjectId
    : activeProjects[0]?.id ?? null;
  const selectedProject = activeProjects.find((project) => project.id === effectiveProjectId);
  const targetSeconds = Math.max(1, studyTargetMinutes * 60);
  const todayStudySeconds = dashboard?.summary.studySeconds ?? 0;
  const progress = studyTargetMinutes > 0 ? Math.min(100, (todayStudySeconds / targetSeconds) * 100) : 0;
  const locked = Boolean(session?.role === 'read' || projectsReadOnly || dashboard?.summary.dayEnded);

  const status = useMemo(() => {
    if (!state || state.mode === 'idle') return { label: '准备开始', detail: '选择一门课程，开始一段不被打断的学习。' };
    if (state.mode === 'focus') return { label: '正在专注', detail: state.projectName };
    if (state.mode === 'break') return { label: timing.expired ? '休息已结束' : '课间休息', detail: '放松一下，到点后回来继续。' };
    return { label: state.pauseLabel || '暂停', detail: '用餐暂停不设倒计时，也不会计入学习时长。' };
  }, [state, timing.expired]);
  const blockingOverlayOpen = settingsOpen || Boolean(state?.mode === 'break' && timing.expired);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!blockingOverlayOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [blockingOverlayOpen]);

  useEffect(() => {
    if (state?.mode !== 'focus' || !state.sessionId || !timing.expired) return;
    if (autoCompletedSession.current === state.sessionId) return;
    autoCompletedSession.current = state.sessionId;
    const deadline = new Date(Date.parse(state.startedAt!) + state.targetSeconds * 1000).toISOString();
    void dispatchTimerAction({
      action: 'complete_focus',
      sessionId: state.sessionId,
      occurredAt: deadline,
      note: '达到设定专注时长后自动结束',
    });
  }, [dispatchTimerAction, state?.mode, state?.sessionId, state?.startedAt, state?.targetSeconds, timing.expired]);

  useEffect(() => {
    if (state?.mode !== 'break' || !state.sessionId || !timing.expired) return;
    if (alertedBreak.current === state.sessionId) return;
    alertedBreak.current = state.sessionId;
    playBreakAlert();
  }, [state?.mode, state?.sessionId, timing.expired]);

  const announce = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 1800);
  };

  const startFocus = async () => {
    if (!selectedProject?.id || locked) return;
    primeAudio();
    await dispatchTimerAction({
      action: 'start_focus',
      sessionId: createFocusTimerId('session'),
      projectId: selectedProject.id,
      projectName: selectedProject.name,
    });
    setNote('');
    announce(`已开始：${selectedProject.name}`);
  };

  const completeFocus = async () => {
    if (!state?.sessionId) return;
    await dispatchTimerAction({ action: 'complete_focus', sessionId: state.sessionId, note });
    setNote('');
    announce('本次学习已记入学习时间');
  };

  const startMeal = async (mealType: 'lunch' | 'dinner') => {
    if (state?.mode === 'focus' || locked) return;
    await dispatchTimerAction({
      action: 'start_meal',
      mealType,
      sessionId: createFocusTimerId('session'),
    });
    announce(mealType === 'dinner' ? '已进入晚饭暂停' : '已进入午饭暂停');
  };

  const saveSettings = async () => {
    await dispatchTimerAction({
      action: 'save_settings',
      focusMinutes: Math.max(5, Math.min(180, Math.round(focusMinutes))),
      breakMinutes: Math.max(1, Math.min(60, Math.round(breakMinutes))),
    });
    setSettingsOpen(false);
    announce('计时设置已保存');
  };

  const toggleSegment = async () => {
    if (activeSegment) {
      await dispatchTimerAction({ action: 'finish_segment' });
      announce('本段计时已结束');
    } else {
      await dispatchTimerAction({ action: 'start_segment', segmentId: createFocusTimerId('segment') });
      announce('已开始一段独立计时');
    }
  };

  if (!session || !userId) {
    return <Page title="专注计时" subtitle="正在读取账户..."><div className="card p-6 text-sm text-slate-500">加载中...</div></Page>;
  }

  if (!dashboard) {
    return (
      <Page title="专注计时" subtitle="属于当前账户的独立学习计时空间。">
        <EmptyState
          title={online ? '正在读取计时状态' : '首次使用需要先联网'}
          description={online ? '请稍候。' : '联网打开一次后，后续断网也能继续计时并自动补传。'}
        />
      </Page>
    );
  }

  return (
    <Page title="专注计时" subtitle="网页版专注钟。课程、设置和记录只属于当前账户，不接入通知通道。">
      <div className="focus-timer-page">
        <section className={`focus-hero focus-mode-${state!.mode}`}>
          <div className="focus-hero-top">
            <div>
              <span className="focus-status-dot" aria-hidden="true" />
              <span className="focus-status-label">{status.label}</span>
              <p className="focus-status-detail">{status.detail}</p>
            </div>
            <button
              className="focus-icon-button"
              type="button"
              onClick={() => {
                setFocusMinutes(dashboard.settings.focusMinutes);
                setBreakMinutes(dashboard.settings.breakMinutes);
                setSettingsOpen(true);
              }}
              aria-label="计时设置"
              title="计时设置"
            >
              <Settings2 size={18} />
            </button>
          </div>

          <div className="focus-clock-wrap">
            <p className="focus-clock">
              {state!.mode === 'focus'
                ? formatClock(timing.remaining)
                : state!.mode === 'break'
                  ? formatClock(timing.remaining)
                  : state!.mode === 'meal'
                    ? formatClock(timing.elapsed)
                    : formatClock(dashboard.settings.focusMinutes * 60)}
            </p>
            <p className="focus-clock-caption">
              {state!.mode === 'focus'
                ? `已专注 ${formatStudyTime(timing.elapsed)}`
                : state!.mode === 'break'
                  ? timing.expired ? `已超时 ${formatClock(timing.elapsed - state!.targetSeconds)}` : '休息结束后继续下一段'
                  : state!.mode === 'meal'
                    ? `${state!.pauseLabel}已持续 ${formatStudyTime(timing.elapsed)}`
                    : `专注 ${dashboard.settings.focusMinutes} 分钟 · 休息 ${dashboard.settings.breakMinutes} 分钟`}
            </p>
          </div>

          {state!.mode === 'idle' ? (
            <>
              <div className="focus-project-picker" role="listbox" aria-label="选择当前课程">
                {activeProjects.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    className={`focus-project-option ${effectiveProjectId === project.id ? 'is-selected' : ''}`}
                    onClick={() => setSelectedProjectId(project.id ?? null)}
                    disabled={locked}
                    role="option"
                    aria-selected={effectiveProjectId === project.id}
                  >
                    <span className="focus-project-color" style={{ background: project.color }} />
                    <span>{project.name}</span>
                    {effectiveProjectId === project.id ? <Check size={16} /> : null}
                  </button>
                ))}
              </div>
              <button className="focus-primary-action" type="button" onClick={() => void startFocus()} disabled={!selectedProject || locked}>
                <Play size={19} fill="currentColor" />开始专注
              </button>
              <div className="focus-secondary-actions">
                <button type="button" onClick={() => void startMeal('lunch')} disabled={locked}><Utensils size={17} />午饭</button>
                <button type="button" onClick={() => void startMeal('dinner')} disabled={locked}><MoonStar size={17} />晚饭</button>
              </div>
            </>
          ) : null}

          {state!.mode === 'focus' ? (
            <div className="focus-active-actions">
              <input className="field" value={note} maxLength={300} onChange={(event) => setNote(event.target.value)} placeholder="本次学习备注，可不填" />
              <div className="focus-action-grid">
                <button className="btn btn-primary" type="button" onClick={() => void completeFocus()}><Square size={17} fill="currentColor" />结束专注</button>
                <button className="btn btn-soft" type="button" onClick={() => void toggleSegment()}>
                  {activeSegment ? <CirclePause size={17} /> : <TimerReset size={17} />}
                  {activeSegment ? '结束本段' : '开始分段'}
                </button>
              </div>
              {state!.segments.length ? (
                <div className="focus-segments">
                  {state!.segments.map((segment) => {
                    const duration = segment.endedAt
                      ? segment.durationSeconds
                      : Math.max(0, Math.floor((now - Date.parse(segment.startedAt)) / 1000));
                    return <span key={segment.segmentId}>第 {segment.sequenceNumber} 段 · {formatClock(duration)}{segment.endedAt ? '' : ' · 进行中'}</span>;
                  })}
                </div>
              ) : null}
            </div>
          ) : null}

          {state!.mode === 'break' ? (
            <div className="focus-action-grid">
              <button className="btn btn-primary" type="button" onClick={() => void dispatchTimerAction({ action: 'finish_break' })}>
                <RotateCcw size={18} />结束休息
              </button>
              <button className="btn btn-soft" type="button" onClick={() => void startMeal('lunch')}><Coffee size={18} />转为午饭</button>
            </div>
          ) : null}

          {state!.mode === 'meal' ? (
            <button className="focus-primary-action" type="button" onClick={() => void dispatchTimerAction({ action: 'finish_meal' })}>
              <RotateCcw size={18} />结束{state!.pauseLabel}
            </button>
          ) : null}

          <div className="focus-sync-line">
            {online ? <Check size={15} /> : <WifiOff size={15} />}
            <span>{online ? (timer.pendingCount ? `正在补传 ${timer.pendingCount} 条记录` : '已与网站同步') : `离线计时中 · ${timer.pendingCount} 条待补传`}</span>
          </div>
          {timer.syncError ? <p className="focus-sync-error">{timer.syncError}</p> : null}
        </section>

        <section className="focus-summary card">
          <div className="focus-section-heading">
            <div><p className="focus-eyebrow">今日进度</p><h2>{formatStudyTime(todayStudySeconds)}</h2></div>
            <AlarmClock size={22} />
          </div>
          <div className="focus-progress-track" aria-label={`今日目标完成 ${Math.round(progress)}%`}>
            <span style={{ width: `${progress}%` }} />
          </div>
          <div className="focus-progress-meta">
            <span>{studyTargetMinutes > 0 ? `目标 ${formatStudyTime(targetSeconds)}` : '尚未设置每日目标'}</span>
            <strong>{studyTargetMinutes > 0 ? `${Math.round(progress)}%` : `${dashboard.summary.sessionCount} 次`}</strong>
          </div>
          <div className="focus-project-summary">
            {dashboard.summary.byProject.length ? dashboard.summary.byProject.map((project) => (
              <div key={project.projectId}>
                <span>{project.projectName}</span>
                <strong>{formatStudyTime(project.studySeconds)}</strong>
              </div>
            )) : <p className="text-sm text-slate-500">今天还没有完成的专注记录。</p>}
          </div>
        </section>

        <section className="focus-history card">
          <div className="focus-section-heading">
            <div><p className="focus-eyebrow">自动写入学习时间</p><h2>今日记录</h2></div>
            <BookOpen size={22} />
          </div>
          <div className="focus-session-list">
            {dashboard.sessions.length ? dashboard.sessions.map((item) => (
              <div key={item.sessionId} className="focus-session-row">
                <div>
                  <strong>{item.projectName}</strong>
                  <span>{new Date(item.startedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} - {new Date(item.endedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <strong>{formatStudyTime(item.durationSeconds)}</strong>
              </div>
            )) : <p className="text-sm text-slate-500">完成一次专注后会自动出现在这里。</p>}
          </div>
          <button
            className="btn btn-soft mt-4 w-full"
            type="button"
            disabled={state!.mode === 'focus' || session.role === 'read'}
            onClick={() => void dispatchTimerAction({ action: dashboard.summary.dayEnded ? 'reopen_day' : 'end_day' })}
          >
            {dashboard.summary.dayEnded ? <RotateCcw size={17} /> : <Flag size={17} />}
            {dashboard.summary.dayEnded ? '恢复今天的学习' : '结束今天的学习'}
          </button>
        </section>
      </div>

      {settingsOpen ? createPortal((
        <div className="focus-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setSettingsOpen(false)}>
          <section className="focus-settings-sheet" role="dialog" aria-modal="true" aria-labelledby="focus-settings-title">
            <div className="focus-section-heading">
              <div><p className="focus-eyebrow">当前账户独立设置</p><h2 id="focus-settings-title">计时设置</h2></div>
              <Settings2 size={21} />
            </div>
            <label><span className="label">专注时长（5-180 分钟）</span><input className="field" type="number" min={5} max={180} value={focusMinutes} onChange={(event) => setFocusMinutes(Number(event.target.value))} /></label>
            <label><span className="label">休息时长（1-60 分钟）</span><input className="field" type="number" min={1} max={60} value={breakMinutes} onChange={(event) => setBreakMinutes(Number(event.target.value))} /></label>
            <div className="focus-action-grid">
              <button className="btn btn-primary" type="button" onClick={() => void saveSettings()} disabled={session.role === 'read'}>保存设置</button>
              <button className="btn btn-soft" type="button" onClick={() => setSettingsOpen(false)}>取消</button>
            </div>
          </section>
        </div>
      ), document.body) : null}

      {state!.mode === 'break' && timing.expired ? createPortal((
        <div className="focus-break-alert" role="alertdialog" aria-modal="true" aria-labelledby="break-alert-title">
          <div className="focus-break-alert-content">
            <span className="focus-break-alert-icon"><AlarmClock size={38} /></span>
            <p>BREAK COMPLETE</p>
            <h2 id="break-alert-title">休息结束，该回来了</h2>
            <span className="focus-break-alert-detail">这次休息已超时 {formatClock(timing.elapsed - state!.targetSeconds)}</span>
            <button className="focus-primary-action" type="button" onClick={() => void dispatchTimerAction({ action: 'finish_break' })}>
              <RotateCcw size={19} />结束休息
            </button>
          </div>
        </div>
      ), document.body) : null}
      <Toast message={toast} />
    </Page>
  );
}
