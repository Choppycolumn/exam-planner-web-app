import type { DailyBriefSettings } from '../../api/contracts';

export const BACKUP_META_KEY = 'examPlanner.confusingWords.lastBackupAt';
export const BACKUP_BASE_URL_KEY = 'examPlanner.confusingWords.backupBaseUrl';
export const LEGACY_BACKUP_PASSWORD_KEY = 'examPlanner.confusingWords.backupPassword';

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const backupKindLabel: Record<string, string> = {
  manual: '手动',
  weekly: '每周',
  'pre-tables': '拆表前',
  'pre-restore': '恢复前',
  restore: '恢复记录',
};

export type SettingsTab = 'all' | 'general' | 'users' | 'briefs' | 'backups' | 'goals' | 'dictionary' | 'danger';

export const settingsTabs: Array<{ id: SettingsTab; label: string; description: string }> = [
  { id: 'all', label: '全部', description: '显示所有设置块' },
  { id: 'general', label: '基础', description: '数据说明与学习目标' },
  { id: 'users', label: '用户', description: '账户、权限与邀请' },
  { id: 'briefs', label: '通知', description: '晨间简报与邮件' },
  { id: 'backups', label: '备份', description: '服务器快照与恢复' },
  { id: 'goals', label: '目标', description: '长期目标管理' },
  { id: 'dictionary', label: '词典', description: '易混词数据同步' },
  { id: 'danger', label: '危险区', description: '重置与清空' },
];

export const weeklyPushDays = [
  { key: 'monday', label: '周一' },
  { key: 'tuesday', label: '周二' },
  { key: 'wednesday', label: '周三' },
  { key: 'thursday', label: '周四' },
  { key: 'friday', label: '周五' },
  { key: 'saturday', label: '周六' },
  { key: 'sunday', label: '周日' },
] as const;

export function defaultEnglishWritingPlan() {
  return {
    enabled: true,
    showOnDashboard: true,
    includeInBrief: true,
    dailyMinutes: '20-25 分钟',
    currentStageId: 'foundation',
    stages: [
      { id: 'foundation', name: '基础修复期', weeks: '第 1-4 周', focus: '把中文想法变成正确英文；修拼写、语法、搭配' },
      { id: 'past-paper', name: '真题强化期', weeks: '第 5-10 周', focus: '开始稳定写真题小作文和大作文，形成解题流程' },
      { id: 'sprint', name: '高分冲刺期', weeks: '第 11-19 周', focus: '限时写作、整卷训练、减少低级错误' },
      { id: 'stabilize', name: '考前稳定期', weeks: '第 20-24 周', focus: '固化自己的表达库，减少分数波动' },
    ],
    weeklyTasks: {
      monday: '6 句应用文功能句：邀请、建议、感谢、投诉等',
      tuesday: '真题或模拟题小作文：只写开头 + 主体段',
      wednesday: '修改周二作文，整理错误表达',
      thursday: '大作文：英文提纲 + 图画描述段',
      friday: '大作文：写一个主体分析段',
      saturday: '完整小作文一篇，限时 15 分钟',
      sunday: '闭卷重写本周小作文 + 复盘错句',
    },
  };
}

export function defaultBriefSettings(): DailyBriefSettings {
  const englishWritingPlan = defaultEnglishWritingPlan();
  return {
    enabled: true,
    generateTime: '08:00',
    cityName: '北京',
    latitude: 39.9042,
    longitude: 116.4074,
    marketSymbolsText: '上证指数|000001.SS\n深证成指|399001.SZ\n创业板指|399006.SZ\n纳斯达克|^IXIC\n标普500|^GSPC\nBTC|BTC-USD',
    notifications: {
      enabled: true,
    },
    taskReminders: {
      enabled: true,
      count: 1,
      offsetsMinutes: [60],
    },
    customWeeklyPush: {
      enabled: true,
      days: {
        monday: '',
        tuesday: '',
        wednesday: '',
        thursday: '',
        friday: '',
        saturday: '',
        sunday: '',
      },
    },
    englishWritingPlan,
    email: {
      enabled: false,
      host: '',
      port: 465,
      secureMode: 'ssl',
      username: '',
      password: '',
      from: '',
      to: '',
      subjectPrefix: 'Exam Planner 今日简报',
    },
  };
}

export function parseReminderOffsets(value: string) {
  const offsets = value
    .split(/[,\s，、]+/)
    .map((item) => Math.round(Number(item.trim())))
    .filter((item) => Number.isInteger(item) && item >= 0 && item <= 30 * 24 * 60);
  return Array.from(new Set(offsets)).sort((a, b) => b - a).slice(0, 5);
}

export function reminderOffsetsText(settings: DailyBriefSettings) {
  return (settings.taskReminders?.offsetsMinutes?.length ? settings.taskReminders.offsetsMinutes : [60]).join(', ');
}
