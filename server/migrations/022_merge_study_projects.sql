-- Consolidate duplicate study projects while preserving accumulated minutes.

UPDATE study_projects
SET name = '英一', updated_at = datetime('now')
WHERE name = '英语单词'
  AND NOT EXISTS (SELECT 1 FROM study_projects WHERE name = '英一');

INSERT INTO study_time_records
(date, project_id, project_name_snapshot, minutes, note, schema_version, created_at, updated_at)
SELECT source.date, target.id, target.name, source.minutes, source.note,
       source.schema_version, source.created_at, datetime('now')
FROM study_time_records source
JOIN study_projects source_project ON source_project.id = source.project_id AND source_project.name = '英语单词'
JOIN study_projects target ON target.name = '英一'
WHERE source.project_id <> target.id
ON CONFLICT(date, project_id) DO UPDATE SET
  minutes = study_time_records.minutes + excluded.minutes,
  project_name_snapshot = '英一',
  note = trim(study_time_records.note || CASE WHEN study_time_records.note <> '' AND excluded.note <> '' THEN '；' ELSE '' END || excluded.note),
  updated_at = datetime('now');
DELETE FROM study_time_records WHERE project_id IN (SELECT id FROM study_projects WHERE name = '英语单词');
DELETE FROM study_projects WHERE name = '英语单词';
UPDATE study_time_records SET project_name_snapshot = '英一' WHERE project_id IN (SELECT id FROM study_projects WHERE name = '英一');

UPDATE study_projects
SET name = '信号与系统', updated_at = datetime('now')
WHERE name = '专业课'
  AND NOT EXISTS (SELECT 1 FROM study_projects WHERE name = '信号与系统');

INSERT INTO study_time_records
(date, project_id, project_name_snapshot, minutes, note, schema_version, created_at, updated_at)
SELECT source.date, target.id, target.name, source.minutes, source.note,
       source.schema_version, source.created_at, datetime('now')
FROM study_time_records source
JOIN study_projects source_project ON source_project.id = source.project_id AND source_project.name = '专业课'
JOIN study_projects target ON target.name = '信号与系统'
WHERE source.project_id <> target.id
ON CONFLICT(date, project_id) DO UPDATE SET
  minutes = study_time_records.minutes + excluded.minutes,
  project_name_snapshot = '信号与系统',
  note = trim(study_time_records.note || CASE WHEN study_time_records.note <> '' AND excluded.note <> '' THEN '；' ELSE '' END || excluded.note),
  updated_at = datetime('now');
DELETE FROM study_time_records WHERE project_id IN (SELECT id FROM study_projects WHERE name = '专业课');
DELETE FROM study_projects WHERE name = '专业课';
UPDATE study_time_records SET project_name_snapshot = '信号与系统' WHERE project_id IN (SELECT id FROM study_projects WHERE name = '信号与系统');

UPDATE study_projects
SET name = '高等数学', updated_at = datetime('now')
WHERE name = '1000题a组'
  AND NOT EXISTS (SELECT 1 FROM study_projects WHERE name = '高等数学');

INSERT INTO study_time_records
(date, project_id, project_name_snapshot, minutes, note, schema_version, created_at, updated_at)
SELECT source.date, target.id, target.name, source.minutes, source.note,
       source.schema_version, source.created_at, datetime('now')
FROM study_time_records source
JOIN study_projects source_project ON source_project.id = source.project_id AND source_project.name = '1000题a组'
JOIN study_projects target ON target.name = '高等数学'
WHERE source.project_id <> target.id
ON CONFLICT(date, project_id) DO UPDATE SET
  minutes = study_time_records.minutes + excluded.minutes,
  project_name_snapshot = '高等数学',
  note = trim(study_time_records.note || CASE WHEN study_time_records.note <> '' AND excluded.note <> '' THEN '；' ELSE '' END || excluded.note),
  updated_at = datetime('now');
DELETE FROM study_time_records WHERE project_id IN (SELECT id FROM study_projects WHERE name = '1000题a组');
DELETE FROM study_projects WHERE name = '1000题a组';
UPDATE study_time_records SET project_name_snapshot = '高等数学' WHERE project_id IN (SELECT id FROM study_projects WHERE name = '高等数学');

DELETE FROM study_time_records WHERE project_id IN (SELECT id FROM study_projects WHERE name = '复盘总结');
DELETE FROM study_projects WHERE name = '复盘总结';

DELETE FROM study_daily_summaries;
DELETE FROM study_project_daily_summaries;
DELETE FROM app_metadata WHERE key = 'study_summaries_rebuilt_at';
