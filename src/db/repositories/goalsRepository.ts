import type { Goal } from '../../types/models';
import { nowISO } from '../../utils/date';
import { db } from '../database';
import { ENTITY_SCHEMA_VERSION } from '../schema';

export const goalsRepository = {
  table: db.goals,
  async getActive() {
    return db.goals.filter((goal) => goal.isActive).first();
  },
  async save(goal: Partial<Goal>) {
    const timestamp = nowISO();
    if (goal.isActive) {
      await db.goals.filter((item) => item.id !== goal.id && item.isActive).modify({ isActive: false, updatedAt: timestamp });
    }
    if (goal.id) {
      await db.goals.update(goal.id, { ...goal, updatedAt: timestamp });
      return goal.id;
    }
    return db.goals.add({
      name: goal.name ?? '',
      description: goal.description ?? '',
      deadline: goal.deadline ?? '',
      isActive: goal.isActive ?? true,
      type: goal.type ?? '考研',
      notes: goal.notes ?? '',
      schemaVersion: ENTITY_SCHEMA_VERSION,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  },
  async activate(id: number) {
    const timestamp = nowISO();
    await db.transaction('rw', db.goals, async () => {
      await db.goals.toCollection().modify({ isActive: false, updatedAt: timestamp });
      await db.goals.update(id, { isActive: true, updatedAt: timestamp });
    });
  },
  async remove(id: number) {
    await db.goals.delete(id);
  },
};
