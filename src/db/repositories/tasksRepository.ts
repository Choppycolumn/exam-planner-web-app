import type { ShortTermTask } from '../../types/models';
import { notifyDataChanged, serverApi } from '../../api/client';

export const tasksRepository = {
  async save(task: Partial<ShortTermTask>) {
    const id = await serverApi.saveTask(task);
    notifyDataChanged();
    return id;
  },
  async toggleComplete(task: ShortTermTask, completed: boolean) {
    if (!task.id) return;
    await serverApi.toggleTask(task, completed);
    notifyDataChanged();
  },
  async remove(id: number) {
    await serverApi.removeTask(id);
    notifyDataChanged();
  },
};
