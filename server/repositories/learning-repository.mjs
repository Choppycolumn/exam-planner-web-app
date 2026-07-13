export function createLearningRepository(database) {
  function listReviews({ from, to, limit, offset = 0 }) {
    const total = Number(database.scalar(
      'SELECT COUNT(*) FROM daily_reviews WHERE date BETWEEN ? AND ?;',
      [from, to],
    ) || 0);
    const paging = limit ? ' LIMIT ? OFFSET ?' : '';
    const parameters = limit ? [from, to, limit, offset] : [from, to];
    const reviews = database.json(`SELECT id, date, summary, wins, problems,
tomorrow_plan AS tomorrowPlan, score, schema_version AS schemaVersion,
created_at AS createdAt, updated_at AS updatedAt
FROM daily_reviews
WHERE date BETWEEN ? AND ?
ORDER BY date DESC${paging};`, parameters);
    return { total, reviews };
  }

  function listStudyRecords(date, userId = 1) {
    return database.json(`SELECT id, date, project_id AS projectId,
project_name_snapshot AS projectNameSnapshot, minutes, note,
schema_version AS schemaVersion, created_at AS createdAt, updated_at AS updatedAt
FROM study_time_records
WHERE date = ? AND user_id = ?
ORDER BY project_id;`, [date, userId]);
  }

  function activateGoal(id, updatedAt) {
    database.execute(`UPDATE goals
SET is_active = CASE WHEN id = ? THEN 1 ELSE 0 END, updated_at = ?;`, [id, updatedAt]);
  }

  const mutations = {
    removeGoal: (id) => database.execute('DELETE FROM goals WHERE id = ?;', [id]),
    removeProject: (id, updatedAt, userId = 1) => database.execute(
      'UPDATE study_projects SET is_active = 0, updated_at = ? WHERE id = ? AND user_id = ?;',
      [updatedAt, id, userId],
    ),
    removeSubject: (id, updatedAt) => database.execute(
      'UPDATE subjects SET is_active = 0, updated_at = ? WHERE id = ?;',
      [updatedAt, id],
    ),
    removeExam: (id) => database.execute('DELETE FROM mock_exam_records WHERE id = ?;', [id]),
    removeTask: (id) => database.execute('DELETE FROM short_term_tasks WHERE id = ?;', [id]),
    toggleTask: (id, completed, updatedAt) => database.execute(`UPDATE short_term_tasks
SET is_completed = ?, completed_at = ?, updated_at = ? WHERE id = ?;`,
    [completed ? 1 : 0, completed ? updatedAt : null, updatedAt, id]),
  };

  return {
    listReviews,
    listStudyRecords,
    embeddingCount: () => Number(database.scalar('SELECT COUNT(*) FROM review_sentence_embeddings;') || 0),
    activateGoal,
    ...mutations,
  };
}
