import { settingsTabs, type SettingsTab } from './settingsModel';

interface SettingsNavigationProps {
  current: SettingsTab;
  onChange: (tab: SettingsTab) => void;
}

export function SettingsNavigation({ current, onChange }: SettingsNavigationProps) {
  return (
    <div className="mt-5 card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-primary">系统设置中心</h2>
          <p className="mt-1 text-sm text-secondary">按基础、用户、通知、备份、目标、词典和危险操作分组。</p>
        </div>
        <span className="rounded-lg border border-line bg-surface-muted px-3 py-2 text-sm font-semibold text-secondary">
          当前：{settingsTabs.find((tab) => tab.id === current)?.label}
        </span>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-8">
        {settingsTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`rounded-lg border px-3 py-2 text-left transition ${current === tab.id ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface-strong text-secondary hover:bg-surface-hover'}`}
            onClick={() => onChange(tab.id)}
          >
            <span className="block text-sm font-semibold">{tab.label}</span>
            <span className="mt-1 block text-xs opacity-75">{tab.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
