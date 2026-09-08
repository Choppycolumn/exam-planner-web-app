import { sqlString, sqlValue } from './sqlite-repository.mjs';
import { DEFAULT_SEAT_ASSISTANT_PROFILE, normalizeProfile, redactSensitiveText } from './seat-assistant-policy.mjs';

function parseJson(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function normalizeProfileRow(row) {
  if (!row) return { ...DEFAULT_SEAT_ASSISTANT_PROFILE };
  return normalizeProfile({
    id: Number(row.id || 1),
    enabled: Boolean(row.enabled),
    venue: row.venue,
    dateMode: row.dateMode,
    startTime: row.startTime,
    endTime: row.endTime,
    areaPreference: parseJson(row.areaPreferenceJson, []),
    seatPreference: parseJson(row.seatPreferenceJson, []),
    pollIntervalSeconds: row.pollIntervalSeconds,
    jitterSeconds: row.jitterSeconds,
    nearIntervalSeconds: row.nearIntervalSeconds,
  });
}

function normalizeSession(row) {
  return row ? {
    status: row.status,
    providerName: row.providerName,
    message: row.message || '',
    lastCheckedAt: row.lastCheckedAt || null,
    lastAttemptAt: row.lastAttemptAt || null,
    lastSuccessAt: row.lastSuccessAt || null,
    nextCheckAt: row.nextCheckAt || null,
    consecutiveFailures: Number(row.consecutiveFailures || 0),
    lastNotifiedStatus: row.lastNotifiedStatus || '',
    updatedAt: row.updatedAt || null,
  } : {
    status: 'disconnected', providerName: 'disabled', message: '', lastCheckedAt: null, lastSuccessAt: null,
    nextCheckAt: null, consecutiveFailures: 0, lastNotifiedStatus: '', lastAttemptAt: null, updatedAt: null,
  };
}

function normalizeObservation(row) {
  return row ? {
    id: Number(row.id),
    observedAt: row.observedAt,
    targetDate: row.targetDate,
    venue: row.venue,
    totalSeats: Number(row.totalSeats),
    freeSeats: Number(row.freeSeats),
    availableSeats: parseJson(row.availableSeatsJson, []),
    status: row.status,
    errorCode: row.errorCode || '',
    providerName: row.providerName,
  } : null;
}

function normalizeSeatSession(row) {
  return row ? {
    id: Number(row.id),
    pairingId: row.pairingId ? Number(row.pairingId) : null,
    status: row.status,
    origin: row.origin,
    cookieDomain: row.cookieDomain,
    cookieCount: Number(row.cookieCount || 0),
    cookieExpiresAt: row.cookieExpiresAt || null,
    localExpiresAt: row.localExpiresAt,
    bundleVersion: Number(row.bundleVersion || 1),
    bundleNonce: row.bundleNonce,
    bundleTag: row.bundleTag,
    bundleCiphertext: row.bundleCiphertext,
    lastUsedAt: row.lastUsedAt || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  } : null;
}

export function createSeatAssistantRepository(sqlite) {
  if (!sqlite?.json || !sqlite?.run) throw new Error('sqlite repository is required');

  const getProfile = () => normalizeProfileRow(sqlite.json(`SELECT id, enabled, venue, date_mode AS dateMode,
start_time AS startTime, end_time AS endTime, area_preference_json AS areaPreferenceJson,
  seat_preference_json AS seatPreferenceJson,
poll_interval_seconds AS pollIntervalSeconds, jitter_seconds AS jitterSeconds, near_interval_seconds AS nearIntervalSeconds
FROM seat_assistant_profiles WHERE id = 1 LIMIT 1;`)[0]);

  const saveProfile = (profile, timestamp = new Date().toISOString()) => {
    const next = normalizeProfile(profile);
    sqlite.run(`INSERT INTO seat_assistant_profiles
(id, enabled, venue, date_mode, start_time, end_time, area_preference_json, seat_preference_json,
poll_interval_seconds, jitter_seconds, near_interval_seconds, created_at, updated_at)
VALUES (1, ${sqlValue(next.enabled)}, ${sqlString(next.venue)}, ${sqlString(next.dateMode)}, ${sqlString(next.startTime)}, ${sqlString(next.endTime)},
${sqlString(JSON.stringify(next.areaPreference))}, ${sqlString(JSON.stringify(next.seatPreference))},
${sqlValue(next.pollIntervalSeconds)}, ${sqlValue(next.jitterSeconds)}, ${sqlValue(next.nearIntervalSeconds)}, ${sqlString(timestamp)}, ${sqlString(timestamp)})
ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled, venue = excluded.venue, date_mode = excluded.date_mode,
start_time = excluded.start_time, end_time = excluded.end_time, area_preference_json = excluded.area_preference_json,
 seat_preference_json = excluded.seat_preference_json,
poll_interval_seconds = excluded.poll_interval_seconds, jitter_seconds = excluded.jitter_seconds,
near_interval_seconds = excluded.near_interval_seconds, updated_at = excluded.updated_at;`);
    return getProfile();
  };

  const getSessionStatus = () => normalizeSession(sqlite.json(`SELECT status, provider_name AS providerName, message,
  last_checked_at AS lastCheckedAt, last_attempt_at AS lastAttemptAt, last_success_at AS lastSuccessAt, next_check_at AS nextCheckAt,
consecutive_failures AS consecutiveFailures, last_notified_status AS lastNotifiedStatus, updated_at AS updatedAt
FROM seat_assistant_session_status WHERE id = 1 LIMIT 1;`)[0]);

  const saveSessionStatus = (status, timestamp = new Date().toISOString()) => {
    const next = {
      status: String(status.status || 'disconnected').slice(0, 40),
      providerName: String(status.providerName || 'disabled').slice(0, 40),
      message: redactSensitiveText(status.message || '', 240),
      lastCheckedAt: status.lastCheckedAt || null,
      lastAttemptAt: status.lastAttemptAt || null,
      lastSuccessAt: status.lastSuccessAt || null,
      nextCheckAt: status.nextCheckAt || null,
      consecutiveFailures: Math.max(0, Math.min(1000, Number(status.consecutiveFailures || 0))),
      lastNotifiedStatus: String(status.lastNotifiedStatus || '').slice(0, 40),
    };
    sqlite.run(`INSERT INTO seat_assistant_session_status
(id, status, provider_name, message, last_checked_at, last_attempt_at, last_success_at, next_check_at,
consecutive_failures, last_notified_status, created_at, updated_at)
VALUES (1, ${sqlString(next.status)}, ${sqlString(next.providerName)}, ${sqlString(next.message)}, ${sqlValue(next.lastCheckedAt)}, ${sqlValue(next.lastAttemptAt)},
${sqlValue(next.lastSuccessAt)}, ${sqlValue(next.nextCheckAt)}, ${sqlValue(next.consecutiveFailures)}, ${sqlString(next.lastNotifiedStatus)},
${sqlString(timestamp)}, ${sqlString(timestamp)})
ON CONFLICT(id) DO UPDATE SET status = excluded.status, provider_name = excluded.provider_name, message = excluded.message,
 last_checked_at = excluded.last_checked_at, last_attempt_at = excluded.last_attempt_at, last_success_at = excluded.last_success_at, next_check_at = excluded.next_check_at,
consecutive_failures = excluded.consecutive_failures, last_notified_status = excluded.last_notified_status, updated_at = excluded.updated_at;`);
    return getSessionStatus();
  };

  const claimQuerySlot = (attemptAt, cutoffAt) => {
    const result = sqlite.execute(`UPDATE seat_assistant_session_status
SET last_attempt_at = ?, last_checked_at = ?, updated_at = ?
WHERE id = 1
  AND (last_attempt_at IS NULL OR last_attempt_at <= ?)
  AND (last_checked_at IS NULL OR last_checked_at <= ?);`, [attemptAt, attemptAt, attemptAt, cutoffAt, cutoffAt]);
    return Number(result?.changes || 0) === 1;
  };

  const insertObservation = (observation, timestamp = new Date().toISOString()) => {
    sqlite.run(`INSERT INTO seat_assistant_observations
(observed_at, target_date, venue, total_seats, free_seats, available_seats_json, status, error_code, provider_name)
VALUES (${sqlString(timestamp)}, ${sqlString(observation.targetDate)}, ${sqlString(observation.venue)}, ${sqlValue(observation.totalSeats || 0)},
${sqlValue(observation.freeSeats || 0)}, ${sqlString(JSON.stringify(observation.availableSeats || []))}, ${sqlString(observation.status)},
${sqlString(observation.errorCode || '')}, ${sqlString(observation.providerName || 'unknown')});`);
    return normalizeObservation(sqlite.json(`SELECT id, observed_at AS observedAt, target_date AS targetDate, venue,
total_seats AS totalSeats, free_seats AS freeSeats, available_seats_json AS availableSeatsJson, status, error_code AS errorCode,
provider_name AS providerName FROM seat_assistant_observations ORDER BY id DESC LIMIT 1;`)[0]);
  };

  const listObservations = (limit = 20) => sqlite.json(`SELECT id, observed_at AS observedAt, target_date AS targetDate, venue,
total_seats AS totalSeats, free_seats AS freeSeats, available_seats_json AS availableSeatsJson, status, error_code AS errorCode,
provider_name AS providerName FROM seat_assistant_observations ORDER BY id DESC LIMIT ${Math.max(1, Math.min(200, Number(limit) || 20))};`).map(normalizeObservation);

  const getNotificationState = () => {
    const row = sqlite.json(`SELECT state_key AS stateKey, episode_key AS episodeKey, started_at AS startedAt, notify_count AS notifyCount, last_notified_at AS lastNotifiedAt,
updated_at AS updatedAt FROM seat_assistant_notification_state WHERE id = 1 LIMIT 1;`)[0];
    return row ? {
      stateKey: String(row.stateKey || ''),
      episodeKey: String(row.episodeKey || ''),
      startedAt: row.startedAt || null,
      notifyCount: Math.max(0, Number(row.notifyCount || 0)),
      lastNotifiedAt: row.lastNotifiedAt || null,
      updatedAt: row.updatedAt || null,
    } : { stateKey: '', episodeKey: '', startedAt: null, notifyCount: 0, lastNotifiedAt: null, updatedAt: null };
  };

  const saveNotificationState = (state, timestamp = new Date().toISOString()) => {
    const next = {
      stateKey: String(state?.stateKey || '').slice(0, 160),
      episodeKey: String(state?.episodeKey || '').slice(0, 160),
      startedAt: state?.startedAt || null,
      notifyCount: Math.max(0, Math.min(3, Number(state?.notifyCount || 0))),
      lastNotifiedAt: state?.lastNotifiedAt || null,
    };
    sqlite.run(`INSERT INTO seat_assistant_notification_state (id, state_key, episode_key, started_at, notify_count, last_notified_at, created_at, updated_at)
VALUES (1, ${sqlString(next.stateKey)}, ${sqlString(next.episodeKey)}, ${sqlValue(next.startedAt)}, ${sqlValue(next.notifyCount)}, ${sqlValue(next.lastNotifiedAt)}, ${sqlString(timestamp)}, ${sqlString(timestamp)})
ON CONFLICT(id) DO UPDATE SET state_key = excluded.state_key, notify_count = excluded.notify_count,
 episode_key = excluded.episode_key, started_at = excluded.started_at, last_notified_at = excluded.last_notified_at, updated_at = excluded.updated_at;`);
    return getNotificationState();
  };

  const createPairing = ({ codeHash, expiresAt }, timestamp = new Date().toISOString()) => {
    sqlite.run(`INSERT INTO seat_assistant_pairings (code_hash, status, expires_at, last_seen_at, created_at, updated_at)
VALUES (${sqlString(codeHash)}, 'pending', ${sqlString(expiresAt)}, NULL, ${sqlString(timestamp)}, ${sqlString(timestamp)});`);
    return sqlite.json(`SELECT id, status, expires_at AS expiresAt, last_seen_at AS lastSeenAt, created_at AS createdAt,
updated_at AS updatedAt FROM seat_assistant_pairings WHERE code_hash = ${sqlString(codeHash)} ORDER BY id DESC LIMIT 1;`)[0];
  };

  const consumePairing = ({ pairingId, codeHash, origin, cookieDomain, cookieCount, cookieExpiresAt, localExpiresAt, nonce, tag, ciphertext, version = 1, createdAt }) => {
    const timestamp = String(createdAt || new Date().toISOString());
    const id = sqlValue(Number(pairingId));
    sqlite.run(`BEGIN IMMEDIATE;
UPDATE seat_assistant_pairings SET status = 'consumed', consumed_at = ${sqlString(timestamp)}, last_seen_at = ${sqlString(timestamp)}, updated_at = ${sqlString(timestamp)}
WHERE id = ${id} AND code_hash = ${sqlString(codeHash)} AND status = 'pending' AND expires_at > ${sqlString(timestamp)};
INSERT INTO seat_assistant_sessions (pairing_id, status, origin, cookie_domain, cookie_count, cookie_expires_at,
local_expires_at, bundle_version, bundle_nonce, bundle_tag, bundle_ciphertext, last_used_at, created_at, updated_at)
SELECT ${id}, 'active', ${sqlString(origin)}, ${sqlString(cookieDomain)}, ${sqlValue(cookieCount)}, ${sqlValue(cookieExpiresAt)},
${sqlString(localExpiresAt)}, ${sqlValue(version)}, ${sqlString(nonce)}, ${sqlString(tag)}, ${sqlString(ciphertext)}, NULL,
${sqlString(timestamp)}, ${sqlString(timestamp)} WHERE changes() = 1;
UPDATE seat_assistant_pairings SET session_id = last_insert_rowid(), updated_at = ${sqlString(timestamp)}
WHERE id = ${id} AND status = 'consumed' AND consumed_at = ${sqlString(timestamp)} AND changes() = 1;
COMMIT;`);
    return normalizeSeatSession(sqlite.json(`SELECT id, pairing_id AS pairingId, status, origin, cookie_domain AS cookieDomain,
cookie_count AS cookieCount, cookie_expires_at AS cookieExpiresAt, local_expires_at AS localExpiresAt,
bundle_version AS bundleVersion, bundle_nonce AS bundleNonce, bundle_tag AS bundleTag, bundle_ciphertext AS bundleCiphertext,
last_used_at AS lastUsedAt, created_at AS createdAt, updated_at AS updatedAt
FROM seat_assistant_sessions WHERE pairing_id = ${id} AND status = 'active' AND created_at = ${sqlString(timestamp)}
ORDER BY id DESC LIMIT 1;`)[0]);
  };

  const getActiveSeatSession = () => normalizeSeatSession(sqlite.json(`SELECT id, pairing_id AS pairingId, status, origin,
cookie_domain AS cookieDomain, cookie_count AS cookieCount, cookie_expires_at AS cookieExpiresAt, local_expires_at AS localExpiresAt,
bundle_version AS bundleVersion, bundle_nonce AS bundleNonce, bundle_tag AS bundleTag, bundle_ciphertext AS bundleCiphertext,
last_used_at AS lastUsedAt, created_at AS createdAt, updated_at AS updatedAt
FROM seat_assistant_sessions WHERE status = 'active' ORDER BY id DESC LIMIT 1;`)[0]);

  const touchSeatSession = (id, timestamp = new Date().toISOString()) => {
    sqlite.run(`UPDATE seat_assistant_sessions SET last_used_at = ${sqlString(timestamp)}, updated_at = ${sqlString(timestamp)}
WHERE id = ${sqlValue(Number(id))} AND status = 'active';`);
  };

  const deleteSeatSession = (id) => {
    const existed = Number(sqlite.scalar(`SELECT COUNT(*) FROM seat_assistant_sessions WHERE id = ${sqlValue(Number(id))};`) || 0) > 0;
    sqlite.run(`DELETE FROM seat_assistant_sessions WHERE id = ${sqlValue(Number(id))};`);
    return existed;
  };

  const deleteAllSeatSessions = () => sqlite.run('DELETE FROM seat_assistant_sessions;');
  const revokeOtherSessions = (id) => sqlite.run(`DELETE FROM seat_assistant_sessions WHERE id <> ${sqlValue(Number(id))};`);

  const listPairings = (limit = 20) => sqlite.json(`SELECT id, status, expires_at AS expiresAt, last_seen_at AS lastSeenAt,
created_at AS createdAt, updated_at AS updatedAt FROM seat_assistant_pairings ORDER BY id DESC LIMIT ${Math.max(1, Math.min(100, Number(limit) || 20))};`);

  const listAudit = (limit = 50) => sqlite.json(`SELECT id, action, actor_role AS actorRole, detail_json AS detailJson,
created_at AS createdAt FROM seat_assistant_audit ORDER BY id DESC LIMIT ${Math.max(1, Math.min(200, Number(limit) || 50))};`).map((row) => ({
    id: Number(row.id), action: row.action, actorRole: row.actorRole, detail: parseJson(row.detailJson, {}), createdAt: row.createdAt,
  }));

  const appendAudit = ({ action, actorRole = 'system', detail = {} }, timestamp = new Date().toISOString()) => {
    sqlite.run(`INSERT INTO seat_assistant_audit (action, actor_role, detail_json, created_at)
VALUES (${sqlString(action)}, ${sqlString(actorRole)}, ${sqlString(JSON.stringify(detail || {}))}, ${sqlString(timestamp)});`);
  };

  const deleteHistory = () => {
    sqlite.transaction([
      'DELETE FROM seat_assistant_observations;',
      'DELETE FROM seat_assistant_audit;',
      'DELETE FROM seat_assistant_pairings;',
      'DELETE FROM seat_assistant_sessions;',
      'DELETE FROM seat_assistant_notification_state;',
    ]);
    return { ok: true };
  };

  return {
    getProfile, saveProfile, getSessionStatus, saveSessionStatus, claimQuerySlot, insertObservation, listObservations,
    getNotificationState, saveNotificationState,
    createPairing, consumePairing, getActiveSeatSession, touchSeatSession, deleteSeatSession, deleteAllSeatSessions,
    revokeOtherSessions, listPairings, listAudit, appendAudit, deleteHistory,
  };
}
