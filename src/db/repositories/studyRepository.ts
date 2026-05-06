import type { StudyProject, StudyTimeRecord } from '../../types/models';
import { notifyDataChanged, serverApi } from '../../api/client';

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
    const state = await serverApi.getState();
    return state.studyTimeRecords.filter((record) => record.date === date);
  },
  async saveDayRecords(date: string, records: Array<Partial<StudyTimeRecord> & { projectId: number; projectNameSnapshot: string }>) {
    await serverApi.saveDayRecords(date, records);
    notifyDataChanged();
  },
};
