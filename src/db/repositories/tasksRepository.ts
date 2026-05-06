import type { ShortTermTask } from '../../types/models';
import { nowISO } from '../../utils/date';
import { db } from '../database';
import { ENTITY_SCHEMA_VERSION } from '../schema';

export const tasksRepository = {
  table: db.shortTermTasks,
  async save(task: Partial<ShortTermTask>) {
    const timestamp = nowISO();
    if (task.id) {
      await db.shortTermTasks.update(task.id, { ...task, updatedAt: timestamp });
      return task.id;
    }

    return db.shortTermTasks.add({
      title: task.title ?? '',
      dueDate: task.dueDate ?? '',
      urgency: task.urgency ?? 'medium',
      isCompleted: false,
      completedAt: undefined,
      note: task.note ?? '',
      schemaVersion: ENTITY_SCHEMA_VERSION,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  },
  async toggleComplete(task: ShortTermTask, completed: boolean) {
    if (!task.id) return;
    await db.shortTermTasks.update(task.id, {
      isCompleted: completed,
      completedAt: completed ? nowISO() : undefined,
      updatedAt: nowISO(),
    });
  },
  async remove(id: number) {
    await db.shortTermTasks.delete(id);
  },
};
