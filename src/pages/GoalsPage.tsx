import { GoalsManager } from '../components/GoalsManager';
import { Page } from '../components/Page';

export function GoalsPage() {
  return (
    <Page title="长期目标" subtitle="管理启用目标、分数目标和考研截止日期。">
      <GoalsManager />
    </Page>
  );
}
