import { addYears, format } from 'date-fns';
import { db } from './database';
import { ENTITY_SCHEMA_VERSION } from './schema';
import { nowISO } from '../utils/date';

const projectColors = ['#2563eb', '#16a34a', '#f97316', '#9333ea', '#dc2626', '#0f766e', '#ca8a04', '#64748b'];
const subjectColors = ['#2563eb', '#16a34a', '#9333ea', '#dc2626'];

export async function initializeDefaultData() {
  const initialized = await db.appSettings.where('key').equals('initialized').first();
  if (initialized) return;

  const timestamp = nowISO();
  await db.transaction('rw', db.goals, db.studyProjects, db.subjects, db.appSettings, async () => {
    await db.goals.add({
      name: '我的考研目标',
      description: '坚持长期复习，稳定提高分数',
      deadline: format(addYears(new Date(), 1), 'yyyy-MM-dd'),
      isActive: true,
      type: '考研',
      notes: '',
      schemaVersion: ENTITY_SCHEMA_VERSION,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await db.studyProjects.bulkAdd(
      ['高等数学', '线性代数', '概率论', '英语单词', '英语阅读', '专业课', '政治', '复盘总结'].map((name, index) => ({
        name,
        color: projectColors[index % projectColors.length],
        isActive: true,
        sortOrder: index + 1,
        schemaVersion: ENTITY_SCHEMA_VERSION,
        createdAt: timestamp,
        updatedAt: timestamp,
      })),
    );

    await db.subjects.bulkAdd(
      ['数学', '英语', '政治', '专业课'].map((name, index) => ({
        name,
        color: subjectColors[index % subjectColors.length],
        isActive: true,
        sortOrder: index + 1,
        schemaVersion: ENTITY_SCHEMA_VERSION,
        createdAt: timestamp,
        updatedAt: timestamp,
      })),
    );

    await db.appSettings.add({
      key: 'initialized',
      value: true,
      schemaVersion: ENTITY_SCHEMA_VERSION,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  });
}
