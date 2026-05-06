import type { Goal } from '../../types/models';
import { notifyDataChanged, serverApi } from '../../api/client';

export const goalsRepository = {
  async getActive() {
    const state = await serverApi.getState();
    return state.goals.find((goal) => goal.isActive);
  },
  async save(goal: Partial<Goal>) {
    const id = await serverApi.saveGoal(goal);
    notifyDataChanged();
    return id;
  },
  async activate(id: number) {
    await serverApi.activateGoal(id);
    notifyDataChanged();
  },
  async remove(id: number) {
    await serverApi.removeGoal(id);
    notifyDataChanged();
  },
};
