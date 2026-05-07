import { ChartBox, DistributionPie, MinutesBar, TrendLine } from '../components/Charts';
import { EmptyState } from '../components/EmptyState';
import { MetricCard } from '../components/MetricCard';
import { Page } from '../components/Page';
import { useAppData } from '../hooks/useAppData';
import { minutesToHoursText, todayISO } from '../utils/date';
import { getDailyProjectDistribution, getDailyTotalMinutes, getLast30DaysProjectTotals, getLast7DaysTotals } from '../utils/statistics';

export function StatisticsPage() {
  const { studyRecords } = useAppData();
  const today = todayISO();
  const todayTotal = getDailyTotalMinutes(studyRecords, today);
  const distribution = getDailyProjectDistribution(studyRecords, today);
  const last7 = getLast7DaysTotals(studyRecords);
  const last30 = getLast30DaysProjectTotals(studyRecords);

  return (
    <Page title="数据统计" subtitle="用学习时间数据看投入结构和近期趋势。">
      <div className="mb-5 grid gap-4 md:grid-cols-3">
        <MetricCard label="今日学习" value={minutesToHoursText(todayTotal)} />
        <MetricCard label="7 天合计" value={minutesToHoursText(last7.reduce((sum, item) => sum + item.minutes, 0))} />
        <MetricCard label="30 天项目数" value={`${last30.length} 项`} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <ChartBox title="当天时间分布饼图">{distribution.length ? <DistributionPie data={distribution} /> : <EmptyState title="暂无今日数据" />}</ChartBox>
        <ChartBox title="当天各项目用时柱状图">{distribution.length ? <MinutesBar data={distribution.map((item) => ({ name: item.name, minutes: item.value }))} /> : <EmptyState title="暂无今日数据" />}</ChartBox>
        <ChartBox title="最近 7 天总学习时长折线图"><TrendLine data={last7} /></ChartBox>
        <ChartBox title="最近 30 天各项目累计用时">{last30.length ? <MinutesBar data={last30} denseLabels /> : <EmptyState title="暂无 30 天数据" />}</ChartBox>
      </div>
    </Page>
  );
}
