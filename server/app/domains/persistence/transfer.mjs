export function installPersistenceTransferDomain(runtime, exposeRuntime) {
    function ownerUserId() {
        return runtime.userAccountRepository.findOwnerUserId();
    }

    function writeStateToTables(state) {
        const normalized = runtime.normalizeState(state);
        runtime.stateRepository.replaceOwnerState(normalized, {
            ownerUserId: ownerUserId(),
            now: runtime.nowISO(),
            today: runtime.todayISO(),
            schemaVersion: runtime.entitySchemaVersion,
            projectColors: runtime.projectColors,
            subjectColors: runtime.subjectColors,
            normalizeDueTime: runtime.normalizeTaskDueTime,
            normalizeOffsets: runtime.normalizeReminderSentOffsets,
        });
        runtime.rebuildStudySummaries();
    }

    function readStateFromTables() {
        const state = runtime.stateRepository.readOwnerState(ownerUserId());
        return runtime.normalizeState({
            ...state,
            goals: state.goals.map((item) => ({ ...item, isActive: Boolean(item.isActive) })),
            dailyReviews: state.dailyReviews.map(runtime.normalizeReview),
            studyProjects: state.studyProjects.map((item) => ({ ...item, isActive: Boolean(item.isActive) })),
            subjects: state.subjects.map((item) => ({ ...item, isActive: Boolean(item.isActive) })),
            shortTermTasks: state.shortTermTasks.map(runtime.normalizeTaskRow),
        });
    }

    function readLegacyStateForMigration() {
        if (runtime.stateRepository.appStateExists())
            return runtime.readStateFromSqlite();
        if (runtime.existsSync(runtime.legacyDataFile))
            return runtime.normalizeState(JSON.parse(runtime.readFileSync(runtime.legacyDataFile, 'utf8')));
        return runtime.baseState();
    }

    exposeRuntime({
        writeStateToTables: () => writeStateToTables,
        readStateFromTables: () => readStateFromTables,
        readLegacyStateForMigration: () => readLegacyStateForMigration,
    });
}
