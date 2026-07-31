export function installReportRulesDomain(runtime, exposeRuntime) {
    const ownerUserId = () => runtime.userAccountRepository.getOwnerUserId();
    const isOwnerUser = (userId) => Number(userId) === ownerUserId();
    function minutesText(minutes) {
        const value = Math.max(0, Number(minutes || 0));
        const hours = Math.floor(value / 60);
        const rest = value % 60;
        if (hours && rest)
            return `${hours} 小时 ${rest} 分钟`;
        if (hours)
            return `${hours} 小时`;
        return `${rest} 分钟`;
    }
    function dateRange(start, end) {
        const days = [];
        for (let current = start; current <= end; current = runtime.addDaysISO(current, 1)) {
            days.push(current);
        }
        return days;
    }
    function compactText(value = '', maxLength = 120) {
        const text = String(value || '').replace(/\s+/g, ' ').trim();
        return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
    }
    const reviewProblemThemes = [
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
    const reviewProblemFields = [
        { key: 'problems', label: '今日问题' },
        { key: 'summary', label: '今日总结' },
        { key: 'tomorrowPlan', label: '明日计划' },
    ];
    function getErrorThemeOptions() {
        return reviewProblemThemes.map((theme) => ({ id: theme.id, label: theme.label }));
    }
    function themeOptionById(themeId) {
        return getErrorThemeOptions().find((theme) => theme.id === themeId) || null;
    }
    function textIncludesKeyword(text, keywords) {
        const normalized = String(text || '').toLowerCase();
        return keywords.some((keyword) => normalized.includes(String(keyword).toLowerCase()));
    }
    function matchedProblemExample(review, theme) {
        for (const field of reviewProblemFields) {
            const text = review[field.key] || '';
            for (const sentence of splitReviewSentences(text)) {
                const matched = classifyReviewSegment(sentence, field.key);
                if (matched?.theme.id === theme.id) {
                    return { date: review.date, field: field.label, text: compactText(sentence, 80) };
                }
            }
        }
        return null;
    }
    function buildReviewProblemSummary(reviews, limit = 6) {
        return reviewProblemThemes
            .map((theme) => {
            const dates = new Set();
            const examples = [];
            for (const review of reviews) {
                const example = matchedProblemExample(review, theme);
                if (!example)
                    continue;
                dates.add(review.date);
                if (examples.length < 3)
                    examples.push(example);
            }
            const sortedDates = Array.from(dates).sort();
            return {
                id: theme.id,
                label: theme.label,
                count: sortedDates.length,
                dates: sortedDates,
                keywords: theme.keywords,
                examples,
            };
        })
            .filter((item) => item.count > 0)
            .sort((a, b) => {
            if (b.count !== a.count)
                return b.count - a.count;
            return (b.dates[b.dates.length - 1] || '').localeCompare(a.dates[a.dates.length - 1] || '');
        })
            .slice(0, limit);
    }
    function splitReviewSentences(text) {
        return String(text || '')
            .split(/[。！？!?；;，,、\s\n\r]+/)
            .map((item) => compactText(item, 120))
            .filter((item) => item.length >= 2);
    }
    function keywordMatches(text, keywords) {
        const normalized = String(text || '').toLowerCase();
        return keywords.filter((keyword) => normalized.includes(String(keyword).toLowerCase()));
    }
    function looksLikeResolvedStatement(text, keyword) {
        const normalized = String(text || '').toLowerCase();
        const normalizedKeyword = String(keyword).toLowerCase();
        const index = normalized.indexOf(normalizedKeyword);
        if (index < 0)
            return false;
        const prefix = normalized.slice(Math.max(0, index - 5), index);
        return /(没有|沒|未|不再|无|避免了|克服了|减少了|改善了)/.test(prefix);
    }
    function classifyReviewSegment(segment, fieldKey) {
        const normalizedSegment = String(segment || '');
        const planningTheme = reviewProblemThemes.find((theme) => theme.id === 'planning');
        if (planningTheme && isStudyNotDoneSegment(normalizedSegment)) {
            const fieldWeight = fieldKey === 'problems' ? 0.16 : fieldKey === 'tomorrowPlan' ? 0.08 : 0;
            return { theme: planningTheme, confidence: Math.min(0.96, 0.78 + fieldWeight), matchedKeywords: ['没看'] };
        }
        const candidates = [];
        for (const theme of reviewProblemThemes) {
            if (theme.id === 'math-errors' && !isMathErrorSegment(normalizedSegment))
                continue;
            if (theme.id === 'english-reading' && !isEnglishReadingSegment(normalizedSegment))
                continue;
            if (theme.id === 'professional-course' && !isProfessionalCourseSegment(normalizedSegment))
                continue;
            if (theme.id === 'method-review' && !isLearningMethodSegment(normalizedSegment))
                continue;
            if (theme.id === 'memory-recall' && !isMemoryRecallSegment(normalizedSegment))
                continue;
            if (theme.id === 'planning' && !isPlanningSegment(normalizedSegment))
                continue;
            const matches = keywordMatches(segment, theme.keywords)
                .filter((keyword) => !looksLikeResolvedStatement(segment, keyword));
            if (!matches.length)
                continue;
            const fieldWeight = fieldKey === 'problems' ? 0.16 : fieldKey === 'tomorrowPlan' ? 0.08 : 0;
            const confidence = Math.min(0.96, Math.round((0.5 + fieldWeight + matches.length * 0.12) * 100) / 100);
            candidates.push({ theme, confidence, matchedKeywords: matches });
        }
        return candidates.sort((a, b) => b.confidence - a.confidence)[0] || null;
    }
    function sentenceHash(text) {
        return runtime.createHash('sha256').update(String(text || '')).digest('hex');
    }
    function segmentKey(segment) {
        return `${segment.reviewId}|${segment.field}|${segment.sentenceHash}`;
    }
    function extractReviewProblemSegments(reviews) {
        const fields = reviewProblemFields;
        const segments = [];
        for (const review of reviews) {
            for (const field of fields) {
                for (const sentence of splitReviewSentences(review[field.key])) {
                    segments.push({
                        reviewId: Number(review.id),
                        date: review.date,
                        fieldKey: field.key,
                        field: field.label,
                        sentence,
                        sentenceHash: sentenceHash(sentence),
                    });
                }
            }
        }
        return segments;
    }
    function hasProblemCue(segment, fieldKey) {
        if (fieldKey === 'problems')
            return true;
        const text = String(segment || '');
        const negativeCue = /(问题|错误|错|慢|拖|没|未|不足|不会|不懂|卡住|卡了|低下|不高|较差|太差|难|困|熬夜|分心|走神|不集中|不太集中|集中不了|浮躁|静不下心|没啥状态|状态不好|状态差|抖音|微信|小红书|视频号|刷视频|刷手机|效率低|效率低下|效率不高)/;
        if (fieldKey === 'tomorrowPlan') {
            return negativeCue.test(text) || /(卸载|关闭|限制).*(抖音|微信|小红书|视频号|手机)/.test(text);
        }
        return negativeCue.test(text);
    }
    function isStudyNotDoneSegment(segment) {
        const text = String(segment || '');
        const subjectPattern = /(高数|高等数学|线代|线性代数|概率|数学|英语阅读|阅读|专业课|政治|单词|真题|错题|课程|章节|知识点|笔记|背诵)/;
        const notDonePattern = /(没看|没学|没做|没复习|没开始|没推进|没碰|没刷|没练|没背|没记|没整理|未看|未学|未做|未复习|未开始|未推进|未整理)/;
        return (subjectPattern.test(text) && notDonePattern.test(text)) || /(又没看|还是没看|还没看|没怎么看|没来得及看)/.test(text);
    }
    function isEnglishReadingSegment(segment) {
        const text = String(segment || '');
        return /(英语|英一|英语一|阅读理解|真题阅读|长难句)/.test(text) && /(阅读|长难句|读不懂|正确率|准确率|错|速度|真题)/.test(text);
    }
    function isProfessionalCourseSegment(segment) {
        const text = String(segment || '');
        return /(专业课|信号与系统|通信原理|数据结构|操作系统|计算机网络|计算机组成|计组|408)/.test(text);
    }
    function isMathErrorSegment(segment) {
        const text = String(segment || '');
        const mathSubjectPattern = /(数学|高数|高等数学|线代|线性代数|概率)/;
        const mathErrorPattern = /(错|计算|算错|公式|概念|题|不会做|不会算|证明|推导)/;
        return /(计算错误|计算失误|错题|错太多|题错|算错)/.test(text) || (mathSubjectPattern.test(text) && mathErrorPattern.test(text));
    }
    function isLearningMethodSegment(segment) {
        const text = String(segment || '');
        if (isMathErrorSegment(text))
            return false;
        return /(复习|回顾|整理|错题|笔记|知识点|框架|方法|二刷|闭环|只听课|只看不练|只听不练)/.test(text)
            && /(不到位|不熟|不清|不对|少|没|未|忘|漏|断|弱|低|慢)/.test(text);
    }
    function isMemoryRecallSegment(segment) {
        const text = String(segment || '');
        return /(背|记|忘|回忆|默写|单词|词汇)/.test(text) && /(不下来|不完|不住|忘|慢|错|少|没|未)/.test(text);
    }
    function isPlanningSegment(segment) {
        const text = String(segment || '');
        return isStudyNotDoneSegment(text) || /(计划|安排|时间|没完成|未完成|赶不上|来不及|效率低|效率低下|效率不高|执行|任务|拖到|拖延)/.test(text);
    }
    function isClearlyPositiveSegment(segment, fieldKey) {
        if (fieldKey === 'problems')
            return false;
        const text = String(segment || '');
        const positiveCue = /(有进步|明显进步|做得不错|比较顺利|完成了|已完成|保持|稳定|掌握|按计划|效率提高|状态不错|注意力还好|专注度还好|效率还行|状态还行|状态可以|还算顺利)/;
        return positiveCue.test(text) && !hasProblemCue(text, fieldKey);
    }
    function extractRuleProblemCandidates(reviews, skippedSegmentKeys = new Set()) {
        const candidates = [];
        for (const review of reviews) {
            for (const field of reviewProblemFields) {
                for (const sentence of splitReviewSentences(review[field.key])) {
                    const key = segmentKey({ reviewId: Number(review.id), field: field.label, sentenceHash: sentenceHash(sentence) });
                    if (skippedSegmentKeys.has(key))
                        continue;
                    if (!hasProblemCue(sentence, field.key))
                        continue;
                    if (isClearlyPositiveSegment(sentence, field.key))
                        continue;
                    const matched = classifyReviewSegment(sentence, field.key);
                    if (!matched)
                        continue;
                    candidates.push({
                        reviewId: Number(review.id),
                        date: review.date,
                        themeId: matched.theme.id,
                        label: matched.theme.label,
                        field: field.label,
                        evidence: sentence,
                        confidence: matched.confidence,
                        source: 'local-rule-batch',
                    });
                }
            }
        }
        return candidates;
    }
    exposeRuntime({
        reviewProblemThemes: () => reviewProblemThemes,
        reviewProblemFields: () => reviewProblemFields,
        minutesText: () => minutesText,
        dateRange: () => dateRange,
        compactText: () => compactText,
        getErrorThemeOptions: () => getErrorThemeOptions,
        themeOptionById: () => themeOptionById,
        textIncludesKeyword: () => textIncludesKeyword,
        matchedProblemExample: () => matchedProblemExample,
        buildReviewProblemSummary: () => buildReviewProblemSummary,
        splitReviewSentences: () => splitReviewSentences,
        keywordMatches: () => keywordMatches,
        looksLikeResolvedStatement: () => looksLikeResolvedStatement,
        classifyReviewSegment: () => classifyReviewSegment,
        sentenceHash: () => sentenceHash,
        segmentKey: () => segmentKey,
        extractReviewProblemSegments: () => extractReviewProblemSegments,
        hasProblemCue: () => hasProblemCue,
        isStudyNotDoneSegment: () => isStudyNotDoneSegment,
        isEnglishReadingSegment: () => isEnglishReadingSegment,
        isProfessionalCourseSegment: () => isProfessionalCourseSegment,
        isMathErrorSegment: () => isMathErrorSegment,
        isLearningMethodSegment: () => isLearningMethodSegment,
        isMemoryRecallSegment: () => isMemoryRecallSegment,
        isPlanningSegment: () => isPlanningSegment,
        isClearlyPositiveSegment: () => isClearlyPositiveSegment,
        extractRuleProblemCandidates: () => extractRuleProblemCandidates,
    });
}
