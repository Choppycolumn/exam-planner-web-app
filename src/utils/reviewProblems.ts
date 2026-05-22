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
    keywords: ['英语阅读', '阅读理解', '真题阅读', '长难句', '英语读不懂', '阅读读不懂', '阅读正确率', '英语正确率', '阅读准确率', '阅读错', '阅读速度', '英语真题', '英语一阅读'],
  },
  {
    id: 'professional-course',
    label: '专业课推进偏慢',
    keywords: ['专业课', '专业课进度慢', '专业课进度较慢', '专业课没看', '专业课没学', '专业课听课', '信号与系统', '通信原理', '数据结构', '操作系统', '计算机网络', '计算机组成', '计组', '408'],
  },
  {
    id: 'math-errors',
    label: '数学错题 / 概念计算',
    keywords: ['数学错', '高数错', '线代错', '线性代数错', '概率错', '错题', '错太多', '做错', '算错', '计算错误', '计算失误', '公式', '概念', '题错', '不会做', '不会算'],
  },
  {
    id: 'method-review',
    label: '复习方法 / 错题闭环',
    keywords: ['复习不到位', '没有复习', '没复习', '二刷', '回顾少', '整理少', '错题整理', '错题没整理', '笔记没整理', '知识点不熟', '框架不清', '方法不对', '只听课不练题', '只看不练'],
  },
  {
    id: 'memory-recall',
    label: '记忆背诵 / 回忆不足',
    keywords: ['背不下来', '背不完', '没背', '没记住', '记不住', '忘得快', '回忆不出来', '默写错', '单词忘', '单词没背', '背诵慢'],
  },
  {
    id: 'planning',
    label: '计划执行 / 时间安排',
    keywords: ['计划', '安排', '时间不够', '没完成', '未完成', '没看', '没学', '没做', '没复习', '没开始', '没推进', '没碰', '没刷', '没练', '没整理', '赶不上', '效率低', '效率低下', '效率不高', '执行', '任务', '拖到', '来不及'],
  },
  {
    id: 'energy',
    label: '作息精力状态',
    keywords: ['困', '睡眠', '熬夜', '起晚', '疲惫', '累', '状态差', '精力', '头疼', '生病', '晚睡', '犯困', '没精神'],
  },
  {
    id: 'emotion-pressure',
    label: '情绪压力 / 心态波动',
    keywords: ['焦虑', '压力大', '烦躁', '心态崩', '崩溃', '沮丧', '自责', '急躁', '慌', '怕来不及', '心态不好'],
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

const isStudyNotDoneText = (text: string) => {
  const subjectPattern = /(高数|高等数学|线代|线性代数|概率|数学|英语阅读|阅读|专业课|政治|单词|真题|错题|课程|章节|知识点|笔记|背诵)/;
  const notDonePattern = /(没看|没学|没做|没复习|没开始|没推进|没碰|没刷|没练|没背|没记|没整理|未看|未学|未做|未复习|未开始|未推进|未整理)/;
  return (subjectPattern.test(text) && notDonePattern.test(text)) || /(又没看|还是没看|还没看|没怎么看|没来得及看)/.test(text);
};

const themeMatchesText = (text: string, theme: ProblemTheme) => {
  if (theme.id === 'planning' && isStudyNotDoneText(text)) return true;
  if (theme.id === 'math-errors') {
    const hasMath = /(数学|高数|高等数学|线代|线性代数|概率)/.test(text);
    const hasError = /(错|计算|算错|公式|概念|题|不会做|不会算|证明|推导)/.test(text);
    return /(计算错误|计算失误|错题|错太多|题错|算错)/.test(text) || (hasMath && hasError);
  }
  if (theme.id === 'english-reading') {
    return /(英语|英一|英语一|阅读理解|真题阅读|长难句)/.test(text) && /(阅读|长难句|读不懂|正确率|准确率|错|速度|真题)/.test(text);
  }
  if (theme.id === 'professional-course') {
    return /(专业课|信号与系统|通信原理|数据结构|操作系统|计算机网络|计算机组成|计组|408)/.test(text);
  }
  if (theme.id === 'method-review') {
    return /(复习|回顾|整理|错题|笔记|知识点|框架|方法|二刷|闭环|只听课|只看不练|只听不练)/.test(text)
      && /(不到位|不熟|不清|不对|少|没|未|忘|漏|断|弱|低|慢)/.test(text);
  }
  if (theme.id === 'memory-recall') {
    return /(背|记|忘|回忆|默写|单词|词汇)/.test(text) && /(不下来|不完|不住|忘|慢|错|少|没|未)/.test(text);
  }
  return Boolean(findKeyword(text, theme.keywords));
};

const getMatchedExample = (review: ReviewProblemSource, theme: ProblemTheme): ReviewProblemExample | null => {
  for (const field of reviewProblemFields) {
    const text = review[field.key];
    if (text && themeMatchesText(text, theme)) {
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
