export function installReportsDomain(runtime, exposeRuntime) {
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
    function resolveEmbeddingPython() {
        const serverDir = runtime.resolve(runtime.fileURLToPath(new URL('.', import.meta.url)));
        const candidates = [
            process.env.EMBEDDING_PYTHON,
            runtime.join(serverDir, '.venv', 'bin', 'python'),
            runtime.join(serverDir, '.venv', 'Scripts', 'python.exe'),
            'python3',
            'python',
        ].filter(Boolean);
        for (const candidate of candidates) {
            const result = runtime.spawnSync(candidate, ['--version'], { encoding: 'utf8', timeout: 5000 });
            if (!result.error && result.status === 0)
                return candidate;
        }
        return null;
    }
    function normalizeEmbeddingModelProfile(profile) {
        return profile === 'small' ? 'small' : 'large';
    }
    function embeddingModelNameForProfile(profile) {
        return normalizeEmbeddingModelProfile(profile) === 'small' ? runtime.smallEmbeddingModelName : runtime.largeEmbeddingModelName;
    }
    function getEmbeddingStatus(profile = 'large') {
        const modelProfile = normalizeEmbeddingModelProfile(profile);
        const modelName = embeddingModelNameForProfile(modelProfile);
        const python = resolveEmbeddingPython();
        const baseStatus = {
            available: false,
            backend: 'unavailable',
            modelName,
            modelProfile,
            smallModelName: runtime.smallEmbeddingModelName,
            largeModelName: runtime.largeEmbeddingModelName,
            nightlyModelProfile: 'rules',
            manualModelProfile: 'rules',
            cacheDir: runtime.embeddingCacheDir,
            workerFile: runtime.embeddingWorkerFile,
            python,
            error: '',
        };
        if (!python)
            return { ...baseStatus, error: 'Python executable not found' };
        if (!runtime.existsSync(runtime.embeddingWorkerFile))
            return { ...baseStatus, error: 'embedding_worker.py not found' };
        const result = runtime.spawnSync(python, ['-c', 'import fastembed; print("fastembed")'], { encoding: 'utf8', timeout: 10000 });
        if (result.error)
            return { ...baseStatus, error: result.error.message };
        if (result.status !== 0)
            return { ...baseStatus, error: result.stderr || result.stdout || 'fastembed import failed' };
        return { ...baseStatus, available: true, backend: 'fastembed', error: '' };
    }
    function runEmbeddingWorker(texts, modelName = runtime.largeEmbeddingModelName) {
        const python = resolveEmbeddingPython();
        if (!python)
            throw new Error('Python executable not found');
        if (!runtime.existsSync(runtime.embeddingWorkerFile))
            throw new Error('embedding_worker.py not found');
        const maxBuffer = 96 * 1024 * 1024;
        return new Promise((resolveWorker, rejectWorker) => {
            const command = process.platform === 'win32' ? python : 'nice';
            const args = process.platform === 'win32' ? [runtime.embeddingWorkerFile] : ['-n', '10', python, runtime.embeddingWorkerFile];
            const child = runtime.spawn(command, args, {
                env: {
                    ...process.env,
                    HF_ENDPOINT: process.env.HF_ENDPOINT || 'https://hf-mirror.com',
                    EMBEDDING_MODEL_NAME: modelName,
                    EMBEDDING_CACHE_DIR: runtime.embeddingCacheDir,
                },
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            let stdout = '';
            let stderr = '';
            let settled = false;
            const timer = setTimeout(() => {
                fail(new Error('embedding worker timed out'));
                child.kill('SIGKILL');
            }, 45 * 60 * 1000);
            function fail(error) {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timer);
                rejectWorker(error);
            }
            function appendStdout(chunk) {
                stdout += chunk.toString('utf8');
                if (stdout.length > maxBuffer) {
                    fail(new Error('embedding worker stdout exceeded limit'));
                    child.kill('SIGKILL');
                }
            }
            function appendStderr(chunk) {
                stderr += chunk.toString('utf8');
                if (stderr.length > maxBuffer) {
                    fail(new Error('embedding worker stderr exceeded limit'));
                    child.kill('SIGKILL');
                }
            }
            child.stdout.on('data', appendStdout);
            child.stderr.on('data', appendStderr);
            child.on('error', fail);
            child.on('close', (code, signal) => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timer);
                if (code !== 0) {
                    rejectWorker(new Error(stderr || stdout || `embedding worker failed${signal ? `: ${signal}` : ''}`));
                    return;
                }
                try {
                    const payload = JSON.parse(stdout || '{}');
                    if (!payload.ok)
                        throw new Error(payload.error || 'embedding worker unavailable');
                    resolveWorker(payload);
                }
                catch (error) {
                    rejectWorker(error);
                }
            });
            child.stdin.end(JSON.stringify({ texts, modelName, cacheDir: runtime.embeddingCacheDir }));
        });
    }
    function cosineSimilarity(a, b) {
        let dot = 0;
        let normA = 0;
        let normB = 0;
        const length = Math.min(a.length, b.length);
        for (let index = 0; index < length; index += 1) {
            const av = Number(a[index] || 0);
            const bv = Number(b[index] || 0);
            dot += av * bv;
            normA += av * av;
            normB += bv * bv;
        }
        if (!normA || !normB)
            return 0;
        return dot / (Math.sqrt(normA) * Math.sqrt(normB));
    }
    function storeSentenceEmbeddings(segments, vectors, backend, modelName, dimensions, timestamp) {
        segments.forEach((segment, index) => {
            const vector = vectors[index];
            if (!vector)
                return;
            runtime.runSqlite(`INSERT OR IGNORE INTO review_sentence_embeddings (review_id, date, field, sentence, sentence_hash, model_name, backend, vector_json, dimensions, created_at)
    VALUES (${runtime.sqlValue(segment.reviewId)}, ${runtime.sqlString(segment.date)}, ${runtime.sqlString(segment.field)}, ${runtime.sqlString(segment.sentence)}, ${runtime.sqlString(segment.sentenceHash)}, ${runtime.sqlString(modelName)}, ${runtime.sqlString(backend)}, ${runtime.sqlString(JSON.stringify(vector))}, ${runtime.sqlValue(dimensions)}, ${runtime.sqlString(timestamp)});`);
        });
    }
    function themeSeedText(theme) {
        return `${theme.label}。典型表现：${theme.keywords.join('、')}`;
    }
    function semanticThresholdForField(fieldKey, hasCue) {
        if (fieldKey === 'problems')
            return hasCue ? 0.68 : 0.76;
        if (fieldKey === 'tomorrowPlan')
            return hasCue ? 0.74 : 0.82;
        return hasCue ? 0.78 : 0.86;
    }
    async function extractEmbeddingProblemCandidates(reviews, timestamp, skippedSegmentKeys = new Set(), modelProfile = 'large') {
        const selectedProfile = normalizeEmbeddingModelProfile(modelProfile);
        const requestedModelName = embeddingModelNameForProfile(selectedProfile);
        const segments = extractReviewProblemSegments(reviews);
        if (!segments.length) {
            return { candidates: [], modelName: requestedModelName, modelProfile: selectedProfile, source: 'local-embedding-batch', backend: 'fastembed', dimensions: 0, embeddedSentenceCount: 0 };
        }
        const seedTexts = reviewProblemThemes.map(themeSeedText);
        const workerResult = await runEmbeddingWorker([...segments.map((item) => item.sentence), ...seedTexts], requestedModelName);
        const vectors = workerResult.embeddings || [];
        const segmentVectors = vectors.slice(0, segments.length);
        const seedVectors = vectors.slice(segments.length);
        const modelName = workerResult.modelName || requestedModelName;
        const backend = workerResult.backend || 'fastembed';
        const dimensions = Number(workerResult.dimensions || segmentVectors[0]?.length || 0);
        storeSentenceEmbeddings(segments, segmentVectors, backend, modelName, dimensions, timestamp);
        const candidates = [];
        segments.forEach((segment, index) => {
            const vector = segmentVectors[index];
            if (!vector)
                return;
            if (skippedSegmentKeys.has(segmentKey(segment)))
                return;
            if (!hasProblemCue(segment.sentence, segment.fieldKey))
                return;
            if (isClearlyPositiveSegment(segment.sentence, segment.fieldKey))
                return;
            if (classifyReviewSegment(segment.sentence, segment.fieldKey))
                return;
            let best = null;
            let secondBest = null;
            seedVectors.forEach((seedVector, seedIndex) => {
                const similarity = cosineSimilarity(vector, seedVector);
                if (!best || similarity > best.similarity) {
                    secondBest = best;
                    best = { similarity, theme: reviewProblemThemes[seedIndex] };
                }
                else if (!secondBest || similarity > secondBest.similarity) {
                    secondBest = { similarity, theme: reviewProblemThemes[seedIndex] };
                }
            });
            if (!best)
                return;
            const cue = hasProblemCue(segment.sentence, segment.fieldKey);
            const threshold = semanticThresholdForField(segment.fieldKey, cue);
            if (best.similarity < threshold)
                return;
            if (secondBest && best.similarity - secondBest.similarity < 0.035)
                return;
            candidates.push({
                reviewId: segment.reviewId,
                date: segment.date,
                themeId: best.theme.id,
                label: best.theme.label,
                field: segment.field,
                evidence: segment.sentence,
                confidence: Math.min(0.97, Math.max(0.55, Math.round(best.similarity * 100) / 100)),
                source: 'local-embedding-batch',
            });
        });
        return { candidates, modelName, modelProfile: selectedProfile, source: 'local-embedding-batch', backend, dimensions, embeddedSentenceCount: segments.length };
    }
    function mergeProblemCandidates(primary, secondary) {
        const seen = new Set();
        const merged = [];
        for (const candidate of [...primary, ...secondary]) {
            const key = `${candidate.themeId}|${candidate.reviewId}|${String(candidate.evidence || '').replace(/\s+/g, '')}`;
            if (seen.has(key))
                continue;
            seen.add(key);
            merged.push(candidate);
        }
        return merged;
    }
    function loadErrorThemeCorrections() {
        return runtime.sqliteJson(`SELECT id, sentence_hash AS sentenceHash, sentence, action, target_theme_key AS targetThemeKey,
    target_label AS targetLabel, source_theme_key AS sourceThemeKey, source_label AS sourceLabel, review_id AS reviewId, date, field
    FROM error_theme_corrections
    ORDER BY updated_at DESC, created_at DESC, id DESC;`);
    }
    function correctionMatchesSegment(correction, segment) {
        if (correction.sentenceHash === segment.sentenceHash)
            return true;
        const correctionText = String(correction.sentence || '').replace(/\s+/g, '');
        const segmentText = String(segment.sentence || '').replace(/\s+/g, '');
        return correctionText.length >= 4 && segmentText.length >= 4 && (correctionText.includes(segmentText) || segmentText.includes(correctionText));
    }
    function extractCorrectionProblemCandidates(reviews, corrections) {
        const candidates = [];
        const handledSegmentKeys = new Set();
        const segments = extractReviewProblemSegments(reviews);
        for (const segment of segments) {
            const correction = corrections.find((item) => correctionMatchesSegment(item, segment));
            if (!correction)
                continue;
            handledSegmentKeys.add(segmentKey(segment));
            if (correction.action === 'ignore')
                continue;
            const target = themeOptionById(correction.targetThemeKey);
            if (!target)
                continue;
            candidates.push({
                reviewId: segment.reviewId,
                date: segment.date,
                themeId: target.id,
                label: target.label,
                field: segment.field,
                evidence: segment.sentence,
                confidence: 0.99,
                source: 'local-correction-sample',
            });
        }
        return { candidates, handledSegmentKeys };
    }
    function candidateRank(candidate) {
        const fieldRank = candidate.field === '今日问题' ? 30 : candidate.field === '明日计划' ? 20 : 10;
        const sourceRank = candidate.source === 'local-rule-batch' ? 3 : 1;
        return fieldRank + sourceRank + Number(candidate.confidence || 0);
    }
    function dedupeProblemCandidates(candidates) {
        const grouped = new Map();
        for (const candidate of candidates) {
            const key = `${candidate.themeId}|${candidate.reviewId}`;
            const current = grouped.get(key);
            if (!current || candidateRank(candidate) > candidateRank(current)) {
                grouped.set(key, candidate);
            }
        }
        return Array.from(grouped.values());
    }
    function clearGeneratedErrorThemeOccurrences(periodStart, periodEnd) {
        runtime.runSqlite(`DELETE FROM error_theme_occurrences
    WHERE date BETWEEN ${runtime.sqlString(periodStart)} AND ${runtime.sqlString(periodEnd)}
      AND source IN ('local-embedding-batch', 'local-rule-batch', 'local-model-batch', 'local-correction-sample');`);
    }
    function upsertErrorTheme(themeId, label, timestamp) {
        runtime.runSqlite(`INSERT INTO error_themes (normalized_label, label, created_at, updated_at)
    VALUES (${runtime.sqlString(themeId)}, ${runtime.sqlString(label)}, ${runtime.sqlString(timestamp)}, ${runtime.sqlString(timestamp)})
    ON CONFLICT(normalized_label) DO UPDATE SET label = excluded.label, updated_at = excluded.updated_at;`);
        return Number(runtime.sqliteScalar(`SELECT id FROM error_themes WHERE normalized_label = ${runtime.sqlString(themeId)} LIMIT 1;`) || 0);
    }
    function refreshErrorThemeStats() {
        runtime.runSqlite(`UPDATE error_themes
    SET
      occurrence_count = (SELECT COUNT(*) FROM error_theme_occurrences WHERE theme_id = error_themes.id),
      review_day_count = (SELECT COUNT(DISTINCT date) FROM error_theme_occurrences WHERE theme_id = error_themes.id),
      first_seen_at = (SELECT MIN(date) FROM error_theme_occurrences WHERE theme_id = error_themes.id),
      last_seen_at = (SELECT MAX(date) FROM error_theme_occurrences WHERE theme_id = error_themes.id),
      updated_at = ${runtime.sqlString(runtime.nowISO())};`);
    }
    function saveErrorThemeCorrection(payload) {
        runtime.ensureSqliteStore();
        const timestamp = runtime.nowISO();
        const occurrenceId = Number(payload.occurrenceId || 0);
        const occurrence = occurrenceId
            ? runtime.sqliteJson(`SELECT o.id, o.review_id AS reviewId, o.date, o.field, o.evidence, o.theme_id AS themeId,
    t.normalized_label AS sourceThemeKey, t.label AS sourceLabel
    FROM error_theme_occurrences o
    JOIN error_themes t ON t.id = o.theme_id
    WHERE o.id = ${runtime.sqlValue(occurrenceId)}
    LIMIT 1;`)[0]
            : null;
        const sentence = String(payload.sentence || occurrence?.evidence || '').trim();
        if (!sentence)
            throw new Error('Missing correction sentence');
        const action = payload.action === 'ignore' ? 'ignore' : 'relabel';
        const target = action === 'relabel' ? themeOptionById(payload.targetThemeKey) : null;
        if (action === 'relabel' && !target)
            throw new Error('Invalid target theme');
        const hash = sentenceHash(sentence);
        runtime.runSqlite(`INSERT INTO error_theme_corrections (sentence_hash, sentence, action, target_theme_key, target_label, source_theme_key, source_label, review_id, date, field, created_at, updated_at)
    VALUES (${runtime.sqlString(hash)}, ${runtime.sqlString(sentence)}, ${runtime.sqlString(action)}, ${runtime.sqlValue(target?.id || null)}, ${runtime.sqlValue(target?.label || null)}, ${runtime.sqlValue(payload.sourceThemeKey || occurrence?.sourceThemeKey || null)}, ${runtime.sqlValue(payload.sourceLabel || occurrence?.sourceLabel || null)}, ${runtime.sqlValue(Number(payload.reviewId || occurrence?.reviewId || 0) || null)}, ${runtime.sqlValue(payload.date || occurrence?.date || null)}, ${runtime.sqlValue(payload.field || occurrence?.field || null)}, ${runtime.sqlString(timestamp)}, ${runtime.sqlString(timestamp)})
    ON CONFLICT(sentence_hash, action, target_theme_key) DO UPDATE SET
      sentence = excluded.sentence,
      source_theme_key = excluded.source_theme_key,
      source_label = excluded.source_label,
      review_id = excluded.review_id,
      date = excluded.date,
      field = excluded.field,
      updated_at = excluded.updated_at;`);
        if (occurrenceId && action === 'ignore') {
            runtime.runSqlite(`DELETE FROM error_theme_occurrences WHERE id = ${runtime.sqlValue(occurrenceId)};`);
        }
        else if (occurrenceId && target) {
            const targetThemeId = upsertErrorTheme(target.id, target.label, timestamp);
            runtime.runSqlite(`UPDATE error_theme_occurrences
    SET theme_id = ${runtime.sqlValue(targetThemeId)}, confidence = 0.99, source = 'local-correction-sample', created_at = ${runtime.sqlString(timestamp)}
    WHERE id = ${runtime.sqlValue(occurrenceId)};`);
        }
        refreshErrorThemeStats();
        return {
            ok: true,
            correction: {
                sentenceHash: hash,
                sentence,
                action,
                targetThemeKey: target?.id || null,
                targetLabel: target?.label || null,
            },
        };
    }
    function insertErrorThemeBatch({ periodStart, periodEnd, reviewCount, occurrenceCount, themeCount, timestamp, completedAt = timestamp, source, modelName, note, status = 'completed' }) {
        runtime.runSqlite(`INSERT INTO error_theme_batches (source, model_name, period_start, period_end, review_count, occurrence_count, theme_count, status, created_at, completed_at, note)
    VALUES (${runtime.sqlString(source)}, ${runtime.sqlString(modelName)}, ${runtime.sqlString(periodStart)}, ${runtime.sqlString(periodEnd)}, ${runtime.sqlValue(reviewCount)}, ${runtime.sqlValue(occurrenceCount)}, ${runtime.sqlValue(themeCount)}, ${runtime.sqlString(status)}, ${runtime.sqlString(timestamp)}, ${runtime.sqlValue(completedAt)}, ${runtime.sqlString(note)});`);
        return Number(runtime.sqliteScalar(`SELECT id FROM error_theme_batches WHERE created_at = ${runtime.sqlString(timestamp)} ORDER BY id DESC LIMIT 1;`) || 0);
    }
    function recordFailedErrorThemeBatch({ periodStart, periodEnd, modelName, note }) {
        const timestamp = runtime.nowISO();
        const reviewCount = Number(runtime.sqliteScalar(`SELECT COUNT(*) FROM daily_reviews WHERE user_id = 1 AND date BETWEEN ${runtime.sqlString(periodStart)} AND ${runtime.sqlString(periodEnd)};`) || 0);
        return insertErrorThemeBatch({
            periodStart,
            periodEnd,
            reviewCount,
            occurrenceCount: 0,
            themeCount: 0,
            timestamp,
            completedAt: timestamp,
            source: 'local-embedding-batch',
            modelName,
            note,
            status: 'failed',
        });
    }
    async function runErrorThemeBatch(periodStart = '1900-01-01', periodEnd = runtime.todayISO(), options = {}) {
        runtime.ensureSqliteStore();
        const timestamp = runtime.nowISO();
        const from = periodStart || '1900-01-01';
        const to = periodEnd || runtime.todayISO();
        const modelProfile = normalizeEmbeddingModelProfile(options.modelProfile);
        const reviews = runtime.sqliteJson(`SELECT id, date, summary, wins, problems, tomorrow_plan AS tomorrowPlan
    FROM daily_reviews
    WHERE user_id = 1 AND date BETWEEN ${runtime.sqlString(from)} AND ${runtime.sqlString(to)}
    ORDER BY date;`);
        const inboxItems = runtime.sqliteJson(`SELECT id, date, text
    FROM problem_inbox_items
    WHERE user_id = 1 AND status = 'open' AND date BETWEEN ${runtime.sqlString(from)} AND ${runtime.sqlString(to)}
    ORDER BY date, id;`);
        const inboxReviews = inboxItems.map((item) => ({
            id: -Math.abs(Number(item.id)),
            date: item.date,
            summary: '',
            wins: '',
            problems: item.text,
            tomorrowPlan: '',
        }));
        const reviewSources = [...reviews, ...inboxReviews];
        const corrections = loadErrorThemeCorrections();
        const correctionResult = extractCorrectionProblemCandidates(reviewSources, corrections);
        let embeddingMeta = null;
        let candidates = correctionResult.candidates;
        if (options.mode === 'rules') {
            candidates = mergeProblemCandidates(correctionResult.candidates, extractRuleProblemCandidates(reviewSources, correctionResult.handledSegmentKeys));
        }
        else {
            embeddingMeta = await extractEmbeddingProblemCandidates(reviewSources, timestamp, correctionResult.handledSegmentKeys, modelProfile);
            const ruleCandidates = extractRuleProblemCandidates(reviewSources, correctionResult.handledSegmentKeys);
            candidates = mergeProblemCandidates(correctionResult.candidates, mergeProblemCandidates(embeddingMeta.candidates, ruleCandidates));
        }
        const rawCandidateCount = candidates.length;
        candidates = dedupeProblemCandidates(candidates);
        clearGeneratedErrorThemeOccurrences(from, to);
        const batchSource = embeddingMeta && !embeddingMeta.error ? 'local-embedding-batch' : 'local-rule-batch';
        const modelName = embeddingMeta && !embeddingMeta.error ? embeddingMeta.modelName : 'local-review-topic-v1';
        const triggerLabel = options.trigger || 'manual';
        const note = options.mode === 'rules'
            ? `${triggerLabel} rule batch classification; embedding model skipped`
            : `${triggerLabel} local batch classification; profile=${modelProfile}; backend=${embeddingMeta?.backend || 'rules'}; dimensions=${embeddingMeta?.dimensions || 0}`;
        const themeKeys = new Set(candidates.map((item) => item.themeId));
        const batchId = insertErrorThemeBatch({
            periodStart: from,
            periodEnd: to,
            reviewCount: reviewSources.length,
            occurrenceCount: candidates.length,
            themeCount: themeKeys.size,
            timestamp,
            source: batchSource,
            modelName,
            note,
        });
        const themeIdMap = new Map();
        for (const candidate of candidates) {
            if (!themeIdMap.has(candidate.themeId)) {
                themeIdMap.set(candidate.themeId, upsertErrorTheme(candidate.themeId, candidate.label, timestamp));
            }
            const themeRowId = themeIdMap.get(candidate.themeId);
            runtime.runSqlite(`INSERT OR IGNORE INTO error_theme_occurrences (theme_id, batch_id, review_id, date, field, evidence, confidence, source, created_at)
    VALUES (${runtime.sqlValue(themeRowId)}, ${runtime.sqlValue(batchId)}, ${runtime.sqlValue(candidate.reviewId)}, ${runtime.sqlString(candidate.date)}, ${runtime.sqlString(candidate.field)}, ${runtime.sqlString(candidate.evidence)}, ${runtime.sqlValue(candidate.confidence)}, ${runtime.sqlString(candidate.source || batchSource)}, ${runtime.sqlString(timestamp)});`);
        }
        refreshErrorThemeStats();
        return {
            batchId,
            periodStart: from,
            periodEnd: to,
            reviewCount: reviewSources.length,
            occurrenceCount: candidates.length,
            rawCandidateCount,
            deduplicatedCount: Math.max(0, rawCandidateCount - candidates.length),
            themeCount: themeKeys.size,
            modelName,
            modelProfile: options.mode === 'rules' ? 'rules' : modelProfile,
            source: batchSource,
            backend: embeddingMeta?.backend || 'rules',
            dimensions: embeddingMeta?.dimensions || 0,
            embeddedSentenceCount: embeddingMeta?.embeddedSentenceCount || 0,
            fallbackReason: embeddingMeta?.error || '',
            completedAt: timestamp,
        };
    }
    function currentErrorThemeJobSnapshot() {
        return runtime.errorThemeBatchJob ? { ...runtime.errorThemeBatchJob } : null;
    }
    function refreshCurrentReportsAfterBatch(trigger = 'manual') {
        try {
            for (const kind of ['weekly', 'monthly']) {
                for (const period of [runtime.previousPeriod(kind), runtime.currentPeriod(kind)]) {
                    generateLearningReport(kind, period.periodStart, period.periodEnd, trigger);
                }
            }
            runtime.runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
    VALUES ('last_report_precomputed_at', ${runtime.sqlString(runtime.nowISO())}, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
        }
        catch (error) {
            console.error('[reports] refresh after error theme batch failed:', error);
        }
    }
    function startErrorThemeBatchJob({ periodStart = '1900-01-01', periodEnd = runtime.todayISO(), mode = 'rules', trigger = 'manual', modelProfile = 'large' } = {}) {
        if (runtime.errorThemeBatchJob?.status === 'running' || runtime.errorThemeBatchJob?.status === 'queued') {
            return { started: false, job: currentErrorThemeJobSnapshot() };
        }
        const selectedProfile = normalizeEmbeddingModelProfile(modelProfile);
        const selectedModelName = embeddingModelNameForProfile(selectedProfile);
        const jobId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        runtime.errorThemeBatchJob = {
            id: jobId,
            status: 'queued',
            periodStart,
            periodEnd,
            mode,
            trigger,
            modelProfile: mode === 'rules' ? 'rules' : selectedProfile,
            modelName: mode === 'rules' ? 'local-review-topic-v1' : selectedModelName,
            startedAt: runtime.nowISO(),
            completedAt: null,
            result: null,
            error: '',
        };
        setTimeout(async () => {
            if (!runtime.errorThemeBatchJob || runtime.errorThemeBatchJob.id !== jobId)
                return;
            runtime.errorThemeBatchJob = { ...runtime.errorThemeBatchJob, status: 'running' };
            try {
                const task = await runtime.runExclusiveTask('error-theme-batch', trigger, async () => {
                    const batchResult = await runErrorThemeBatch(periodStart, periodEnd, { mode, modelProfile: selectedProfile, trigger });
                    refreshCurrentReportsAfterBatch(trigger === 'nightly' ? 'auto' : 'manual');
                    return batchResult;
                }, { timeoutMs: 45 * 60 * 1000, metadata: { periodStart, periodEnd, mode, modelProfile: selectedProfile } });
                const result = task.result;
                runtime.errorThemeBatchJob = {
                    ...runtime.errorThemeBatchJob,
                    status: 'completed',
                    completedAt: runtime.nowISO(),
                    result,
                };
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                try {
                    recordFailedErrorThemeBatch({
                        periodStart,
                        periodEnd,
                        modelName: mode === 'rules' ? 'local-review-topic-v1' : selectedModelName,
                        note: mode === 'rules'
                            ? `${trigger} rule batch failed; error=${errorMessage}`
                            : `${trigger} embedding failed; no rule fallback was written; profile=${selectedProfile}; error=${errorMessage}`,
                    });
                }
                catch (recordError) {
                    console.error('[error-themes] failed to persist failed batch:', recordError);
                }
                runtime.errorThemeBatchJob = {
                    ...runtime.errorThemeBatchJob,
                    status: 'failed',
                    completedAt: runtime.nowISO(),
                    error: errorMessage,
                };
            }
        }, 50).unref();
        return { started: true, job: currentErrorThemeJobSnapshot() };
    }
    function nextChinaThreeAMDelay() {
        const now = new Date();
        const chinaNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
        const targetChina = new Date(Date.UTC(chinaNow.getUTCFullYear(), chinaNow.getUTCMonth(), chinaNow.getUTCDate(), 3, 0, 0, 0));
        if (chinaNow >= targetChina)
            targetChina.setUTCDate(targetChina.getUTCDate() + 1);
        const targetUtcMs = targetChina.getTime() - 8 * 60 * 60 * 1000;
        runtime.nextNightlyErrorThemeAt = new Date(targetUtcMs).toISOString();
        runtime.setRuntimeMetadata('worker_next_error_theme_at', runtime.nextNightlyErrorThemeAt);
        return Math.max(60 * 1000, targetUtcMs - now.getTime());
    }
    function scheduleNightlyErrorThemeBatch() {
        const delay = nextChinaThreeAMDelay();
        runtime.nightlyErrorThemeTimer = runtime.scheduler.scheduleOnce('nightly-error-themes', delay, () => {
            startErrorThemeBatchJob({ periodStart: '1900-01-01', periodEnd: runtime.todayISO(), mode: 'rules', trigger: 'nightly' });
            scheduleNightlyErrorThemeBatch();
        });
    }
    function getErrorThemePeriodSummary(periodStart, periodEnd, limit = 6) {
        const themes = runtime.sqliteJson(`SELECT t.id, t.normalized_label AS normalizedLabel, t.label, COUNT(o.id) AS count, COUNT(DISTINCT o.date) AS days
    FROM error_themes t
    JOIN error_theme_occurrences o ON o.theme_id = t.id
    WHERE o.date BETWEEN ${runtime.sqlString(periodStart)} AND ${runtime.sqlString(periodEnd)}
    GROUP BY t.id
    ORDER BY days DESC, count DESC, MAX(o.date) DESC, t.label
    LIMIT ${Number(limit)};`);
        return themes.map((theme) => {
            const dates = runtime.sqliteJson(`SELECT DISTINCT date FROM error_theme_occurrences
    WHERE theme_id = ${runtime.sqlValue(theme.id)} AND date BETWEEN ${runtime.sqlString(periodStart)} AND ${runtime.sqlString(periodEnd)}
    ORDER BY date;`).map((item) => item.date);
            const examples = runtime.sqliteJson(`SELECT date, field, evidence AS text FROM error_theme_occurrences
    WHERE theme_id = ${runtime.sqlValue(theme.id)} AND date BETWEEN ${runtime.sqlString(periodStart)} AND ${runtime.sqlString(periodEnd)}
    ORDER BY date DESC, confidence DESC, id DESC
    LIMIT 3;`);
            return {
                id: theme.normalizedLabel,
                label: theme.label,
                count: Number(theme.days || 0),
                dates,
                keywords: reviewProblemThemes.find((item) => item.id === theme.normalizedLabel)?.keywords || [],
                examples,
            };
        });
    }
    function getErrorThemeAnalysis(periodStart = '1900-01-01', periodEnd = runtime.todayISO()) {
        runtime.ensureSqliteStore();
        const from = periodStart || '1900-01-01';
        const to = periodEnd || runtime.todayISO();
        const latestBatch = runtime.sqliteJson(`SELECT id, source, model_name AS modelName, period_start AS periodStart, period_end AS periodEnd,
    review_count AS reviewCount, occurrence_count AS occurrenceCount, theme_count AS themeCount, status, created_at AS createdAt, completed_at AS completedAt, note
    FROM error_theme_batches
    ORDER BY created_at DESC, id DESC
    LIMIT 1;`)[0] || null;
        const themes = runtime.sqliteJson(`SELECT t.id, t.normalized_label AS normalizedLabel, t.label,
    COUNT(o.id) AS occurrenceCount,
    COUNT(DISTINCT o.date) AS reviewDayCount,
    ROUND(AVG(o.confidence), 2) AS averageConfidence,
    MIN(o.date) AS firstSeenAt,
    MAX(o.date) AS lastSeenAt
    FROM error_themes t
    JOIN error_theme_occurrences o ON o.theme_id = t.id
    WHERE o.date BETWEEN ${runtime.sqlString(from)} AND ${runtime.sqlString(to)}
    GROUP BY t.id
    ORDER BY reviewDayCount DESC, occurrenceCount DESC, lastSeenAt DESC, t.label
    LIMIT 12;`);
        const enrichedThemes = themes.map((theme) => ({
            id: Number(theme.id),
            normalizedLabel: theme.normalizedLabel,
            label: theme.label,
            occurrenceCount: Number(theme.occurrenceCount || 0),
            reviewDayCount: Number(theme.reviewDayCount || 0),
            averageConfidence: Number(theme.averageConfidence || 0),
            firstSeenAt: theme.firstSeenAt,
            lastSeenAt: theme.lastSeenAt,
            examples: runtime.sqliteJson(`SELECT id AS occurrenceId, date, field, evidence, confidence, source FROM error_theme_occurrences
    WHERE theme_id = ${runtime.sqlValue(theme.id)} AND date BETWEEN ${runtime.sqlString(from)} AND ${runtime.sqlString(to)}
    ORDER BY date DESC, confidence DESC, id DESC
    LIMIT 3;`),
        }));
        const timeline = runtime.sqliteJson(`SELECT date, COUNT(*) AS count
    FROM error_theme_occurrences
    WHERE date BETWEEN ${runtime.sqlString(from)} AND ${runtime.sqlString(to)}
    GROUP BY date
    ORDER BY date;`).map((item) => ({ date: item.date, count: Number(item.count || 0) }));
        const totals = runtime.sqliteJson(`SELECT COUNT(*) AS occurrenceCount, COUNT(DISTINCT theme_id) AS themeCount, COUNT(DISTINCT date) AS reviewDayCount
    FROM error_theme_occurrences
    WHERE date BETWEEN ${runtime.sqlString(from)} AND ${runtime.sqlString(to)};`)[0] || { occurrenceCount: 0, themeCount: 0, reviewDayCount: 0 };
        return {
            periodStart: from,
            periodEnd: to,
            latestBatch,
            summary: {
                occurrenceCount: Number(totals.occurrenceCount || 0),
                themeCount: Number(totals.themeCount || 0),
                reviewDayCount: Number(totals.reviewDayCount || 0),
                topTheme: enrichedThemes[0] || null,
            },
            themes: enrichedThemes,
            timeline,
        };
    }
    function getCachedErrorThemeAnalysis(periodStart = '1900-01-01', periodEnd = runtime.todayISO()) {
        const from = periodStart || '1900-01-01';
        const to = periodEnd || runtime.todayISO();
        const cacheKey = `error-themes:${from}:${to}`;
        const cached = runtime.getPrecomputedCache(cacheKey);
        if (cached)
            return cached;
        return runtime.setPrecomputedCache(cacheKey, getErrorThemeAnalysis(from, to));
    }
    function getErrorThemeDetail(themeId, periodStart = '1900-01-01', periodEnd = runtime.todayISO()) {
        runtime.ensureSqliteStore();
        const id = Number(themeId || 0);
        const from = periodStart || '1900-01-01';
        const to = periodEnd || runtime.todayISO();
        const theme = runtime.sqliteJson(`SELECT id, normalized_label AS normalizedLabel, label, occurrence_count AS occurrenceCount,
    review_day_count AS reviewDayCount, first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt
    FROM error_themes
    WHERE id = ${runtime.sqlValue(id)}
    LIMIT 1;`)[0] || null;
        if (!theme)
            return null;
        const occurrences = runtime.sqliteJson(`SELECT o.id AS occurrenceId, o.date, o.field, o.evidence, o.confidence, o.source, o.review_id AS reviewId,
    r.summary, r.wins, r.problems, r.tomorrow_plan AS tomorrowPlan, r.score
    FROM error_theme_occurrences o
    LEFT JOIN daily_reviews r ON r.id = o.review_id
    WHERE o.theme_id = ${runtime.sqlValue(id)} AND o.date BETWEEN ${runtime.sqlString(from)} AND ${runtime.sqlString(to)}
    ORDER BY o.date DESC, o.confidence DESC, o.id DESC;`);
        const timeline = runtime.sqliteJson(`SELECT date, COUNT(*) AS count
    FROM error_theme_occurrences
    WHERE theme_id = ${runtime.sqlValue(id)} AND date BETWEEN ${runtime.sqlString(from)} AND ${runtime.sqlString(to)}
    GROUP BY date
    ORDER BY date;`).map((item) => ({ date: item.date, count: Number(item.count || 0) }));
        const byField = runtime.sqliteJson(`SELECT field, COUNT(*) AS count
    FROM error_theme_occurrences
    WHERE theme_id = ${runtime.sqlValue(id)} AND date BETWEEN ${runtime.sqlString(from)} AND ${runtime.sqlString(to)}
    GROUP BY field
    ORDER BY count DESC, field;`).map((item) => ({ field: item.field, count: Number(item.count || 0) }));
        const repeatedWeeks = runtime.sqliteJson(`SELECT strftime('%Y-W%W', date) AS week, COUNT(*) AS count, MIN(date) AS startDate, MAX(date) AS endDate
    FROM error_theme_occurrences
    WHERE theme_id = ${runtime.sqlValue(id)} AND date BETWEEN ${runtime.sqlString(from)} AND ${runtime.sqlString(to)}
    GROUP BY week
    HAVING count >= 3
    ORDER BY week DESC;`).map((item) => ({ ...item, count: Number(item.count || 0) }));
        return {
            theme,
            periodStart: from,
            periodEnd: to,
            occurrences,
            timeline,
            byField,
            repeatedWeeks,
        };
    }
    function buildReportTitle(kind, periodStart, periodEnd) {
        const label = kind === 'monthly' ? '月报' : '周报';
        return `${periodStart} 至 ${periodEnd} 学习${label}`;
    }
    function buildLearningReport(kind, periodStart, periodEnd, trigger = 'auto', userId = 1) {
        const dailyRows = runtime.sqliteJson(`SELECT date, COALESCE(SUM(minutes), 0) AS minutes
    FROM study_time_records
    WHERE user_id = ${runtime.sqlValue(userId)} AND date BETWEEN ${runtime.sqlString(periodStart)} AND ${runtime.sqlString(periodEnd)}
    GROUP BY date
    ORDER BY date;`);
        const dailyMap = new Map(dailyRows.map((item) => [item.date, Number(item.minutes || 0)]));
        const dailyTotals = dateRange(periodStart, periodEnd).map((date) => ({ date, minutes: dailyMap.get(date) || 0 }));
        const projectTotals = runtime.sqliteJson(`SELECT project_name_snapshot AS name, COALESCE(SUM(minutes), 0) AS minutes
    FROM study_time_records
    WHERE user_id = ${runtime.sqlValue(userId)} AND date BETWEEN ${runtime.sqlString(periodStart)} AND ${runtime.sqlString(periodEnd)}
    GROUP BY project_name_snapshot
    HAVING minutes > 0
    ORDER BY minutes DESC, name
    LIMIT 12;`);
        const reviews = runtime.sqliteJson(`SELECT date, score, summary, wins, problems, tomorrow_plan AS tomorrowPlan
    FROM daily_reviews
    WHERE user_id = ${runtime.sqlValue(userId)} AND date BETWEEN ${runtime.sqlString(periodStart)} AND ${runtime.sqlString(periodEnd)}
    ORDER BY date;`);
        const exams = runtime.sqliteJson(`SELECT date, subject_name_snapshot AS subjectName, score, full_score AS fullScore, paper_name AS paperName
    FROM mock_exam_records
    WHERE user_id = ${runtime.sqlValue(userId)} AND date BETWEEN ${runtime.sqlString(periodStart)} AND ${runtime.sqlString(periodEnd)}
    ORDER BY date DESC, id DESC;`);
        const taskStats = runtime.sqliteJson(`SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN is_completed = 1 THEN 1 ELSE 0 END), 0) AS completed
    FROM short_term_tasks
    WHERE user_id = ${runtime.sqlValue(userId)} AND due_date BETWEEN ${runtime.sqlString(periodStart)} AND ${runtime.sqlString(periodEnd)};`)[0] || { total: 0, completed: 0 };
        const waterStats = runtime.sqliteJson(`SELECT COALESCE(SUM(cups), 0) AS cups, COALESCE(SUM(cups * cup_ml), 0) AS ml
    FROM water_intake_records
    WHERE user_id = ${runtime.sqlValue(userId)} AND date BETWEEN ${runtime.sqlString(periodStart)} AND ${runtime.sqlString(periodEnd)};`)[0] || { cups: 0, ml: 0 };
        const totalMinutes = dailyTotals.reduce((sum, item) => sum + Number(item.minutes || 0), 0);
        const studyDays = dailyTotals.filter((item) => Number(item.minutes || 0) > 0).length;
        const averageDailyMinutes = dailyTotals.length ? Math.round(totalMinutes / dailyTotals.length) : 0;
        const averageStudyDayMinutes = studyDays ? Math.round(totalMinutes / studyDays) : 0;
        const averageReviewScore = reviews.length
            ? Math.round((reviews.reduce((sum, item) => sum + Number(item.score || 0), 0) / reviews.length) * 10) / 10
            : null;
        const completedTasks = Number(taskStats.completed || 0);
        const totalTasks = Number(taskStats.total || 0);
        const taskCompletionRate = totalTasks ? Math.round((completedTasks / totalTasks) * 100) : null;
        const topProject = projectTotals[0] || null;
        const bestReview = reviews.length ? reviews.reduce((best, item) => Number(item.score || 0) > Number(best.score || 0) ? item : best, reviews[0]) : null;
        const lowestReview = reviews.length ? reviews.reduce((low, item) => Number(item.score || 0) < Number(low.score || 0) ? item : low, reviews[0]) : null;
        const highlights = [
            totalMinutes > 0 ? `累计学习 ${minutesText(totalMinutes)}，覆盖 ${studyDays} 天。` : '本周期还没有学习时间记录。',
            topProject ? `投入最多的是「${topProject.name}」，共 ${minutesText(topProject.minutes)}。` : '',
            averageReviewScore ? `完成 ${reviews.length} 篇复盘，平均评分 ${averageReviewScore}/10。` : '本周期没有复盘记录。',
            totalTasks ? `短期目标完成 ${completedTasks}/${totalTasks}，完成率 ${taskCompletionRate}%。` : '',
            exams.length ? `记录 ${exams.length} 次模考，最近一次是 ${exams[0].subjectName} ${exams[0].score}/${exams[0].fullScore}。` : '',
        ].filter(Boolean);
        const suggestions = [];
        if (totalMinutes === 0)
            suggestions.push('先恢复最小学习闭环：每天至少记录一个项目的学习时间。');
        if (reviews.length < Math.min(3, dailyTotals.length))
            suggestions.push('复盘密度偏低，可以把每日复盘压缩到 5 分钟，先保持连续。');
        if (taskCompletionRate !== null && taskCompletionRate < 60)
            suggestions.push('短期目标完成率偏低，下一周期建议减少同时推进的目标数量。');
        if (topProject && totalMinutes > 0 && Number(topProject.minutes) / totalMinutes > 0.7)
            suggestions.push('学习投入集中度较高，注意给薄弱科目保留固定时间块。');
        if (!suggestions.length)
            suggestions.push('节奏比较稳，下一周期继续保持记录、复盘和任务闭环。');
        const themeLibraryProblems = userId === 1 ? getErrorThemePeriodSummary(periodStart, periodEnd) : [];
        const commonProblems = themeLibraryProblems.length ? themeLibraryProblems : buildReviewProblemSummary(reviews);
        return {
            kind,
            title: buildReportTitle(kind, periodStart, periodEnd),
            periodStart,
            periodEnd,
            generatedAt: runtime.nowISO(),
            trigger,
            summary: {
                totalMinutes,
                studyDays,
                averageDailyMinutes,
                averageStudyDayMinutes,
                reviewCount: reviews.length,
                averageReviewScore,
                completedTasks,
                totalTasks,
                taskCompletionRate,
                waterCups: Number(waterStats.cups || 0),
                waterMl: Number(waterStats.ml || 0),
                examsCount: exams.length,
                topProject: topProject ? { name: topProject.name, minutes: Number(topProject.minutes || 0) } : null,
                bestReview: bestReview ? { date: bestReview.date, score: bestReview.score, summary: compactText(bestReview.summary) } : null,
                lowestReview: lowestReview ? { date: lowestReview.date, score: lowestReview.score, problems: compactText(lowestReview.problems) } : null,
            },
            highlights,
            suggestions,
            commonProblems,
            dailyTotals,
            projectTotals: projectTotals.map((item) => ({ name: item.name, minutes: Number(item.minutes || 0) })),
            reviews: reviews.map((item) => ({
                date: item.date,
                score: item.score,
                summary: item.summary || '',
                wins: item.wins || '',
                problems: item.problems || '',
                tomorrowPlan: item.tomorrowPlan || '',
            })),
            exams,
        };
    }
    function saveLearningReport(report, userId = 1) {
        runtime.runSqlite(`INSERT INTO learning_reports (user_id, kind, period_start, period_end, title, payload_json, generated_at, updated_at)
    VALUES (${runtime.sqlValue(userId)}, ${runtime.sqlString(report.kind)}, ${runtime.sqlString(report.periodStart)}, ${runtime.sqlString(report.periodEnd)}, ${runtime.sqlString(report.title)}, ${runtime.sqlString(JSON.stringify(report))}, ${runtime.sqlString(report.generatedAt)}, datetime('now'))
    ON CONFLICT(user_id, kind, period_start, period_end) DO UPDATE SET
      title = excluded.title,
      payload_json = excluded.payload_json,
      generated_at = excluded.generated_at,
      updated_at = excluded.updated_at;`);
        if (userId === 1) runtime.notifyEvent({
            eventKey: `report:${report.kind}:${report.periodStart}:${report.periodEnd}`,
            source: 'report',
            severity: 'info',
            title: report.title,
            content: `${report.periodStart} 至 ${report.periodEnd} 的${report.kind === 'monthly' ? '月报' : '周报'}已生成。`,
            payload: { kind: report.kind, periodStart: report.periodStart, periodEnd: report.periodEnd, trigger: report.trigger },
        });
        return report;
    }
    function generateLearningReport(kind, periodStart, periodEnd, trigger = 'manual', userId = 1) {
        if (!['weekly', 'monthly'].includes(kind))
            throw new Error('Invalid report kind');
        return saveLearningReport(buildLearningReport(kind, periodStart, periodEnd, trigger, userId), userId);
    }
    function reportExists(kind, periodStart, periodEnd, userId = 1) {
        return Number(runtime.sqliteScalar(`SELECT COUNT(*) FROM learning_reports
    WHERE user_id = ${runtime.sqlValue(userId)} AND kind = ${runtime.sqlString(kind)} AND period_start = ${runtime.sqlString(periodStart)} AND period_end = ${runtime.sqlString(periodEnd)};`) || 0) > 0;
    }
    function ensureAutomaticReports({ includeCurrent = true } = {}) {
        const today = runtime.todayISO();
        for (const kind of ['weekly', 'monthly']) {
            const periods = [runtime.previousPeriod(kind, today)];
            if (includeCurrent)
                periods.push(runtime.currentPeriod(kind, today));
            for (const { periodStart, periodEnd } of periods) {
                if (includeCurrent || !reportExists(kind, periodStart, periodEnd)) {
                    generateLearningReport(kind, periodStart, periodEnd, 'auto');
                }
            }
        }
        runtime.runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
    VALUES ('last_report_check_at', ${runtime.sqlString(runtime.nowISO())}, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
    }
    async function precomputeNightlyArtifacts(trigger = 'nightly') {
        const today = runtime.todayISO();
        const timestamp = runtime.nowISO();
        try {
            await runErrorThemeBatch('1900-01-01', today, { mode: 'rules', modelProfile: 'rules' });
            ensureAutomaticReports({ includeCurrent: true });
            for (const days of [7, 30, 90]) {
                const from = days === 90 ? '1900-01-01' : runtime.addDaysISO(today, -(days - 1));
                runtime.setPrecomputedCache(`error-themes:${from}:${today}`, getErrorThemeAnalysis(from, today));
            }
            runtime.setPrecomputedCache(`review-trend:1:30:${today}`, runtime.getReviewTrendPayload(30, today, 1));
            runtime.setPrecomputedCache(`review-trend:1:90:${today}`, runtime.getReviewTrendPayload(90, today, 1));
            runtime.setPrecomputedCache(`dashboard-error-wall:${today}`, { items: runtime.getErrorThemeWall(12, 90, today) });
            runtime.runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
    VALUES ('last_precompute_at', ${runtime.sqlString(timestamp)}, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
    INSERT INTO app_metadata (key, value, updated_at)
    VALUES ('last_precompute_trigger', ${runtime.sqlString(trigger)}, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
    INSERT INTO app_metadata (key, value, updated_at)
    VALUES ('last_precompute_error', '', datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
            return { ok: true, ranAt: timestamp };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            runtime.runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
    VALUES ('last_precompute_error', ${runtime.sqlString(message)}, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
            return { ok: false, ranAt: timestamp, error: message };
        }
    }
    function listLearningReports(userId = 1) {
        const rows = runtime.sqliteJson(`SELECT id, kind, period_start AS periodStart, period_end AS periodEnd, title, payload_json AS payloadJson,
    generated_at AS generatedAt, updated_at AS updatedAt
    FROM learning_reports
    WHERE user_id = ${runtime.sqlValue(userId)}
    ORDER BY period_end DESC, kind DESC
    LIMIT 24;`);
        return rows.map((row) => ({ id: row.id, ...JSON.parse(row.payloadJson), generatedAt: row.generatedAt, updatedAt: row.updatedAt }));
    }

    exposeRuntime({ "minutesText": () => minutesText, "dateRange": () => dateRange, "compactText": () => compactText, "reviewProblemThemes": () => reviewProblemThemes, "reviewProblemFields": () => reviewProblemFields, "getErrorThemeOptions": () => getErrorThemeOptions, "themeOptionById": () => themeOptionById, "textIncludesKeyword": () => textIncludesKeyword, "matchedProblemExample": () => matchedProblemExample, "buildReviewProblemSummary": () => buildReviewProblemSummary, "splitReviewSentences": () => splitReviewSentences, "keywordMatches": () => keywordMatches, "looksLikeResolvedStatement": () => looksLikeResolvedStatement, "classifyReviewSegment": () => classifyReviewSegment, "sentenceHash": () => sentenceHash, "segmentKey": () => segmentKey, "extractReviewProblemSegments": () => extractReviewProblemSegments, "hasProblemCue": () => hasProblemCue, "isStudyNotDoneSegment": () => isStudyNotDoneSegment, "isEnglishReadingSegment": () => isEnglishReadingSegment, "isProfessionalCourseSegment": () => isProfessionalCourseSegment, "isMathErrorSegment": () => isMathErrorSegment, "isLearningMethodSegment": () => isLearningMethodSegment, "isMemoryRecallSegment": () => isMemoryRecallSegment, "isPlanningSegment": () => isPlanningSegment, "isClearlyPositiveSegment": () => isClearlyPositiveSegment, "extractRuleProblemCandidates": () => extractRuleProblemCandidates, "resolveEmbeddingPython": () => resolveEmbeddingPython, "normalizeEmbeddingModelProfile": () => normalizeEmbeddingModelProfile, "embeddingModelNameForProfile": () => embeddingModelNameForProfile, "getEmbeddingStatus": () => getEmbeddingStatus, "runEmbeddingWorker": () => runEmbeddingWorker, "cosineSimilarity": () => cosineSimilarity, "storeSentenceEmbeddings": () => storeSentenceEmbeddings, "themeSeedText": () => themeSeedText, "semanticThresholdForField": () => semanticThresholdForField, "extractEmbeddingProblemCandidates": () => extractEmbeddingProblemCandidates, "mergeProblemCandidates": () => mergeProblemCandidates, "loadErrorThemeCorrections": () => loadErrorThemeCorrections, "correctionMatchesSegment": () => correctionMatchesSegment, "extractCorrectionProblemCandidates": () => extractCorrectionProblemCandidates, "candidateRank": () => candidateRank, "dedupeProblemCandidates": () => dedupeProblemCandidates, "clearGeneratedErrorThemeOccurrences": () => clearGeneratedErrorThemeOccurrences, "upsertErrorTheme": () => upsertErrorTheme, "refreshErrorThemeStats": () => refreshErrorThemeStats, "saveErrorThemeCorrection": () => saveErrorThemeCorrection, "insertErrorThemeBatch": () => insertErrorThemeBatch, "recordFailedErrorThemeBatch": () => recordFailedErrorThemeBatch, "runErrorThemeBatch": () => runErrorThemeBatch, "currentErrorThemeJobSnapshot": () => currentErrorThemeJobSnapshot, "refreshCurrentReportsAfterBatch": () => refreshCurrentReportsAfterBatch, "startErrorThemeBatchJob": () => startErrorThemeBatchJob, "nextChinaThreeAMDelay": () => nextChinaThreeAMDelay, "scheduleNightlyErrorThemeBatch": () => scheduleNightlyErrorThemeBatch, "getErrorThemePeriodSummary": () => getErrorThemePeriodSummary, "getErrorThemeAnalysis": () => getErrorThemeAnalysis, "getCachedErrorThemeAnalysis": () => getCachedErrorThemeAnalysis, "getErrorThemeDetail": () => getErrorThemeDetail, "buildReportTitle": () => buildReportTitle, "buildLearningReport": () => buildLearningReport, "saveLearningReport": () => saveLearningReport, "generateLearningReport": () => generateLearningReport, "reportExists": () => reportExists, "ensureAutomaticReports": () => ensureAutomaticReports, "precomputeNightlyArtifacts": () => precomputeNightlyArtifacts, "listLearningReports": () => listLearningReports }, {  });
}
