import { createBriefSettingsService } from '../../../domains/brief/settings-service.mjs';

export function installBriefSettingsDomain(runtime, exposeRuntime) {
    const {
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
    } = createBriefSettingsService({
        runtime,
        scheduleDailyBrief: () => runtime.scheduleDailyBrief(),
    });
    const encryptSettingSecret = (value = '') => runtime.settingsCrypto.encrypt(value);
    const decryptSettingSecret = (value = '') => runtime.settingsCrypto.decrypt(value).value;
    exposeRuntime({
        defaultDailyBriefSettings: () => defaultDailyBriefSettings,
        weekdayLabels: () => weekdayLabels,
        weekdayKeys: () => weekdayKeys,
        defaultEnglishWritingPlanSettings: () => defaultEnglishWritingPlanSettings,
        normalizeEnglishWritingPlanSettings: () => normalizeEnglishWritingPlanSettings,
        englishWritingPlanForDate: () => englishWritingPlanForDate,
        normalizeCustomWeeklyPushSettings: () => normalizeCustomWeeklyPushSettings,
        customWeeklyPushForDate: () => customWeeklyPushForDate,
        normalizeTaskReminderSettings: () => normalizeTaskReminderSettings,
        normalizeDailyBriefSettings: () => normalizeDailyBriefSettings,
        encryptSettingSecret: () => encryptSettingSecret,
        decryptSettingSecret: () => decryptSettingSecret,
        storedDailyBriefSettings: () => storedDailyBriefSettings,
        publicDailyBriefSettings: () => publicDailyBriefSettings,
        getDailyBriefSettings: () => getDailyBriefSettings,
        saveDailyBriefSettings: () => saveDailyBriefSettings,
    });
}
