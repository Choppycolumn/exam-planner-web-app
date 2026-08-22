const weekdayLabels = {
  monday: '周一',
  tuesday: '周二',
  wednesday: '周三',
  thursday: '周四',
  friday: '周五',
  saturday: '周六',
  sunday: '周日',
};

const weekdayKeys = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export function createBriefSettingsService({ runtime, scheduleDailyBrief }) {
  function defaultEnglishWritingPlanSettings() {
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

  function defaultDailyBriefSettings() {
    return {
      enabled: true,
      generateTime: '08:00',
      cityName: '北京',
      latitude: 39.9042,
      longitude: 116.4074,
      marketSymbolsText: '上证指数|000001.SS\n深证成指|399001.SZ\n创业板指|399006.SZ\n纳斯达克|^IXIC\n标普500|^GSPC\nBTC|BTC-USD',
      notifications: { enabled: true },
      taskReminders: { enabled: true, count: 1, offsetsMinutes: [60] },
      customWeeklyPush: {
        enabled: true,
        days: Object.fromEntries(Object.keys(weekdayLabels).map((key) => [key, ''])),
      },
      englishWritingPlan: defaultEnglishWritingPlanSettings(),
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

  function normalizeEnglishWritingPlanSettings(input = {}, previous = null) {
    const defaults = defaultEnglishWritingPlanSettings();
    const previousSettings = previous?.englishWritingPlan || {};
    const rawStages = Array.isArray(input.stages)
      ? input.stages
      : Array.isArray(previousSettings.stages) ? previousSettings.stages : defaults.stages;
    const stages = rawStages.slice(0, 8).map((stage, index) => {
      const fallback = defaults.stages[index] || defaults.stages[0];
      const id = String(stage?.id || fallback.id || `stage-${index + 1}`)
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40) || `stage-${index + 1}`;
      return {
        id,
        name: String(stage?.name || fallback.name || `阶段 ${index + 1}`).trim().slice(0, 80),
        weeks: String(stage?.weeks || fallback.weeks || '').trim().slice(0, 80),
        focus: String(stage?.focus || fallback.focus || '').trim().slice(0, 240),
      };
    });
    const inputTasks = input.weeklyTasks || {};
    const previousTasks = previousSettings.weeklyTasks || {};
    const weeklyTasks = {};
    for (const key of Object.keys(weekdayLabels)) {
      weeklyTasks[key] = String(inputTasks[key] ?? previousTasks[key] ?? defaults.weeklyTasks[key] ?? '').slice(0, 600);
    }
    const requestedStageId = String(input.currentStageId ?? previousSettings.currentStageId ?? defaults.currentStageId);
    const currentStageId = stages.some((stage) => stage.id === requestedStageId)
      ? requestedStageId
      : stages[0]?.id || defaults.currentStageId;
    return {
      enabled: Boolean(input.enabled ?? previousSettings.enabled ?? defaults.enabled),
      showOnDashboard: Boolean(input.showOnDashboard ?? previousSettings.showOnDashboard ?? defaults.showOnDashboard),
      includeInBrief: Boolean(input.includeInBrief ?? previousSettings.includeInBrief ?? defaults.includeInBrief),
      dailyMinutes: String(input.dailyMinutes ?? previousSettings.dailyMinutes ?? defaults.dailyMinutes).trim().slice(0, 40) || defaults.dailyMinutes,
      currentStageId,
      stages,
      weeklyTasks,
    };
  }

  function englishWritingPlanForDate(date, settings = getDailyBriefSettings({ includeSecret: true })) {
    const normalizedDate = String(date || runtime.todayISO()).slice(0, 10);
    const weekday = weekdayKeys[new Date(`${normalizedDate}T12:00:00+08:00`).getDay()] || 'monday';
    const config = settings.englishWritingPlan || defaultEnglishWritingPlanSettings();
    const currentStage = (config.stages || []).find((stage) => stage.id === config.currentStageId) || (config.stages || [])[0] || null;
    const todayTask = String(config.weeklyTasks?.[weekday] || '').trim();
    return {
      enabled: Boolean(config.enabled),
      showOnDashboard: Boolean(config.showOnDashboard),
      includeInBrief: Boolean(config.includeInBrief),
      date: normalizedDate,
      weekday,
      weekdayLabel: weekdayLabels[weekday] || weekday,
      dailyMinutes: config.dailyMinutes || '20-25 分钟',
      currentStage,
      stages: config.stages || [],
      weeklyTasks: config.weeklyTasks || {},
      todayTask: Boolean(config.enabled) ? todayTask : '',
      hasTodayTask: Boolean(config.enabled && todayTask),
    };
  }

  function normalizeCustomWeeklyPushSettings(input = {}, previous = null) {
    const defaults = defaultDailyBriefSettings().customWeeklyPush;
    const previousSettings = previous?.customWeeklyPush || {};
    const inputDays = input.days || {};
    const previousDays = previousSettings.days || {};
    const days = {};
    for (const key of Object.keys(weekdayLabels)) {
      days[key] = String(inputDays[key] ?? previousDays[key] ?? defaults.days[key] ?? '').slice(0, 1200);
    }
    return {
      enabled: Boolean(input.enabled ?? previousSettings.enabled ?? defaults.enabled),
      days,
    };
  }

  function customWeeklyPushForDate(date, settings = getDailyBriefSettings({ includeSecret: true })) {
    const normalizedDate = String(date || runtime.todayISO()).slice(0, 10);
    const weekday = weekdayKeys[new Date(`${normalizedDate}T12:00:00+08:00`).getDay()] || 'monday';
    const config = settings.customWeeklyPush || defaultDailyBriefSettings().customWeeklyPush;
    const content = String(config.days?.[weekday] || '').trim();
    return {
      enabled: Boolean(config.enabled),
      date: normalizedDate,
      weekday,
      weekdayLabel: weekdayLabels[weekday] || weekday,
      content: Boolean(config.enabled) ? content : '',
      hasContent: Boolean(config.enabled && content),
    };
  }

  function normalizeTaskReminderSettings(input = {}, previous = null) {
    const defaults = defaultDailyBriefSettings().taskReminders;
    const previousSettings = previous?.taskReminders || {};
    const rawOffsets = Array.isArray(input.offsetsMinutes)
      ? input.offsetsMinutes
      : previousSettings.offsetsMinutes || defaults.offsetsMinutes;
    const offsets = Array.from(new Set(rawOffsets
      .map((item) => Math.round(Number(item)))
      .filter((item) => Number.isInteger(item) && item >= 0 && item <= 30 * 24 * 60)))
      .sort((a, b) => b - a)
      .slice(0, 5);
    const requestedCount = Math.round(Number(input.count ?? previousSettings.count ?? (offsets.length || defaults.count)));
    const nextOffsets = offsets.length ? offsets : defaults.offsetsMinutes;
    return {
      enabled: Boolean(input.enabled ?? previousSettings.enabled ?? defaults.enabled),
      count: Math.max(1, Math.min(5, nextOffsets.length, Number.isFinite(requestedCount) ? requestedCount : defaults.count)),
      offsetsMinutes: nextOffsets.slice(0, Math.max(1, Math.min(5, nextOffsets.length, Number.isFinite(requestedCount) ? requestedCount : defaults.count))),
    };
  }

  function normalizeDailyBriefSettings(input = {}, previous = null) {
    const defaults = defaultDailyBriefSettings();
    const previousEmail = previous?.email || {};
    const emailInput = input.email || {};
    const previousNotifications = previous?.notifications || {};
    const notificationInput = input.notifications || {};
    const requestedPassword = typeof emailInput.password === 'string' ? emailInput.password : '';
    const preservedPassword = requestedPassword.trim() ? requestedPassword : previousEmail.password || '';
    const secureMode = ['ssl', 'starttls', 'none'].includes(emailInput.secureMode) ? emailInput.secureMode : defaults.email.secureMode;
    return {
      enabled: input.enabled !== false,
      generateTime: /^\d{2}:\d{2}$/.test(input.generateTime || '') ? input.generateTime : defaults.generateTime,
      cityName: String(input.cityName || defaults.cityName).trim() || defaults.cityName,
      latitude: Number.isFinite(Number(input.latitude)) ? Number(input.latitude) : defaults.latitude,
      longitude: Number.isFinite(Number(input.longitude)) ? Number(input.longitude) : defaults.longitude,
      marketSymbolsText: String(input.marketSymbolsText ?? defaults.marketSymbolsText),
      notifications: { enabled: Boolean(notificationInput.enabled ?? previousNotifications.enabled ?? defaults.notifications.enabled) },
      taskReminders: normalizeTaskReminderSettings(input.taskReminders || {}, previous),
      customWeeklyPush: normalizeCustomWeeklyPushSettings(input.customWeeklyPush || {}, previous),
      englishWritingPlan: normalizeEnglishWritingPlanSettings(input.englishWritingPlan || {}, previous),
      email: {
        enabled: Boolean(emailInput.enabled),
        host: String(emailInput.host || previousEmail.host || '').trim(),
        port: Math.max(1, Math.min(65535, Number(emailInput.port || previousEmail.port || defaults.email.port))),
        secureMode,
        username: String(emailInput.username || previousEmail.username || '').trim(),
        password: preservedPassword,
        from: String(emailInput.from || previousEmail.from || '').trim(),
        to: String(emailInput.to || previousEmail.to || '').trim(),
        subjectPrefix: String(emailInput.subjectPrefix || previousEmail.subjectPrefix || defaults.email.subjectPrefix).trim() || defaults.email.subjectPrefix,
      },
    };
  }

  function storedDailyBriefSettings(settings) {
    const publicEmail = { ...settings.email };
    delete publicEmail.password;
    return {
      ...settings,
      email: { ...publicEmail, passwordEncrypted: runtime.settingsCrypto.encrypt(settings.email.password || '') },
    };
  }

  function publicDailyBriefSettings(settings) {
    return {
      ...settings,
      email: { ...settings.email, password: '', hasPassword: Boolean(settings.email.password) },
      nextDailyBriefAt: runtime.runtimeScheduleValue('worker_next_daily_brief_at', runtime.nextDailyBriefAt),
    };
  }

  function getDailyBriefSettings({ includeSecret = false } = {}) {
    let parsed = {};
    let encryptedSecret = null;
    try {
      const raw = runtime.appMetadataRepository.get(runtime.dailyBriefSettingsKey, '');
      parsed = raw ? JSON.parse(raw) : {};
      if (parsed.email?.passwordEncrypted && !parsed.email.password) {
        encryptedSecret = runtime.settingsCrypto.decrypt(parsed.email.passwordEncrypted);
        parsed.email.password = encryptedSecret.value;
      }
    } catch {
      parsed = {};
    }
    const settings = normalizeDailyBriefSettings(parsed);
    if ((parsed.email?.password && !parsed.email.passwordEncrypted) || encryptedSecret?.needsMigration || encryptedSecret?.ok === false) {
      runtime.appMetadataRepository.set(runtime.dailyBriefSettingsKey, JSON.stringify(storedDailyBriefSettings(settings)));
    }
    return includeSecret ? settings : publicDailyBriefSettings(settings);
  }

  function saveDailyBriefSettings(input = {}) {
    const previous = getDailyBriefSettings({ includeSecret: true });
    const settings = normalizeDailyBriefSettings(input, previous);
    runtime.appMetadataRepository.set(runtime.dailyBriefSettingsKey, JSON.stringify(storedDailyBriefSettings(settings)));
    scheduleDailyBrief();
    return publicDailyBriefSettings(settings);
  }

  return {
    defaultDailyBriefSettings,
    weekdayLabels,
    weekdayKeys,
    defaultEnglishWritingPlanSettings,
    normalizeEnglishWritingPlanSettings,
    englishWritingPlanForDate,
    normalizeCustomWeeklyPushSettings,
    customWeeklyPushForDate,
    normalizeTaskReminderSettings,
    normalizeDailyBriefSettings,
    storedDailyBriefSettings,
    publicDailyBriefSettings,
    getDailyBriefSettings,
    saveDailyBriefSettings,
  };
}
