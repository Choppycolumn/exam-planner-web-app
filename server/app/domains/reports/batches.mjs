export function installReportBatchDomain(runtime, exposeRuntime) {
    const ownerUserId = () => runtime.userAccountRepository.getOwnerUserId();
    function clearGeneratedErrorThemeOccurrences(periodStart, periodEnd) {
        runtime.reportRepository.clearGeneratedOccurrences(periodStart, periodEnd);
    }
    function upsertErrorTheme(themeId, label, timestamp) {
        return runtime.reportRepository.upsertTheme(themeId, label, timestamp);
    }
    function refreshErrorThemeStats() {
        runtime.reportRepository.refreshThemeStats(runtime.nowISO());
    }
    function saveErrorThemeCorrection(payload) {
        runtime.ensureSqliteStore();
        const timestamp = runtime.nowISO();
        const occurrenceId = Number(payload.occurrenceId || 0);
        const occurrence = occurrenceId
            ? runtime.reportRepository.getOccurrence(occurrenceId)
            : null;
        const sentence = String(payload.sentence || occurrence?.evidence || '').trim();
        if (!sentence)
            throw new Error('Missing correction sentence');
        const action = payload.action === 'ignore' ? 'ignore' : 'relabel';
        const target = action === 'relabel' ? runtime.themeOptionById(payload.targetThemeKey) : null;
        if (action === 'relabel' && !target)
            throw new Error('Invalid target theme');
        const hash = runtime.sentenceHash(sentence);
        runtime.reportRepository.upsertCorrection({
            sentenceHash: hash,
            sentence,
            action,
            targetThemeKey: target?.id || null,
            targetLabel: target?.label || null,
            sourceThemeKey: payload.sourceThemeKey || occurrence?.sourceThemeKey || null,
            sourceLabel: payload.sourceLabel || occurrence?.sourceLabel || null,
            reviewId: Number(payload.reviewId || occurrence?.reviewId || 0) || null,
            date: payload.date || occurrence?.date || null,
            field: payload.field || occurrence?.field || null,
            createdAt: timestamp,
            updatedAt: timestamp,
        });
        if (occurrenceId && action === 'ignore') {
            runtime.reportRepository.deleteOccurrence(occurrenceId);
        }
        else if (occurrenceId && target) {
            const targetThemeId = upsertErrorTheme(target.id, target.label, timestamp);
            runtime.reportRepository.relabelOccurrence(occurrenceId, targetThemeId, timestamp);
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
        return runtime.reportRepository.insertBatch({
            periodStart,
            periodEnd,
            reviewCount,
            occurrenceCount,
            themeCount,
            timestamp,
            completedAt,
            source,
            modelName,
            note,
            status,
        });
    }
    function recordFailedErrorThemeBatch({ periodStart, periodEnd, modelName, note }) {
        const timestamp = runtime.nowISO();
        const reviewCount = runtime.reportRepository.countReviews(ownerUserId(), periodStart, periodEnd);
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
        const modelProfile = runtime.normalizeEmbeddingModelProfile(options.modelProfile);
        const { reviews, inboxItems } = runtime.reportRepository.reviewSources(ownerUserId(), from, to);
        const inboxReviews = inboxItems.map((item) => ({
            id: -Math.abs(Number(item.id)),
            date: item.date,
            summary: '',
            wins: '',
            problems: item.text,
            tomorrowPlan: '',
        }));
        const reviewSources = [...reviews, ...inboxReviews];
        const corrections = runtime.loadErrorThemeCorrections();
        const correctionResult = runtime.extractCorrectionProblemCandidates(reviewSources, corrections);
        let embeddingMeta = null;
        let candidates = correctionResult.candidates;
        if (options.mode === 'rules') {
            candidates = runtime.mergeProblemCandidates(correctionResult.candidates, runtime.extractRuleProblemCandidates(reviewSources, correctionResult.handledSegmentKeys));
        }
        else {
            embeddingMeta = await runtime.extractEmbeddingProblemCandidates(reviewSources, timestamp, correctionResult.handledSegmentKeys, modelProfile);
            const ruleCandidates = runtime.extractRuleProblemCandidates(reviewSources, correctionResult.handledSegmentKeys);
            candidates = runtime.mergeProblemCandidates(correctionResult.candidates, runtime.mergeProblemCandidates(embeddingMeta.candidates, ruleCandidates));
        }
        const rawCandidateCount = candidates.length;
        candidates = runtime.dedupeProblemCandidates(candidates);
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
            runtime.reportRepository.insertOccurrence({
                themeId: themeRowId,
                batchId,
                reviewId: candidate.reviewId,
                date: candidate.date,
                field: candidate.field,
                evidence: candidate.evidence,
                confidence: candidate.confidence,
                source: candidate.source || batchSource,
                createdAt: timestamp,
            });
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
                    runtime.generateLearningReport(kind, period.periodStart, period.periodEnd, trigger);
                }
            }
            runtime.appMetadataRepository.set('last_report_precomputed_at', runtime.nowISO());
        }
        catch (error) {
            console.error('[reports] refresh after error theme batch failed:', error);
        }
    }
    function startErrorThemeBatchJob({ periodStart = '1900-01-01', periodEnd = runtime.todayISO(), mode = 'rules', trigger = 'manual', modelProfile = 'large' } = {}) {
        if (runtime.errorThemeBatchJob?.status === 'running' || runtime.errorThemeBatchJob?.status === 'queued') {
            return { started: false, job: currentErrorThemeJobSnapshot() };
        }
        const selectedProfile = runtime.normalizeEmbeddingModelProfile(modelProfile);
        const selectedModelName = runtime.embeddingModelNameForProfile(selectedProfile);
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
        const [hourText, minuteText] = String(process.env.ERROR_THEME_TIME || '03:30').split(':');
        const parsedHour = Number(hourText);
        const parsedMinute = Number(minuteText);
        const hour = Math.max(0, Math.min(23, Number.isFinite(parsedHour) ? parsedHour : 3));
        const minute = Math.max(0, Math.min(59, Number.isFinite(parsedMinute) ? parsedMinute : 30));
        const targetChina = new Date(Date.UTC(chinaNow.getUTCFullYear(), chinaNow.getUTCMonth(), chinaNow.getUTCDate(), hour, minute, 0, 0));
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
    exposeRuntime({
        clearGeneratedErrorThemeOccurrences: () => clearGeneratedErrorThemeOccurrences,
        upsertErrorTheme: () => upsertErrorTheme,
        refreshErrorThemeStats: () => refreshErrorThemeStats,
        saveErrorThemeCorrection: () => saveErrorThemeCorrection,
        insertErrorThemeBatch: () => insertErrorThemeBatch,
        recordFailedErrorThemeBatch: () => recordFailedErrorThemeBatch,
        runErrorThemeBatch: () => runErrorThemeBatch,
        currentErrorThemeJobSnapshot: () => currentErrorThemeJobSnapshot,
        refreshCurrentReportsAfterBatch: () => refreshCurrentReportsAfterBatch,
        startErrorThemeBatchJob: () => startErrorThemeBatchJob,
        nextChinaThreeAMDelay: () => nextChinaThreeAMDelay,
        scheduleNightlyErrorThemeBatch: () => scheduleNightlyErrorThemeBatch,
    });
}
