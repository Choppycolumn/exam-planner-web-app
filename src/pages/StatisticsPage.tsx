import { useEffect, useState } from 'react';
import { ChartBox, DistributionPie, MinutesBar, TrendLine } from '../components/Charts';
import { EmptyState } from '../components/EmptyState';
import { MetricCard } from '../components/MetricCard';
import { Page } from '../components/Page';
import { serverApi, type StatisticsSummary } from '../api/client';
import { minutesToHoursText, todayISO } from '../utils/date';

const emptySummary: StatisticsSummary = {
  today: todayISO(),
  todayTotal: 0,
  distribution: [],
  last7: [],
  last30: [],
};

export function StatisticsPage() {
  const [summary, setSummary] = useState<StatisticsSummary>(emptySummary);

  useEffect(() => {
    let active = true;
    const load = () => serverApi.getStatisticsSummary().then((next) => {
      if (active) setSummary(next);
    }).catch(() => {
      if (active) setSummary(emptySummary);
    });
    void load();
    window.addEventListener('server-data-changed', load);
    return () => {
      active = false;
      window.removeEventListener('server-data-changed', load);
    };
  }, []);

  return (
    <Page title="数据统计" subtitle="用学习时间数据看投入结构和近期趋势。">
      <div className="mb-5 grid gap-4 md:grid-cols-3">
        <MetricCard label="今日学习" value={minutesToHoursText(summary.todayTotal)} />
        <MetricCard label="7 天合计" value={minutesToHoursText(summary.last7.reduce((sum, item) => sum + item.minutes, 0))} />
        <MetricCard label="30 天项目数" value={`${summary.last30.length} 项`} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <ChartBox title="当天时间分布饼图">{summary.distribution.length ? <DistributionPie data={summary.distribution} /> : <EmptyState title="暂无今日数据" />}</ChartBox>
        <ChartBox title="当天各项目用时柱状图">{summary.distribution.length ? <MinutesBar data={summary.distribution.map((item) => ({ name: item.name, minutes: item.value }))} /> : <EmptyState title="暂无今日数据" />}</ChartBox>
        <ChartBox title="最近 7 天总学习时长折线图"><TrendLine data={summary.last7} /></ChartBox>
        <ChartBox title="最近 30 天各项目累计用时">{summary.last30.length ? <MinutesBar data={summary.last30} denseLabels /> : <EmptyState title="暂无 30 天数据" />}</ChartBox>
      </div>
    </Page>
  );
}
