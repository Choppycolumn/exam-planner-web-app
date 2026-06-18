import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, BellRing, CalendarCheck, CheckCircle2, Clock, CloudSun, Filter, Mail, MessageCircle, Radio, RefreshCw, Send, TrendingUp } from 'lucide-react';
import { Page } from '../components/Page';
import { EmptyState } from '../components/EmptyState';
import { Toast } from '../components/Toast';
import { serverApi, type DailyBrief, type NotificationChannel, type NotificationEvent } from '../api/client';
import { queryClient, queryKeys } from '../api/queryClient';
import { useDashboardData } from '../hooks/useDashboardData';
import { minutesToHoursText } from '../utils/date';

function changeClass(value?: number) {
  if (!value) return 'text-slate-500';
  return value >= 0 ? 'text-emerald-600' : 'text-rose-600';
}

function BriefDetail({ brief }: { brief: DailyBrief }) {
  const weather = brief.payload.weather;
  const learning = brief.payload.learning;
  const markets = brief.payload.markets ?? [];
  const indexAssessment = brief.payload.indexPurchaseAssessment;

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-blue-700">{brief.date}</p>
          <h2 className="mt-1 text-xl font-semibold text-slate-950">{brief.title}</h2>
          <p className="mt-1 text-sm text-slate-500">生成时间：{new Date(brief.generatedAt).toLocaleString()}</p>
        </div>
        <div className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500">
          {brief.emailedAt ? `已邮件推送 ${new Date(brief.emailedAt).toLocaleString()}` : '尚未邮件推送'}
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-900"><CloudSun size={16} />天气</p>
          {weather?.ok ? (
            <>
              <p className="mt-3 text-2xl font-semibold text-slate-950">{weather.temperature}℃</p>
              <p className="mt-1 text-sm text-slate-600">{weather.cityName} · {weather.condition} · {weather.minTemperature}-{weather.maxTemperature}℃</p>
              <p className="mt-1 text-sm text-slate-500">降水概率 {weather.precipitationProbability ?? 0}%</p>
            </>
          ) : (
            <p className="mt-3 text-sm text-rose-600">天气获取失败：{weather?.error || '未知错误'}</p>
          )}
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-900"><CalendarCheck size={16} />学习提醒</p>
          <p className="mt-3 text-sm text-slate-600">昨日学习：{minutesToHoursText(learning?.yesterdayMinutes ?? 0)}</p>
          <p className="mt-1 text-sm text-slate-600">近 7 天累计：{minutesToHoursText(learning?.last7Minutes ?? 0)}</p>
          {learning?.activeGoal ? <p className="mt-1 text-sm text-slate-600">{learning.activeGoal.name} 剩余 {learning.activeGoal.daysLeft} 天</p> : null}
          {learning?.yesterdayReview?.problems ? <p className="mt-3 line-clamp-3 text-sm text-slate-500">昨日问题：{learning.yesterdayReview.problems}</p> : null}
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><TrendingUp size={16} />指数与资产</h3>
          <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
            <div className="grid grid-cols-[1fr_90px_90px] bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500">
              <span>名称</span>
              <span>最新</span>
              <span>涨跌</span>
            </div>
            {markets.length ? markets.map((item) => (
              <div key={`${item.name}-${item.symbol}`} className="grid grid-cols-[1fr_90px_90px] items-center border-t border-slate-100 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-800">{item.name}</p>
                  <p className="text-xs text-slate-500">{item.symbol}</p>
                </div>
                <span>{item.ok ? item.price : '--'}</span>
                <span className={changeClass(item.changePercent)}>{item.ok ? `${item.changePercent}%` : '失败'}</span>
              </div>
            )) : <div className="border-t border-slate-100 px-3 py-4 text-sm text-slate-500">暂无指数配置。</div>}
          </div>
        </div>

        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><CalendarCheck size={16} />今日待推进</h3>
          <div className="mt-3 space-y-2">
            {learning?.todayTasks?.length ? learning.todayTasks.map((task) => (
              <div key={task.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                <p className="text-sm font-semibold text-slate-800">{task.title}</p>
                <p className="mt-1 text-xs text-slate-500">到期：{task.dueDate} · {task.urgency}</p>
              </div>
            )) : <EmptyState title="今天没有到期任务" description="短期目标会在这里变成晨间提醒。" />}
          </div>
        </div>
      </div>

      {indexAssessment?.items?.length ? (
        <div className="mt-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><TrendingUp size={16} />美股指数定投评估</h3>
          <p className="mt-2 text-xs leading-5 text-slate-500">{indexAssessment.methodology}</p>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {indexAssessment.items.map((item) => (
              <div key={item.symbol} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{item.name}</p>
                    <p className="mt-1 text-xs text-slate-500">{item.symbol} · {item.asOf || '数据日期未知'}</p>
                  </div>
                  <span className="rounded bg-white px-2 py-1 text-xs font-semibold text-blue-700">{item.ok ? item.signal : '评估失败'}</span>
                </div>
                {item.ok ? (
                  <>
                    <p className="mt-3 text-sm text-slate-700">PE {item.pe}，近 5 年百分位 {item.pePercentile5}%，近 10 年百分位 {item.pePercentile10}%</p>
                    <p className="mt-1 text-sm text-slate-700">距 50/200 日均线 {item.sma50Margin}% / {item.sma200Margin}%</p>
                    <p className="mt-2 text-xs font-semibold text-blue-700">定投强度参考：{item.intensity}</p>
                    <p className="mt-2 text-xs leading-5 text-slate-500">{item.reasons?.join('；') || '指标处于中性区间'}</p>
                  </>
                ) : <p className="mt-3 text-sm text-rose-600">{item.error}</p>}
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-500">{indexAssessment.disclaimer}</p>
        </div>
      ) : null}
    </section>
  );
}

function severityClass(severity: string) {
  if (severity === 'critical') return 'border-rose-100 bg-rose-50 text-rose-700';
  if (severity === 'warning') return 'border-amber-100 bg-amber-50 text-amber-700';
  return 'border-blue-100 bg-blue-50 text-blue-700';
}

function NotificationEventRow({ event, onAck, readOnly }: { event: NotificationEvent; onAck: (id: number) => void; readOnly?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${severityClass(event.severity)}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{event.title}</p>
          <p className="mt-1 line-clamp-2 text-xs opacity-80">{event.content}</p>
          <p className="mt-2 text-xs opacity-70">{event.source} · {new Date(event.createdAt).toLocaleString()}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="rounded bg-white/70 px-2 py-1 text-xs font-semibold opacity-70">
            {event.severity === 'critical' ? '严重' : event.severity === 'warning' ? '预警' : '通知'}
          </span>
          <button className="rounded bg-white/70 px-2 py-1 text-xs font-semibold" disabled={readOnly} onClick={() => onAck(event.id)}>已处理</button>
        </div>
      </div>
    </div>
  );
}

function ChannelBadge({ channel }: { channel: NotificationChannel }) {
  return (
    <div className={`rounded-lg border px-3 py-2 text-sm ${channel.enabled ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-500'}`}>
      <p className="font-semibold">{channel.name}</p>
      <p className="mt-1 text-xs opacity-75">{channel.type} · {channel.enabled ? '已启用' : '预留'}</p>
    </div>
  );
}

export function NotificationsPage() {
  const { readOnly } = useDashboardData();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [toast, setToast] = useState('');
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'sent' | 'unsent' | 'failed'>('all');
  const [eventFilter, setEventFilter] = useState<'all' | 'warning' | 'critical'>('all');
  const [search, setSearch] = useState('');
  const [telegramToken, setTelegramToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [telegramUserId, setTelegramUserId] = useState('');
  const [telegramWebhookUrl, setTelegramWebhookUrl] = useState('');
  const { data: notificationData } = useQuery({
    queryKey: queryKeys.notifications(eventFilter),
    queryFn: () => serverApi.getNotificationCenter(eventFilter),
    placeholderData: { generatedAt: '', channels: [], events: [], deliveries: [], metrics: { total: 0, open: 0, warnings: 0, critical: 0 }, channelPlan: {}, readOnly: false },
  });
  const { data } = useQuery({
    queryKey: queryKeys.briefs,
    queryFn: () => serverApi.getBriefs(30),
    placeholderData: { briefs: [] as DailyBrief[] },
  });
  const briefs = useMemo(() => data?.briefs ?? [], [data?.briefs]);
  const stats = useMemo(() => ({
    total: briefs.length,
    sent: briefs.filter((brief) => brief.emailedAt).length,
    failed: briefs.filter((brief) => brief.emailError).length,
    unsent: briefs.filter((brief) => !brief.emailedAt).length,
  }), [briefs]);
  const visibleBriefs = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return briefs
      .filter((brief) => (filter === 'sent' ? Boolean(brief.emailedAt) : filter === 'unsent' ? !brief.emailedAt : filter === 'failed' ? Boolean(brief.emailError) : true))
      .filter((brief) => !keyword || `${brief.title} ${brief.date}`.toLowerCase().includes(keyword));
  }, [briefs, filter, search]);
  const selected = useMemo(() => visibleBriefs.find((brief) => brief.id === selectedId) ?? visibleBriefs[0] ?? null, [visibleBriefs, selectedId]);

  const refreshBriefs = async (preferred?: DailyBrief) => {
    const result = await serverApi.getBriefs(30);
    queryClient.setQueryData(queryKeys.briefs, result);
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
    queryClient.invalidateQueries({ queryKey: queryKeys.notifications(eventFilter) });
    setSelectedId(preferred?.id ?? result.briefs[0]?.id ?? null);
  };


  const generate = async (sendEmail = false, sendWechat = false) => {
    if (readOnly) return;
    setLoading(true);
    try {
      const result = await serverApi.generateBrief(sendEmail, sendWechat);
      await refreshBriefs(result.brief);
      setToast(sendWechat ? '简报已生成并尝试微信推送' : sendEmail ? '简报已生成并尝试邮件推送' : '今日简报已生成');
    } catch {
      setToast('简报生成失败，请稍后重试');
    } finally {
      setLoading(false);
      window.setTimeout(() => setToast(''), 2200);
    }
  };

  const testWechatPush = async () => {
    if (readOnly) return;
    setLoading(true);
    try {
      const result = await serverApi.testWechatNotification();
      queryClient.setQueryData(queryKeys.notifications('all'), result.center);
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications(eventFilter) });
      setToast(result.ok ? '微信测试推送已发送' : '微信测试推送失败');
    } catch {
      setToast('微信测试推送失败，请检查 OpenClaw 服务');
    } finally {
      setLoading(false);
      window.setTimeout(() => setToast(''), 2200);
    }
  };

  const acknowledgeEvent = async (id: number) => {
    if (readOnly) return;
    const result = await serverApi.acknowledgeNotification(id);
    queryClient.setQueryData(queryKeys.notifications('all'), result.center);
    queryClient.invalidateQueries({ queryKey: queryKeys.notifications(eventFilter) });
  };

  const retryDelivery = async (id: number) => {
    if (readOnly) return;
    const result = await serverApi.retryNotificationDelivery(id);
    queryClient.setQueryData(queryKeys.notifications('all'), result.center);
    queryClient.invalidateQueries({ queryKey: queryKeys.notifications(eventFilter) });
    setToast('失败通知已重新投递');
    window.setTimeout(() => setToast(''), 2200);
  };

  const testBarkPush = async () => {
    if (readOnly) return;
    setLoading(true);
    try {
      const result = await serverApi.testBarkNotification();
      queryClient.setQueryData(queryKeys.notifications('all'), result.center);
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications(eventFilter) });
      setToast('Bark 测试通知已进入发送队列');
    } catch {
      setToast('Bark 测试通知失败，请检查服务器配置');
    } finally {
      setLoading(false);
      window.setTimeout(() => setToast(''), 2200);
    }
  };

  const saveTelegram = async () => {
    if (readOnly) return;
    setLoading(true);
    try {
      const result = await serverApi.saveTelegramSettings({
        botToken: telegramToken,
        chatId: telegramChatId,
        allowedUserId: telegramUserId,
        webhookUrl: telegramWebhookUrl || window.location.origin,
      });
      queryClient.setQueryData(queryKeys.notifications('all'), result.center);
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications(eventFilter) });
      setTelegramToken('');
      setTelegramChatId('');
      setTelegramUserId('');
      setToast('Telegram 安全配置已保存');
    } catch {
      setToast('Telegram 配置保存失败');
    } finally {
      setLoading(false);
      window.setTimeout(() => setToast(''), 2200);
    }
  };

  const registerTelegram = async () => {
    if (readOnly) return;
    setLoading(true);
    try {
      const result = await serverApi.registerTelegramWebhook();
      queryClient.setQueryData(queryKeys.notifications('all'), result.center);
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications(eventFilter) });
      setToast('Telegram Webhook 与命令菜单已注册');
    } catch {
      setToast('Telegram 注册失败，请检查 Token、用户 ID 和代理');
    } finally {
      setLoading(false);
      window.setTimeout(() => setToast(''), 2600);
    }
  };

  const testTelegram = async () => {
    if (readOnly) return;
    setLoading(true);
    try {
      const result = await serverApi.testTelegramNotification();
      queryClient.setQueryData(queryKeys.notifications('all'), result.center);
      setToast('Telegram 测试消息已发送');
    } catch {
      setToast('Telegram 测试失败，请检查配置和代理');
    } finally {
      setLoading(false);
      window.setTimeout(() => setToast(''), 2400);
    }
  };

  const saveWechatPush = async (enabled: boolean) => {
    if (readOnly) return;
    setLoading(true);
    try {
      const result = await serverApi.saveWechatNotificationSettings(enabled, '08:00');
      queryClient.setQueryData(queryKeys.notifications('all'), result.center);
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications(eventFilter) });
      queryClient.invalidateQueries({ queryKey: queryKeys.briefSettings });
      setToast(enabled ? '微信每日 08:00 推送已启用' : '微信每日推送已暂停');
    } catch {
      setToast('微信推送设置保存失败');
    } finally {
      setLoading(false);
      window.setTimeout(() => setToast(''), 2200);
    }
  };

  const sendLatest = async () => {
    if (readOnly) return;
    setLoading(true);
    try {
      const result = await serverApi.sendLatestBrief();
      await refreshBriefs(result.brief);
      setToast('最新简报已邮件推送');
    } catch {
      setToast('邮件推送失败，请检查 SMTP 配置');
    } finally {
      setLoading(false);
      window.setTimeout(() => setToast(''), 2200);
    }
  };
  const wechat = notificationData?.wechatClawbot;
  const wechatReady = Boolean(wechat?.enabled && wechat.configured);
  const bark = notificationData?.bark;
  const barkReady = Boolean(bark?.enabled && bark.configured);
  const telegram = notificationData?.telegram;
  const telegramReady = Boolean(telegram?.configured && telegram.webhookConfigured);

  return (
    <Page title="通知中心" subtitle="每天早上聚合天气、指数涨跌和学习提醒，支持邮件与微信 ClawBot 推送。">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-primary" disabled={readOnly || loading} onClick={() => void generate(false)}>
            <RefreshCw size={16} />生成今日简报
          </button>
          <button className="btn btn-soft" disabled={readOnly || loading} onClick={() => void generate(false, true)}>
            <MessageCircle size={16} />生成并微信推送
          </button>
          <button className="btn btn-soft" disabled={readOnly || loading} onClick={() => void generate(true)}>
            <Send size={16} />生成并邮件推送
          </button>
          <button className="btn btn-soft" disabled={readOnly || loading} onClick={() => void sendLatest()}>
            <Mail size={16} />发送最新简报
          </button>
        </div>
        <p className="text-sm text-slate-500">微信每日推送固定使用 08:00，邮件 SMTP 在设置页配置。</p>
      </div>

      <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="flex items-center gap-2 text-xs font-semibold text-slate-500"><BellRing size={15} />事件总数</p>
          <p className="mt-1 text-2xl font-semibold text-slate-950">{notificationData?.metrics.total ?? 0}</p>
        </div>
        <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-blue-700">
          <p className="text-xs font-semibold opacity-80">最近 7 天</p>
          <p className="mt-1 text-2xl font-semibold">{notificationData?.metrics.open ?? 0}</p>
        </div>
        <div className="rounded-lg border border-amber-100 bg-amber-50 p-4 text-amber-700">
          <p className="flex items-center gap-2 text-xs font-semibold opacity-80"><AlertTriangle size={15} />预警</p>
          <p className="mt-1 text-2xl font-semibold">{notificationData?.metrics.warnings ?? 0}</p>
        </div>
        <div className="rounded-lg border border-rose-100 bg-rose-50 p-4 text-rose-700">
          <p className="text-xs font-semibold opacity-80">严重</p>
          <p className="mt-1 text-2xl font-semibold">{notificationData?.metrics.critical ?? 0}</p>
        </div>
      </div>

      <div className="mb-5 grid gap-4 xl:grid-cols-[1fr_360px]">
        <section className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">站内通知事件</h2>
              <p className="mt-1 text-sm text-slate-500">日报、报告、任务失败、磁盘预警和慢接口会进入统一通知模型。</p>
            </div>
            <div className="flex gap-2">
              {(['all', 'warning', 'critical'] as const).map((item) => (
                <button
                  key={item}
                  className={`rounded-lg border px-3 py-2 text-sm font-semibold ${eventFilter === item ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-600'}`}
                  type="button"
                  onClick={() => setEventFilter(item)}
                >
                  {item === 'warning' ? '预警' : item === 'critical' ? '严重' : '全部'}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-4 space-y-2">
            {notificationData?.events.length ? notificationData.events.map((event) => (
              <NotificationEventRow key={event.id} event={event} readOnly={readOnly} onAck={(id) => void acknowledgeEvent(id)} />
            )) : <EmptyState title="暂无通知事件" description="日报、报告或系统预警生成后会出现在这里。" />}
          </div>
          {notificationData?.deliveries?.some((delivery) => delivery.status === 'failed') ? (
            <div className="mt-4 rounded-lg border border-amber-100 bg-amber-50 p-3">
              <p className="text-sm font-semibold text-amber-800">失败投递</p>
              <div className="mt-2 space-y-2">
                {notificationData.deliveries.filter((delivery) => delivery.status === 'failed').slice(0, 5).map((delivery) => (
                  <div key={delivery.id} className="flex items-center justify-between gap-3 rounded bg-white/80 px-3 py-2 text-xs text-amber-800">
                    <span>{delivery.channelKey} · {delivery.error || '发送失败'}</span>
                    <button className="rounded border border-amber-200 bg-white px-2 py-1 font-semibold" disabled={readOnly} onClick={() => void retryDelivery(delivery.id)}>重新投递</button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        <section className="card p-5">
          <div className="flex items-center gap-2">
            <Radio size={16} className="text-blue-600" />
            <h2 className="text-base font-semibold text-slate-900">通知通道预备</h2>
          </div>
          <div className={`mt-4 rounded-lg border p-3 ${wechatReady ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-amber-100 bg-amber-50 text-amber-700'}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="flex items-center gap-2 text-sm font-semibold"><MessageCircle size={16} />微信 ClawBot</p>
                <p className="mt-1 text-xs opacity-80">
                  {wechatReady ? `每日 ${wechat?.scheduleTime ?? '08:00'} 自动推送，下一次 ${wechat?.nextPushAt ? new Date(wechat.nextPushAt).toLocaleString() : '待计算'}` : 'OpenClaw 账号或会话令牌未就绪'}
                </p>
              </div>
              <span className="rounded bg-white/70 px-2 py-1 text-xs font-semibold">{wechatReady ? '运行中' : '待检查'}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="rounded-lg border border-white/70 bg-white/80 px-3 py-2 text-xs font-semibold transition hover:bg-white" disabled={readOnly || loading} onClick={() => void testWechatPush()}>
                <MessageCircle size={14} />立即测试
              </button>
              <button className="rounded-lg border border-white/70 bg-white/80 px-3 py-2 text-xs font-semibold transition hover:bg-white" disabled={readOnly || loading} onClick={() => void saveWechatPush(!wechat?.enabled)}>
                <Clock size={14} />{wechat?.enabled ? '暂停每日推送' : '启用每日 08:00'}
              </button>
            </div>
          </div>
          <div className={`mt-3 rounded-lg border p-3 ${barkReady ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="flex items-center gap-2 text-sm font-semibold"><BellRing size={16} />Bark iOS</p>
                <p className="mt-1 text-xs opacity-80">
                  {barkReady ? `已连接 ${bark?.serverUrl}，与微信并行推送` : '服务器尚未配置 Bark Device Key'}
                </p>
              </div>
              <span className="rounded bg-white/70 px-2 py-1 text-xs font-semibold">{barkReady ? '运行中' : '未配置'}</span>
            </div>
            <div className="mt-3">
              <button className="rounded-lg border border-white/70 bg-white/80 px-3 py-2 text-xs font-semibold transition hover:bg-white" disabled={readOnly || loading || !barkReady} onClick={() => void testBarkPush()}>
                <BellRing size={14} />立即测试
              </button>
            </div>
          </div>
          <div className={`mt-3 rounded-lg border p-3 ${telegramReady ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-blue-100 bg-blue-50 text-blue-800'}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="flex items-center gap-2 text-sm font-semibold"><Send size={16} />Telegram Bot</p>
                <p className="mt-1 text-xs opacity-80">
                  {telegramReady ? '通知、待办助手与受限运维控制台已就绪' : '配置 Token、Chat ID 与授权用户后注册 Webhook'}
                </p>
              </div>
              <span className="rounded bg-white/70 px-2 py-1 text-xs font-semibold">{telegramReady ? '运行中' : '待配置'}</span>
            </div>
            <div className="mt-3 grid gap-2">
              <input className="input text-xs" type="password" value={telegramToken} onChange={(event) => setTelegramToken(event.target.value)} placeholder={telegram?.tokenConfigured ? `Bot Token 已配置，尾号 ${telegram.tokenLast4}` : 'Bot Token'} />
              <div className="grid gap-2 sm:grid-cols-2">
                <input className="input text-xs" value={telegramChatId} onChange={(event) => setTelegramChatId(event.target.value)} placeholder={telegram?.chatIdConfigured ? `Chat ID 已配置，尾号 ${telegram.chatIdLast4}` : 'Chat ID'} />
                <input className="input text-xs" value={telegramUserId} onChange={(event) => setTelegramUserId(event.target.value)} placeholder={telegram?.allowedUserIdConfigured ? `授权用户已配置，尾号 ${telegram.allowedUserIdLast4}` : '授权用户 ID'} />
              </div>
              <input className="input text-xs" value={telegramWebhookUrl} onChange={(event) => setTelegramWebhookUrl(event.target.value)} placeholder={telegram?.webhookUrl || window.location.origin} />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="rounded-lg border border-white/70 bg-white/80 px-3 py-2 text-xs font-semibold" disabled={readOnly || loading} onClick={() => void saveTelegram()}>保存配置</button>
              <button className="rounded-lg border border-white/70 bg-white/80 px-3 py-2 text-xs font-semibold" disabled={readOnly || loading || !telegram?.configured} onClick={() => void registerTelegram()}>注册 Webhook</button>
              <button className="rounded-lg border border-white/70 bg-white/80 px-3 py-2 text-xs font-semibold" disabled={readOnly || loading || !telegram?.configured} onClick={() => void testTelegram()}>立即测试</button>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            {(notificationData?.channels ?? []).map((channel) => <ChannelBadge key={channel.channelKey} channel={channel} />)}
          </div>
        </section>
      </div>

      <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="flex items-center gap-2 text-xs font-semibold text-slate-500"><BellRing size={15} />简报总数</p>
          <p className="mt-1 text-2xl font-semibold text-slate-950">{stats.total}</p>
        </div>
        <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-4 text-emerald-700">
          <p className="flex items-center gap-2 text-xs font-semibold opacity-80"><CheckCircle2 size={15} />已推送</p>
          <p className="mt-1 text-2xl font-semibold">{stats.sent}</p>
        </div>
        <div className="rounded-lg border border-amber-100 bg-amber-50 p-4 text-amber-700">
          <p className="text-xs font-semibold opacity-80">未推送</p>
          <p className="mt-1 text-2xl font-semibold">{stats.unsent}</p>
        </div>
        <div className="rounded-lg border border-rose-100 bg-rose-50 p-4 text-rose-700">
          <p className="text-xs font-semibold opacity-80">推送失败</p>
          <p className="mt-1 text-2xl font-semibold">{stats.failed}</p>
        </div>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Filter size={16} className="text-slate-500" />
        {(['all', 'sent', 'unsent', 'failed'] as const).map((item) => (
          <button
            key={item}
            type="button"
            className={`rounded-lg border px-3 py-2 text-sm font-semibold ${filter === item ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
            onClick={() => setFilter(item)}
          >
            {item === 'all' ? '全部' : item === 'sent' ? '已推送' : item === 'unsent' ? '未推送' : '失败'}
          </button>
        ))}
        <input className="field w-full md:ml-auto md:w-64" placeholder="搜索标题或日期" value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>

      {selected ? (
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <div className="space-y-2">
            {visibleBriefs.map((brief) => (
              <button
                key={brief.id}
                className={`w-full rounded-lg border p-3 text-left transition ${
                  selected.id === brief.id ? 'border-blue-200 bg-blue-50 text-blue-800' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                }`}
                onClick={() => setSelectedId(brief.id)}
              >
                <p className="text-sm font-semibold">{brief.title}</p>
                <p className="mt-1 text-xs opacity-70">{new Date(brief.generatedAt).toLocaleString()}</p>
                <p className="mt-2 text-xs opacity-70">{brief.emailedAt ? '已邮件推送' : '未邮件推送'}</p>
              </button>
            ))}
          </div>
          <BriefDetail brief={selected} />
        </div>
      ) : (
        <EmptyState title="还没有晨间简报" description="点击生成今日简报后，这里会显示天气、指数和学习提醒。" />
      )}
      {toast ? <Toast message={toast} /> : null}
    </Page>
  );
}
