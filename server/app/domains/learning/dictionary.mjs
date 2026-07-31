export function installLearningDictionaryDomain(runtime, exposeRuntime) {
    const ownerUserId = () => runtime.userAccountRepository.getOwnerUserId();
    function readState() {
        runtime.ensureSqliteStore();
        return runtime.readStateFromTables();
    }
    function writeState(state) {
        runtime.ensureSqliteStore();
        runtime.writeStateToTables(state);
        runtime.tableChanged();
    }
    function countConfusingWordsGroups(groups = []) {
        const safeGroups = Array.isArray(groups) ? groups : [];
        return {
            groupCount: safeGroups.length,
            wordCount: safeGroups.reduce((sum, group) => sum + (Array.isArray(group?.words) ? group.words.length : 0), 0),
        };
    }
    function normalizeConfusingWordsPayload(input = {}, timestamp = runtime.nowISO()) {
        const groups = Array.isArray(input.groups) ? input.groups : [];
        return {
            schemaVersion: Number(input.schemaVersion || runtime.entitySchemaVersion),
            exportedAt: input.exportedAt || timestamp,
            backedUpAt: input.backedUpAt || timestamp,
            groups,
        };
    }
    function hashConfusingWordsPayload(payload) {
        return runtime.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    }
    function summarizeConfusingWordsPayload(payload) {
        const counts = countConfusingWordsGroups(payload?.groups);
        const payloadText = JSON.stringify(payload || {});
        return {
            ...counts,
            payloadBytes: Buffer.byteLength(payloadText, 'utf8'),
            payloadHash: hashConfusingWordsPayload(payload || {}),
        };
    }
    function readConfusingWordsBackupPayload(userId = ownerUserId()) {
        const payloadJson = runtime.confusingWordsRepository.readPayload(userId);
        if (!payloadJson)
            return null;
        try {
            return JSON.parse(payloadJson);
        }
        catch {
            return null;
        }
    }
    function insertConfusingWordsBackupVersion(payload, source = 'sync', userId = ownerUserId()) {
        if (!payload)
            return null;
        const timestamp = runtime.nowISO();
        const summary = summarizeConfusingWordsPayload(payload);
        const latestHash = runtime.confusingWordsRepository.latestHash(userId);
        if (latestHash === summary.payloadHash)
            return { skipped: true, ...summary };
        runtime.confusingWordsRepository.insertVersion(userId, payload, source, summary, timestamp);
        return { skipped: false, ...summary };
    }
    function saveConfusingWordsBackupPayload(payload, source = 'sync', userId = ownerUserId()) {
        runtime.ensureSqliteStore();
        const timestamp = runtime.nowISO();
        const normalized = normalizeConfusingWordsPayload(payload, timestamp);
        const summary = summarizeConfusingWordsPayload(normalized);
        const current = readConfusingWordsBackupPayload(userId);
        if (current)
            insertConfusingWordsBackupVersion(current, 'before-' + source, userId);
        insertConfusingWordsBackupVersion(normalized, source, userId);
        runtime.confusingWordsRepository.upsertCurrent(userId, normalized);
        runtime.tableChanged();
        return { payload: normalized, summary };
    }
    function listConfusingWordsBackupVersions(limit = 20, userId = ownerUserId()) {
        runtime.ensureSqliteStore();
        return runtime.confusingWordsRepository.listVersions(userId, limit).map((item) => ({
            ...item,
            groupCount: Number(item.groupCount || 0),
            wordCount: Number(item.wordCount || 0),
            payloadBytes: Number(item.payloadBytes || 0),
            payloadHash: String(item.payloadHash || '').slice(0, 12),
        }));
    }
    function seedCurrentConfusingWordsBackupVersionIfNeeded() {
        const ownerId = runtime.userAccountRepository.getOwnerUserId();
        const current = readConfusingWordsBackupPayload(ownerId);
        if (!current)
            return;
        const versionCount = runtime.confusingWordsRepository.countVersions(ownerId);
        if (versionCount > 0)
            return;
        insertConfusingWordsBackupVersion(current, 'current-seed', ownerId);
    }
    function cleanChineseDefinition(value = '') {
        return value
            .split(/\n+/)
            .map((line) => line.trim())
            .filter((line) => line && !line.startsWith('[网络]'))
            .join('；')
            .replace(/\s+/g, ' ')
            .trim();
    }
    function buildDictionaryEntry(fields) {
        const [word, phonetic, definition, translation, partOfSpeech] = fields;
        const key = word?.trim().toLowerCase();
        const chineseDefinition = cleanChineseDefinition(translation);
        if (!key || !chineseDefinition)
            return null;
        return {
            word: key,
            phonetic: phonetic || '',
            englishDefinition: definition || '',
            chineseDefinition,
            partOfSpeech: partOfSpeech || '',
        };
    }
    function ensureDictionaryIndex() {
        return runtime.dictionaryService.ensureReady();
    }
    function findDictionaryEntry(targetWord) {
        const key = targetWord.trim().toLowerCase();
        if (!key)
            return null;
        const row = runtime.dictionaryService.find(key);
        if (!row)
            return null;
        const entry = buildDictionaryEntry([
            row.word,
            row.phonetic,
            row.english_definition,
            row.chinese_definition,
            row.part_of_speech,
        ]);
        return entry ? { ...entry, source: 'local-ecdict-sqlite' } : null;
    }
    exposeRuntime({
        readState: () => readState,
        writeState: () => writeState,
        countConfusingWordsGroups: () => countConfusingWordsGroups,
        normalizeConfusingWordsPayload: () => normalizeConfusingWordsPayload,
        hashConfusingWordsPayload: () => hashConfusingWordsPayload,
        summarizeConfusingWordsPayload: () => summarizeConfusingWordsPayload,
        readConfusingWordsBackupPayload: () => readConfusingWordsBackupPayload,
        insertConfusingWordsBackupVersion: () => insertConfusingWordsBackupVersion,
        saveConfusingWordsBackupPayload: () => saveConfusingWordsBackupPayload,
        listConfusingWordsBackupVersions: () => listConfusingWordsBackupVersions,
        seedCurrentConfusingWordsBackupVersionIfNeeded: () => seedCurrentConfusingWordsBackupVersionIfNeeded,
        cleanChineseDefinition: () => cleanChineseDefinition,
        buildDictionaryEntry: () => buildDictionaryEntry,
        ensureDictionaryIndex: () => ensureDictionaryIndex,
        findDictionaryEntry: () => findDictionaryEntry,
    });
}
