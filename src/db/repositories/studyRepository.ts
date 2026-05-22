import type { StudyProject, StudyTimeRecord } from '../../types/models';
import { notifyDataChanged, serverApi } from '../../api/client';
import type { DashboardData } from '../../api/client';
import { queryClient, queryKeys } from '../../api/queryClient';
import { todayISO } from '../../utils/date';

export const studyRepository = {
  async saveProject(project: Partial<StudyProject>) {
    const id = await serverApi.saveProject(project);
    notifyDataChanged();
    return id;
  },
  async removeProject(id: number) {
    await serverApi.removeProject(id);
    notifyDataChanged();
  },
  async getRecordsByDate(date: string) {
    const result = await serverApi.getStudyRecordsByDate(date);
    return result.records;
  },
  async saveDayRecords(date: string, records: Array<Partial<StudyTimeRecord> & { projectId: number; projectNameSnapshot: string }>) {
    const optimisticRecords: StudyTimeRecord[] = records.map((record, index) => ({
      id: record.id ?? -(Date.now() + index),
      date,
      projectId: record.projectId,
      projectNameSnapshot: record.projectNameSnapshot,
      minutes: Math.max(0, Number(record.minutes || 0)),
      note: record.note ?? '',
      schemaVersion: record.schemaVersion ?? 1,
      createdAt: record.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    queryClient.setQueryData(queryKeys.studyRecords(date), { records: optimisticRecords, readOnly: false });
    if (date === todayISO()) {
      const todayTotal = optimisticRecords.reduce((sum, record) => sum + Number(record.minutes || 0), 0);
      queryClient.setQueryData<DashboardData | undefined>(queryKeys.dashboard, (current) => (
        current ? { ...current, todayTotal } : current
      ));
    }
    await serverApi.saveDayRecords(date, records);
    notifyDataChanged();
  },
};
