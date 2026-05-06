import type { StudyProject, StudyTimeRecord } from '../../types/models';
import { nowISO } from '../../utils/date';
import { db } from '../database';
import { ENTITY_SCHEMA_VERSION } from '../schema';

export const studyRepository = {
  projects: db.studyProjects,
  records: db.studyTimeRecords,
  async saveProject(project: Partial<StudyProject>) {
    const timestamp = nowISO();
    if (project.id) {
      await db.studyProjects.update(project.id, { ...project, updatedAt: timestamp });
      return project.id;
    }
    const count = await db.studyProjects.count();
    return db.studyProjects.add({
      name: project.name ?? '',
      color: project.color ?? '#2563eb',
      isActive: project.isActive ?? true,
      sortOrder: project.sortOrder ?? count + 1,
      schemaVersion: ENTITY_SCHEMA_VERSION,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  },
  async removeProject(id: number) {
    await db.studyProjects.update(id, { isActive: false, updatedAt: nowISO() });
  },
  async getRecordsByDate(date: string) {
    return db.studyTimeRecords.where('date').equals(date).toArray();
  },
  async saveDayRecords(date: string, records: Array<Partial<StudyTimeRecord> & { projectId: number; projectNameSnapshot: string }>) {
    const timestamp = nowISO();
    await db.transaction('rw', db.studyTimeRecords, async () => {
      for (const record of records) {
        const existing = await db.studyTimeRecords.where('[date+projectId]').equals([date, record.projectId]).first();
        const payload = {
          date,
          projectId: record.projectId,
          projectNameSnapshot: record.projectNameSnapshot,
          minutes: Math.max(0, Number(record.minutes ?? 0)),
          note: record.note ?? '',
          updatedAt: timestamp,
        };
        if (existing?.id) {
          await db.studyTimeRecords.update(existing.id, payload);
        } else {
          await db.studyTimeRecords.add({ ...payload, schemaVersion: ENTITY_SCHEMA_VERSION, createdAt: timestamp });
        }
      }
    });
  },
};
