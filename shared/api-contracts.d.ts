export type ApiContractName =
  | 'session' | 'state' | 'dashboard' | 'dashboardCharts' | 'goals' | 'projects' | 'subjects'
  | 'reviews' | 'reviewPrefill' | 'reviewTrend' | 'problemInbox' | 'studyRecords'
  | 'statisticsSummary' | 'mockExams' | 'reports' | 'calendar' | 'learningProgress'
  | 'projectProgress' | 'studyTargetRead' | 'studyTargetWrite' | 'focusTimerRead'
  | 'focusTimerAction' | 'studyComparison' | 'goalSave' | 'goalActivate' | 'goalRemove'
  | 'reviewUpsert' | 'projectSave' | 'projectRemove' | 'studyRecordsSaveDay' | 'subjectSave'
  | 'subjectRemove' | 'examSave' | 'examRemove' | 'taskSave' | 'taskToggle' | 'taskRemove'
  | 'waterSave' | 'problemInboxSave' | 'problemInboxStatus' | 'problemInboxRemove'
  | 'problemInboxResolveDate' | 'reportGenerate' | 'briefSettingsRead' | 'briefSettingsWrite'
  | 'briefs' | 'briefToday' | 'briefGenerate' | 'briefSendLatest' | 'backupStatus'
  | 'backupRun' | 'backupRestore' | 'taskCenterStatus' | 'visitStats' | 'opsLogsSummary'
  | 'sqliteMaintenance' | 'precomputeMaintenance' | 'breakGuardConfigRead'
  | 'breakGuardConfigWrite' | 'mihomoSettings' | 'mihomoSubscription' | 'mihomoImport'
  | 'mihomoSelect' | 'mihomoTest' | 'notificationCenter' | 'notificationAck'
  | 'notificationRetry' | 'notificationBarkTest'
  | 'notificationTelegramSettings' | 'notificationTelegramRegister' | 'notificationTelegramTest'
  | 'embeddingStatus' | 'errorThemeAnalysis'
  | 'errorThemeDetail' | 'errorThemeOptions' | 'errorThemeBatchStatus' | 'errorThemeBatchRun'
  | 'errorThemeCorrectionSave' | 'users' | 'userInviteCreate' | 'userInviteRevoke'
  | 'userUpdate' | 'userResetPassword' | 'userRevokeSessions' | 'dataReset';

export type ApiFieldDescriptor =
  | 'string' | 'string?'
  | 'number' | 'number?'
  | 'boolean' | 'boolean?'
  | 'array' | 'array?'
  | 'object' | 'object?';

export interface ApiContract {
  method: 'GET' | 'POST';
  path: string;
  capability: string | null;
  body?: Record<string, ApiFieldDescriptor>;
}

export const API_CONTRACTS: Readonly<Record<ApiContractName, ApiContract>>;
export function apiContract(name: ApiContractName): ApiContract;
export function findApiContract(method: string, pathname: string): [ApiContractName, ApiContract] | null;
