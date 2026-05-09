import { ChartBox, DistributionPie, TrendLine } from './Charts';
import { EmptyState } from './EmptyState';

export function DashboardCharts({
  distribution,
  trend,
}: {
  distribution: Array<{ name: string; value: number }>;
  trend: Array<{ date: string; minutes: number }>;
}) {
  return (
    <div className="mt-6 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
      <ChartBox title="今日时间分布">
        {distribution.length ? <DistributionPie data={distribution} /> : <EmptyState title="今天还没有填写学习时间" description="从学习时间页面录入后，这里会自动生成分布图。" />}
      </ChartBox>
      <ChartBox title="最近 7 天学习趋势">
        <TrendLine data={trend} />
      </ChartBox>
    </div>
  );
}
