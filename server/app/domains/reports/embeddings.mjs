export function installReportEmbeddingDomain(runtime, exposeRuntime) {
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
        runtime.reportRepository.storeSentenceEmbeddings(
            segments,
            vectors,
            backend,
            modelName,
            dimensions,
            timestamp,
        );
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
        const segments = runtime.extractReviewProblemSegments(reviews);
        if (!segments.length) {
            return { candidates: [], modelName: requestedModelName, modelProfile: selectedProfile, source: 'local-embedding-batch', backend: 'fastembed', dimensions: 0, embeddedSentenceCount: 0 };
        }
        const seedTexts = runtime.reviewProblemThemes.map(themeSeedText);
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
            if (skippedSegmentKeys.has(runtime.segmentKey(segment)))
                return;
            if (!runtime.hasProblemCue(segment.sentence, segment.fieldKey))
                return;
            if (runtime.isClearlyPositiveSegment(segment.sentence, segment.fieldKey))
                return;
            if (runtime.classifyReviewSegment(segment.sentence, segment.fieldKey))
                return;
            let best = null;
            let secondBest = null;
            seedVectors.forEach((seedVector, seedIndex) => {
                const similarity = cosineSimilarity(vector, seedVector);
                if (!best || similarity > best.similarity) {
                    secondBest = best;
                    best = { similarity, theme: runtime.reviewProblemThemes[seedIndex] };
                }
                else if (!secondBest || similarity > secondBest.similarity) {
                    secondBest = { similarity, theme: runtime.reviewProblemThemes[seedIndex] };
                }
            });
            if (!best)
                return;
            const cue = runtime.hasProblemCue(segment.sentence, segment.fieldKey);
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
        return runtime.reportRepository.listCorrections();
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
        const segments = runtime.extractReviewProblemSegments(reviews);
        for (const segment of segments) {
            const correction = corrections.find((item) => correctionMatchesSegment(item, segment));
            if (!correction)
                continue;
            handledSegmentKeys.add(runtime.segmentKey(segment));
            if (correction.action === 'ignore')
                continue;
            const target = runtime.themeOptionById(correction.targetThemeKey);
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
    exposeRuntime({
        resolveEmbeddingPython: () => resolveEmbeddingPython,
        normalizeEmbeddingModelProfile: () => normalizeEmbeddingModelProfile,
        embeddingModelNameForProfile: () => embeddingModelNameForProfile,
        getEmbeddingStatus: () => getEmbeddingStatus,
        runEmbeddingWorker: () => runEmbeddingWorker,
        cosineSimilarity: () => cosineSimilarity,
        storeSentenceEmbeddings: () => storeSentenceEmbeddings,
        themeSeedText: () => themeSeedText,
        semanticThresholdForField: () => semanticThresholdForField,
        extractEmbeddingProblemCandidates: () => extractEmbeddingProblemCandidates,
        mergeProblemCandidates: () => mergeProblemCandidates,
        loadErrorThemeCorrections: () => loadErrorThemeCorrections,
        correctionMatchesSegment: () => correctionMatchesSegment,
        extractCorrectionProblemCandidates: () => extractCorrectionProblemCandidates,
        candidateRank: () => candidateRank,
        dedupeProblemCandidates: () => dedupeProblemCandidates,
    });
}
