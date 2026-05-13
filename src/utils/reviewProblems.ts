import type { CommonProblemSummary, ReviewProblemExample } from '../types/reports';

export interface ReviewProblemSource {
  date: string;
  summary?: string | null;
  wins?: string | null;
  problems?: string | null;
  tomorrowPlan?: string | null;
}

type ProblemTheme = {
  id: string;
  label: string;
  keywords: string[];
};

type ReviewProblemField = {
  key: keyof Pick<ReviewProblemSource, 'summary' | 'problems' | 'tomorrowPlan'>;
  label: string;
};

const problemThemes: ProblemTheme[] = [
  {
    id: 'attention',
    label: '注意力分散 / 拖延',
    keywords: ['拖延', '拖拉', '分心', '走神', '浮躁', '静不下心', '手机', '短视频', '娱乐', '娱乐时间', '摸鱼', '专注度', '注意力', '控制不住', '微信', '小红书', '抖音', '视频号', 'b站', 'B站', 'bilibili', '刷视频', '刷手机', '刷了'],
  },
  {
    id: 'english-reading',
    label: '英语阅读问题',
    keywords: ['英语阅读', '阅读理解', '真题阅读', '长难句', '读不懂', '正确率', '准确率', '阅读错', '阅读速度', '英语真题'],
  },
  {
    id: 'professional-course',
    label: '专业课推进偏慢',
    keywords: ['专业课', '进度慢', '进度较慢', '进度有点慢', '听课', '章节', '课程', '信号与系统', '背诵慢'],
  },
  {
    id: 'math-errors',
    label: '数学错题 / 概念计算',
    keywords: ['数学', '高数', '高等数学', '线代', '线性代数', '概率', '错题', '计算错误', '计算', '公式', '概念', '题错'],
  },
  {
    id: 'planning',
    label: '计划执行 / 时间安排',
    keywords: ['计划', '安排', '时间不够', '没完成', '未完成', '赶不上', '效率', '效率低', '效率低下', '效率不高', '执行', '任务', '拖到'],
  },
  {
    id: 'energy',
    label: '作息精力状态',
    keywords: ['困', '睡眠', '熬夜', '起晚', '疲惫', '累', '状态差', '精力', '头疼', '生病', '晚睡'],
  },
  {
    id: 'exam-assignment',
    label: '考试作业压力',
    keywords: ['考试', '作业', '报告', '论文', '实验', 'ddl', '截止', '结课', '复习不过来'],
  },
  {
    id: 'review-gap',
    label: '复盘记录缺失 / 反馈不足',
    keywords: ['没复盘', '复盘少', '总结少', '没有总结', '没有记录', '忘记记录', '记录少'],
  },
];

const reviewProblemFields: ReviewProblemField[] = [
  { key: 'problems', label: '今日问题' },
  { key: 'summary', label: '今日总结' },
  { key: 'tomorrowPlan', label: '明日计划' },
];

const normalizeText = (value: unknown) => String(value ?? '').toLowerCase();

const compactText = (value: unknown, maxLength = 80) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};

const findKeyword = (text: string, keywords: string[]) => {
  const normalized = normalizeText(text);
  return keywords.find((keyword) => normalized.includes(keyword.toLowerCase()));
};

const getMatchedExample = (review: ReviewProblemSource, theme: ProblemTheme): ReviewProblemExample | null => {
  for (const field of reviewProblemFields) {
    const text = review[field.key];
    if (text && findKeyword(text, theme.keywords)) {
      return {
        date: review.date,
        field: field.label,
        text: compactText(text),
      };
    }
  }
  return null;
};

export const getReviewProblemThemes = (reviews: ReviewProblemSource[], limit = 6): CommonProblemSummary[] =>
  problemThemes
    .map((theme) => {
      const dates = new Set<string>();
      const examples: ReviewProblemExample[] = [];

      reviews.forEach((review) => {
        const matched = getMatchedExample(review, theme);
        if (!matched) return;
        dates.add(review.date);
        if (examples.length < 3) examples.push(matched);
      });

      return {
        id: theme.id,
        label: theme.label,
        count: dates.size,
        dates: Array.from(dates).sort(),
        keywords: theme.keywords,
        examples,
      };
    })
    .filter((item) => item.count > 0)
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return (b.dates[b.dates.length - 1] ?? '').localeCompare(a.dates[a.dates.length - 1] ?? '');
    })
    .slice(0, limit);
