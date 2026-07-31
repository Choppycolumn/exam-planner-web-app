export function installLearningObservabilityDomain(runtime, exposeRuntime) {
    const ownerUserId = () => runtime.userAccountRepository.getOwnerUserId();
    function shouldRecordVisit(req) {
        if (req.method !== 'GET')
            return false;
        const pathname = new URL(req.url || '/', 'http://localhost').pathname;
        if (pathname === '/login' || pathname === '/health' || pathname.startsWith('/api/'))
            return false;
        if (['/manifest.webmanifest', '/service-worker.js', '/app-icon.svg', '/favicon.svg', '/icons.svg'].includes(pathname))
            return false;
        return !runtime.extname(pathname);
    }
    function recordVisitEvent(req, role = 'write') {
        if (!shouldRecordVisit(req))
            return;
        try {
            runtime.ensureSqliteStore();
            const requestUrl = new URL(req.url || '/', 'http://localhost');
            const userAgent = String(req.headers['user-agent'] || '').slice(0, 240);
            const clientHash = runtime.createHash('sha256').update(`${runtime.getClientIp(req)}|${userAgent}`).digest('hex').slice(0, 24);
            runtime.opsRepository.recordVisit({
                path: requestUrl.pathname,
                method: req.method || 'GET',
                role,
                clientHash,
                userAgent,
                createdAt: runtime.nowISO(),
            });
        }
        catch (error) {
            console.warn('visit event skipped:', error.message || error);
        }
    }
    function getVisitStatsPayload(sessionRole = 'write') {
        runtime.ensureSqliteStore();
        const today = runtime.todayISO();
        const start14 = runtime.addDaysISO(today, -13);
        const start7 = runtime.addDaysISO(today, -6);
        const visitStats = runtime.opsRepository.getVisitStats({ today, start7, start14 });
        const dailyRows = visitStats.dailyRows;
        const byDate = new Map(dailyRows.map((row) => [row.date, row]));
        const daily = runtime.dateRange(start14, today).map((date) => ({
            date,
            visits: Number(byDate.get(date)?.visits || 0),
            uniqueVisitors: Number(byDate.get(date)?.uniqueVisitors || 0),
        }));
        const topPaths = visitStats.topPaths.map((row) => ({ path: row.path, visits: Number(row.visits || 0) }));
        const latest = visitStats.latest.map((row) => ({ path: row.path, role: row.role, userAgent: runtime.compactText(row.userAgent || '', 90), createdAt: row.createdAt }));
        return {
            generatedAt: runtime.nowISO(),
            total: visitStats.total,
            today: visitStats.todayCount,
            last7: visitStats.last7,
            uniqueVisitors7: visitStats.uniqueVisitors7,
            daily,
            topPaths,
            latest,
            readOnly: sessionRole === 'read',
        };
    }
    function redactLogLine(line = '') {
        return String(line)
            .replace(/(password|passwd|token|secret|cookie|authorization)(=|:)\s*[^,\s;]+/gi, '$1$2 [redacted]')
            .replace(/exam_planner_session=[^;\s]+/gi, 'exam_planner_session=[redacted]')
            .replace(/APP_PASSWORD=[^,\s;]+/gi, 'APP_PASSWORD=[redacted]')
            .slice(0, 500);
    }
    function summarizeLogLines(name, lines, error = '') {
        const cleanLines = lines.filter(Boolean).slice(-80).map(redactLogLine);
        const errorCount = cleanLines.filter((line) => /error|failed|exception|fatal/i.test(line)).length;
        const warningCount = cleanLines.filter((line) => /warn|warning|deprecated/i.test(line)).length;
        return {
            name,
            available: !error,
            error: error || undefined,
            errorCount,
            warningCount,
            action: error
                ? '检查日志读取权限或对应服务状态'
                : errorCount
                    ? '检查近期错误并确认核心功能是否受影响'
                    : '',
            observation: !error && !errorCount && warningCount ? '发现少量 warning，暂列观察，不触发处理项' : '',
        };
    }
    function readTailFile(filePath, maxLines = 80) {
        if (!runtime.existsSync(filePath))
            return { lines: [], error: 'file not found' };
        const text = runtime.readFileSync(filePath, 'utf8');
        return { lines: text.split(/\r?\n/).slice(-maxLines), error: '' };
    }
    async function getOpsLogSummaryPayload(sessionRole = 'write') {
        runtime.ensureSqliteStore();
        const sources = [];
        const journal = await runtime.runProcess('journalctl', ['-u', 'exam-planner', '-n', '120', '--no-pager'], { timeoutMs: 5000, maxBuffer: 512 * 1024 });
        if (!journal.ok) {
            sources.push(summarizeLogLines('systemd:exam-planner', [], journal.error?.message || journal.stderr || 'journalctl unavailable'));
        }
        else {
            sources.push(summarizeLogLines('systemd:exam-planner', journal.stdout.split(/\r?\n/)));
        }
        for (const [name, filePath] of [['nginx:access', '/var/log/nginx/access.log'], ['nginx:error', '/var/log/nginx/error.log']]) {
            try {
                const result = readTailFile(filePath);
                sources.push(summarizeLogLines(name, result.lines, result.error));
            }
            catch (error) {
                sources.push(summarizeLogLines(name, [], error.message || String(error)));
            }
        }
        const auditEvents = runtime.opsRepository.listAuditEvents(12);
        const slowApi = runtime.opsRepository.listSlowApi(12);
        const apiMetrics = runtime.opsRepository.getApiMetrics();
        const clientErrors = {
            metrics: runtime.opsRepository.getClientErrorMetrics(),
            latest: runtime.opsRepository.listClientErrors(12),
        };
        return { generatedAt: runtime.nowISO(), sources, auditEvents, slowApi, apiMetrics, clientErrors, readOnly: sessionRole === 'read' };
    }
    function getGoalsList(sessionRole, userId = ownerUserId()) {
        const items = runtime.learningQueryRepository.listGoals(userId)
            .map((goal) => ({ ...goal, isActive: Boolean(goal.isActive) }));
        return { items, readOnly: sessionRole === 'read' };
    }
    function getProjectsList(sessionRole, userId = ownerUserId()) {
        const items = runtime.learningQueryRepository.listProjects(userId)
            .map((project) => ({ ...project, isActive: Boolean(project.isActive) }));
        return { items, readOnly: sessionRole === 'read' };
    }
    function getSubjectsList(sessionRole, userId = ownerUserId()) {
        const items = runtime.learningQueryRepository.listSubjects(userId)
            .map((subject) => ({ ...subject, isActive: Boolean(subject.isActive) }));
        return { items, readOnly: sessionRole === 'read' };
    }
    function getMockExamList(requestUrl, sessionRole, userId = ownerUserId()) {
        const subjectIdParam = requestUrl.searchParams.get('subjectId') || 'all';
        const subjectId = subjectIdParam === 'all' ? null : Number(subjectIdParam);
        const limit = runtime.queryLimit(requestUrl.searchParams, 20, 100) ?? 20;
        const offset = runtime.queryOffset(requestUrl.searchParams);
        const summary = runtime.learningQueryRepository.mockExamSummary(userId, { subjectId, limit, offset });
        const trend = summary.trend
            .sort((a, b) => a.date.localeCompare(b.date) || Number(a.id || 0) - Number(b.id || 0))
            .map((exam) => ({ date: exam.date, score: Number(exam.score || 0) }));
        return {
            exams: summary.exams,
            total: summary.total,
            limit: summary.limit,
            offset: summary.offset,
            stats: {
                latest: summary.latest,
                highest: summary.stats.highest == null ? null : Number(summary.stats.highest),
                average: summary.stats.average == null ? null : Number(summary.stats.average),
                lowest: summary.stats.lowest == null ? null : Number(summary.stats.lowest),
            },
            trend,
            readOnly: sessionRole === 'read',
        };
    }
    function normalizeReview(review) {
        if (typeof review.score === 'number')
            return review;
        if (typeof review.statusScore === 'number' && typeof review.satisfactionScore === 'number') {
            return { ...review, score: Math.round(((review.statusScore + review.satisfactionScore) / 10) * 10) };
        }
        return { ...review, score: 6 };
    }

    exposeRuntime({
        shouldRecordVisit: () => shouldRecordVisit,
        recordVisitEvent: () => recordVisitEvent,
        getVisitStatsPayload: () => getVisitStatsPayload,
        redactLogLine: () => redactLogLine,
        summarizeLogLines: () => summarizeLogLines,
        readTailFile: () => readTailFile,
        getOpsLogSummaryPayload: () => getOpsLogSummaryPayload,
        getGoalsList: () => getGoalsList,
        getProjectsList: () => getProjectsList,
        getSubjectsList: () => getSubjectsList,
        getMockExamList: () => getMockExamList,
        normalizeReview: () => normalizeReview,
    });
}
