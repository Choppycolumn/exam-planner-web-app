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
    const result = await serverApi.getStudyRecordsByDate(date);
    return result.records;
  },
  async saveDayRecords(date: string, records: Array<Partial<StudyTimeRecord> & { projectId: number; projectNameSnapshot: string }>) {
    await serverApi.saveDayRecords(date, records);
    notifyDataChanged();
  },
};
