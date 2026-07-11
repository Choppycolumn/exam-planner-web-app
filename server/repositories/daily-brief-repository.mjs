export function createDailyBriefRepository(database) {
  return {
    markEmailed(id, timestamp) {
      database.execute(`UPDATE daily_briefs
SET emailed_at = ?, email_error = '', updated_at = ?
WHERE id = ?;`, [timestamp, timestamp, id]);
    },
  };
}
