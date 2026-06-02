import type { ShortTermTask } from '../../types/models';
import { notifyDataChanged, serverApi } from '../../api/client';
import type { DashboardData } from '../../api/client';
import { queryClient, queryKeys } from '../../api/queryClient';
import { todayISO } from '../../utils/date';

function updateDashboardTasks(updater: (tasks: ShortTermTask[]) => ShortTermTask[]) {
  queryClient.setQueryData<DashboardData | undefined>(queryKeys.dashboard, (current) => {
    if (!current) return current;
    return { ...current, visibleTasks: updater(current.visibleTasks ?? []) };
  });
}

export const tasksRepository = {
  async save(task: Partial<ShortTermTask>) {
    const optimisticTask: ShortTermTask = {
      id: -Date.now(),
      title: task.title ?? '',
      dueDate: task.dueDate ?? todayISO(),
      dueTime: task.dueTime ?? '',
      urgency: task.urgency ?? 'medium',
      isCompleted: Boolean(task.isCompleted),
      completedAt: task.completedAt,
      reminderEnabled: Boolean(task.reminderEnabled ?? task.dueTime),
      reminderSentOffsets: task.reminderSentOffsets ?? [],
      reminderLastSentAt: task.reminderLastSentAt,
      note: task.note ?? '',
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    updateDashboardTasks((tasks) => [optimisticTask, ...tasks]);
    const id = await serverApi.saveTask(task);
    notifyDataChanged();
    return id;
  },
  async toggleComplete(task: ShortTermTask, completed: boolean) {
    if (!task.id) return;
    updateDashboardTasks((tasks) => tasks.map((item) => (
      item.id === task.id
        ? { ...item, isCompleted: completed, completedAt: completed ? new Date().toISOString() : undefined, updatedAt: new Date().toISOString() }
        : item
    )));
    await serverApi.toggleTask(task, completed);
    notifyDataChanged();
  },
  async remove(id: number) {
    updateDashboardTasks((tasks) => tasks.filter((task) => task.id !== id));
    await serverApi.removeTask(id);
    notifyDataChanged();
  },
};
