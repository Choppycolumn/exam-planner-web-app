import type { MockExamRecord, Subject } from '../../types/models';
import { nowISO } from '../../utils/date';
import { db } from '../database';
import { ENTITY_SCHEMA_VERSION } from '../schema';

export const subjectsRepository = {
  subjects: db.subjects,
  exams: db.mockExamRecords,
  async saveSubject(subject: Partial<Subject>) {
    const timestamp = nowISO();
    if (subject.id) {
      await db.subjects.update(subject.id, { ...subject, updatedAt: timestamp });
      return subject.id;
    }
    const count = await db.subjects.count();
    return db.subjects.add({
      name: subject.name ?? '',
      color: subject.color ?? '#2563eb',
      isActive: subject.isActive ?? true,
      sortOrder: subject.sortOrder ?? count + 1,
      schemaVersion: ENTITY_SCHEMA_VERSION,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  },
  async removeSubject(id: number) {
    await db.subjects.update(id, { isActive: false, updatedAt: nowISO() });
  },
  async saveExam(record: Partial<MockExamRecord> & { subjectId: number; subjectNameSnapshot: string }) {
    const timestamp = nowISO();
    if (record.id) {
      await db.mockExamRecords.update(record.id, { ...record, updatedAt: timestamp });
      return record.id;
    }
    return db.mockExamRecords.add({
      date: record.date ?? '',
      subjectId: record.subjectId,
      subjectNameSnapshot: record.subjectNameSnapshot,
      score: Number(record.score ?? 0),
      fullScore: Number(record.fullScore ?? 100),
      paperName: record.paperName ?? '',
      durationMinutes: Number(record.durationMinutes ?? 0),
      wrongCount: Number(record.wrongCount ?? 0),
      note: record.note ?? '',
      schemaVersion: ENTITY_SCHEMA_VERSION,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  },
  async removeExam(id: number) {
    await db.mockExamRecords.delete(id);
  },
};
