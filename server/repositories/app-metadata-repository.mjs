export function createAppMetadataRepository(database) {
  function get(key, fallback = null) {
    const value = database.scalar('SELECT value FROM app_metadata WHERE key=? LIMIT 1;', [String(key)]);
    return value === '' ? fallback : value;
  }

  function set(key, value) {
    database.execute(`INSERT INTO app_metadata(key,value,updated_at)
VALUES(?,?,datetime('now'))
ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;`, [
      String(key),
      String(value ?? ''),
    ]);
  }

  function setMany(entries) {
    database.transaction((connection) => {
      const statement = connection.prepare(`INSERT INTO app_metadata(key,value,updated_at)
VALUES(?,?,datetime('now'))
ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;`);
      for (const [key, value] of Object.entries(entries || {})) {
        statement.run(String(key), String(value ?? ''));
      }
    });
  }

  function sourceUpdatedAt() {
    return get('data_updated_at', '');
  }

  function markDataUpdated(timestamp) {
    set('data_updated_at', timestamp);
  }

  function setPrecomputed(cacheKey, payload, computedAt, sourceTimestamp = sourceUpdatedAt()) {
    database.execute(`INSERT INTO precomputed_cache(cache_key,payload_json,source_updated_at,computed_at)
VALUES(?,?,?,?)
ON CONFLICT(cache_key) DO UPDATE SET
payload_json=excluded.payload_json,
source_updated_at=excluded.source_updated_at,
computed_at=excluded.computed_at;`, [
      String(cacheKey),
      JSON.stringify(payload),
      String(sourceTimestamp || ''),
      String(computedAt),
    ]);
  }

  function getPrecomputed(cacheKey) {
    return database.json(`SELECT payload_json AS payloadJson,
source_updated_at AS sourceUpdatedAt,computed_at AS computedAt
FROM precomputed_cache WHERE cache_key=? LIMIT 1;`, [String(cacheKey)])[0] || null;
  }

  return {
    get,
    set,
    setMany,
    sourceUpdatedAt,
    markDataUpdated,
    setPrecomputed,
    getPrecomputed,
  };
}
