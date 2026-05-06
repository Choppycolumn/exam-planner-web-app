import type { MockExamRecord, Subject } from '../../types/models';
import { notifyDataChanged, serverApi } from '../../api/client';

export const subjectsRepository = {
  async saveSubject(subject: Partial<Subject>) {
    const id = await serverApi.saveSubject(subject);
    notifyDataChanged();
    return id;
  },
  async removeSubject(id: number) {
    await serverApi.removeSubject(id);
    notifyDataChanged();
  },
  async saveExam(record: Partial<MockExamRecord> & { subjectId: number; subjectNameSnapshot: string }) {
    const id = await serverApi.saveExam(record);
    notifyDataChanged();
    return id;
  },
  async removeExam(id: number) {
    await serverApi.removeExam(id);
    notifyDataChanged();
  },
};
