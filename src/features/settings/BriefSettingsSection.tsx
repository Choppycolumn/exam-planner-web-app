import type { Dispatch, SetStateAction } from 'react';
import { Bell, Cloud, Mail } from 'lucide-react';
import type { DailyBriefSettings } from '../../api/contracts';
import { defaultBriefSettings, weeklyPushDays } from './settingsModel';

interface BriefSettingsSectionProps {
  visible: boolean;
  settings: DailyBriefSettings;
  onChange: Dispatch<SetStateAction<DailyBriefSettings>>;
  reminderOffsets: string;
  onReminderOffsetsChange: Dispatch<SetStateAction<string>>;
  readOnly?: boolean;
  loading: boolean;
  onSave: () => void | Promise<void>;
  onGenerate: () => void | Promise<void>;
}

export function BriefSettingsSection({ visible, settings, onChange, reminderOffsets, onReminderOffsetsChange, readOnly, loading, onSave, onGenerate }: BriefSettingsSectionProps) {
  const englishPlanDefaults = defaultBriefSettings().englishWritingPlan;
  const englishPlan = {
    ...englishPlanDefaults,
    ...(settings.englishWritingPlan ?? {}),
    stages: settings.englishWritingPlan?.stages?.length ? settings.englishWritingPlan.stages : englishPlanDefaults.stages,
    weeklyTasks: {
      ...englishPlanDefaults.weeklyTasks,
      ...(settings.englishWritingPlan?.weeklyTasks ?? {}),
    },
  };
  const updateEnglishPlan = (patch: Partial<DailyBriefSettings['englishWritingPlan']>) => {
    onChange({ ...settings, englishWritingPlan: { ...englishPlan, ...patch } });
  };
  const updateEnglishStage = (index: number, patch: Partial<DailyBriefSettings['englishWritingPlan']['stages'][number]>) => {
    const stages = englishPlan.stages.map((stage, stageIndex) => (stageIndex === index ? { ...stage, ...patch } : stage));
    updateEnglishPlan({ stages });
  };
  const updateEnglishWeeklyTask = (key: keyof DailyBriefSettings['englishWritingPlan']['weeklyTasks'], value: string) => {
    updateEnglishPlan({ weeklyTasks: { ...englishPlan.weeklyTasks, [key]: value } });
  };

  return (
      <div className={visible ? 'mt-5 card p-5' : 'hidden'}>
        <h2 className="flex items-center gap-2 text-base font-semibold"><Bell size={18} />晨间简报与邮件</h2>
        <p className="mt-2 text-sm leading-6 text-secondary">每天按设定时间自动生成天气、指数涨跌和学习提醒。邮件推送需要填写自己的 SMTP 信息，默认关闭。</p>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <label className="flex items-center gap-2 rounded-lg border border-line bg-surface-muted px-3 py-2 text-sm font-medium text-strong">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(event) => onChange({ ...settings, enabled: event.target.checked })}
            />
            自动生成简报
          </label>
          <label>
            <span className="label">生成时间</span>
            <input className="field" type="time" value={settings.generateTime} onChange={(event) => onChange({ ...settings, generateTime: event.target.value })} />
          </label>
          <label>
            <span className="label">城市名称</span>
            <input className="field" value={settings.cityName} onChange={(event) => onChange({ ...settings, cityName: event.target.value })} />
          </label>
          <label>
            <span className="label">下一次自动生成</span>
            <input className="field" readOnly value={settings.nextDailyBriefAt ? new Date(settings.nextDailyBriefAt).toLocaleString() : '保存后计算'} />
          </label>
          <label>
            <span className="label">纬度</span>
            <input className="field" type="number" step="0.0001" value={settings.latitude} onChange={(event) => onChange({ ...settings, latitude: Number(event.target.value) })} />
          </label>
          <label>
            <span className="label">经度</span>
            <input className="field" type="number" step="0.0001" value={settings.longitude} onChange={(event) => onChange({ ...settings, longitude: Number(event.target.value) })} />
          </label>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <label>
            <span className="label">指数/资产（名称|代码，每行一个）</span>
            <textarea className="field min-h-32" value={settings.marketSymbolsText} onChange={(event) => onChange({ ...settings, marketSymbolsText: event.target.value })} />
            <p className="mt-1 text-xs leading-5 text-secondary">直接在这里加一行即可，例如“纳斯达克|^IXIC”“BNB|BNB-USD”“苹果|AAPL”。支持常见美股、A 股、部分指数和主流加密资产。</p>
          </label>
        </div>
        <div className="mt-5 rounded-lg border border-line bg-surface-muted p-4">
          <label className="mb-4 flex items-center gap-2 text-sm font-semibold text-strong">
            <input
              type="checkbox"
              checked={settings.wechat?.enabled ?? false}
              onChange={(event) => onChange({ ...settings, wechat: { ...settings.wechat, enabled: event.target.checked } })}
            />
            <Bell size={16} />启用微信每日推送
          </label>
          <div className="mb-4 rounded-lg border border-accent bg-surface-strong p-4">
            <label className="flex items-center gap-2 text-sm font-semibold text-strong">
              <input
                type="checkbox"
                checked={settings.taskReminders?.enabled ?? true}
                onChange={(event) => onChange({
                  ...settings,
                  taskReminders: { ...(settings.taskReminders ?? defaultBriefSettings().taskReminders), enabled: event.target.checked },
                })}
              />
              <Bell size={16} />启用定时待办微信提醒
            </label>
            <div className="mt-3 grid gap-3 md:grid-cols-[160px_1fr]">
              <label>
                <span className="label">提醒次数</span>
                <input
                  className="field"
                  type="number"
                  min={1}
                  max={5}
                  value={settings.taskReminders?.count ?? 1}
                  onChange={(event) => onChange({
                    ...settings,
                    taskReminders: {
                      ...(settings.taskReminders ?? defaultBriefSettings().taskReminders),
                      count: Math.max(1, Math.min(5, Number(event.target.value) || 1)),
                    },
                  })}
                />
              </label>
              <label>
                <span className="label">每次提前分钟</span>
                <input
                  className="field"
                  placeholder="60 或 120, 60, 15"
                  value={reminderOffsets}
                  onChange={(event) => onReminderOffsetsChange(event.target.value)}
                />
                <p className="mt-1 text-xs leading-5 text-secondary">多个提醒用逗号分隔；例如 120, 60, 15 表示提前 2 小时、1 小时、15 分钟各提醒一次。</p>
              </label>
            </div>
          </div>
          <div className="mb-4 rounded-lg border border-success bg-surface-strong p-4">
            <label className="flex items-center gap-2 text-sm font-semibold text-strong">
              <input
                type="checkbox"
                checked={settings.customWeeklyPush?.enabled ?? true}
                onChange={(event) => onChange({
                  ...settings,
                  customWeeklyPush: { ...(settings.customWeeklyPush ?? defaultBriefSettings().customWeeklyPush), enabled: event.target.checked },
                })}
              />
              <Bell size={16} />启用每周自定义推送栏目
            </label>
            <p className="mt-2 text-xs leading-5 text-secondary">在这里按周一到周日写当天想提醒自己的内容。每天生成简报时会自动取当天栏目，空白则不展示。</p>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {weeklyPushDays.map((day) => (
                <label key={day.key}>
                  <span className="label">{day.label}推送内容</span>
                  <textarea
                    className="field min-h-24"
                    placeholder={`${day.label}要推送给自己的固定提醒`}
                    value={settings.customWeeklyPush?.days?.[day.key] ?? ''}
                    onChange={(event) => onChange({
                      ...settings,
                      customWeeklyPush: {
                        ...(settings.customWeeklyPush ?? defaultBriefSettings().customWeeklyPush),
                        days: {
                          ...(settings.customWeeklyPush?.days ?? defaultBriefSettings().customWeeklyPush.days),
                          [day.key]: event.target.value,
                        },
                      },
                    })}
                  />
                </label>
              ))}
            </div>
          </div>
          <div className="mb-4 rounded-lg border border-violet bg-surface-strong p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-primary">英语写作计划</h3>
                <p className="mt-1 text-xs leading-5 text-secondary">主页展示当前阶段和今日任务；每日简报会按当天星期自动带上对应写作安排。</p>
              </div>
              <div className="flex flex-wrap gap-3 text-sm font-semibold text-strong">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={englishPlan.enabled} onChange={(event) => updateEnglishPlan({ enabled: event.target.checked })} />
                  启用
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={englishPlan.showOnDashboard} onChange={(event) => updateEnglishPlan({ showOnDashboard: event.target.checked })} />
                  主页显示
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={englishPlan.includeInBrief} onChange={(event) => updateEnglishPlan({ includeInBrief: event.target.checked })} />
                  写入简报
                </label>
              </div>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-[180px_1fr]">
              <label>
                <span className="label">每日用时</span>
                <input className="field" value={englishPlan.dailyMinutes} onChange={(event) => updateEnglishPlan({ dailyMinutes: event.target.value })} />
              </label>
              <label>
                <span className="label">当前阶段</span>
                <select className="field" value={englishPlan.currentStageId} onChange={(event) => updateEnglishPlan({ currentStageId: event.target.value })}>
                  {englishPlan.stages.map((stage) => (
                    <option key={stage.id} value={stage.id}>{stage.name}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {englishPlan.stages.map((stage, index) => (
                <div key={stage.id} className="rounded-lg border border-line bg-surface-muted p-3">
                  <div className="grid gap-2 md:grid-cols-[1fr_120px]">
                    <label>
                      <span className="label">阶段名称</span>
                      <input className="field" value={stage.name} onChange={(event) => updateEnglishStage(index, { name: event.target.value })} />
                    </label>
                    <label>
                      <span className="label">时间</span>
                      <input className="field" value={stage.weeks} onChange={(event) => updateEnglishStage(index, { weeks: event.target.value })} />
                    </label>
                  </div>
                  <label className="mt-2 block">
                    <span className="label">这一阶段要解决什么</span>
                    <textarea className="field min-h-20" value={stage.focus} onChange={(event) => updateEnglishStage(index, { focus: event.target.value })} />
                  </label>
                </div>
              ))}
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {weeklyPushDays.map((day) => (
                <label key={day.key}>
                  <span className="label">{day.label}写作任务</span>
                  <textarea
                    className="field min-h-20"
                    value={englishPlan.weeklyTasks[day.key]}
                    onChange={(event) => updateEnglishWeeklyTask(day.key, event.target.value)}
                  />
                </label>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold text-strong">
            <input
              type="checkbox"
              checked={settings.email.enabled}
              onChange={(event) => onChange({ ...settings, email: { ...settings.email, enabled: event.target.checked } })}
            />
            <Mail size={16} />启用邮件推送
          </label>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <label><span className="label">SMTP Host</span><input className="field" placeholder="smtp.example.com" value={settings.email.host} onChange={(event) => onChange({ ...settings, email: { ...settings.email, host: event.target.value } })} /></label>
            <label><span className="label">端口</span><input className="field" type="number" value={settings.email.port} onChange={(event) => onChange({ ...settings, email: { ...settings.email, port: Number(event.target.value) } })} /></label>
            <label><span className="label">加密方式</span><select className="field" value={settings.email.secureMode} onChange={(event) => onChange({ ...settings, email: { ...settings.email, secureMode: event.target.value as DailyBriefSettings['email']['secureMode'] } })}><option value="ssl">SSL</option><option value="starttls">STARTTLS</option><option value="none">无</option></select></label>
            <label><span className="label">账号</span><input className="field" value={settings.email.username} onChange={(event) => onChange({ ...settings, email: { ...settings.email, username: event.target.value } })} /></label>
            <label><span className="label">密码 / 授权码</span><input className="field" type="password" placeholder={settings.email.hasPassword ? '已保存，留空则不修改' : ''} value={settings.email.password} onChange={(event) => onChange({ ...settings, email: { ...settings.email, password: event.target.value } })} /></label>
            <label><span className="label">邮件标题前缀</span><input className="field" value={settings.email.subjectPrefix} onChange={(event) => onChange({ ...settings, email: { ...settings.email, subjectPrefix: event.target.value } })} /></label>
            <label><span className="label">发件人</span><input className="field" placeholder="me@example.com" value={settings.email.from} onChange={(event) => onChange({ ...settings, email: { ...settings.email, from: event.target.value } })} /></label>
            <label className="md:col-span-2"><span className="label">收件人（多个用逗号分隔）</span><input className="field" placeholder="me@example.com" value={settings.email.to} onChange={(event) => onChange({ ...settings, email: { ...settings.email, to: event.target.value } })} /></label>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <button className="btn btn-primary" disabled={readOnly || loading} onClick={() => void onSave()}><Bell size={16} />保存简报设置</button>
          <button className="btn btn-soft" disabled={readOnly || loading} onClick={() => void onGenerate()}><Cloud size={16} />立即生成今日简报</button>
        </div>
      </div>
  );
}
