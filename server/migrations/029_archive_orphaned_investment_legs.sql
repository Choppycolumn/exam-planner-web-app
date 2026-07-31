CREATE TABLE IF NOT EXISTS legacy_investment_orphan_legs_archive_029 AS
SELECT
  leg.*,
  '' AS archived_at,
  '' AS archive_reason
FROM investment_transaction_legs leg
WHERE 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_legacy_investment_orphan_legs_source
ON legacy_investment_orphan_legs_archive_029(id);

INSERT OR IGNORE INTO legacy_investment_orphan_legs_archive_029
SELECT
  leg.*,
  datetime('now'),
  'missing investment_transactions parent'
FROM investment_transaction_legs leg
LEFT JOIN investment_transactions transaction_record
  ON transaction_record.id = leg.transaction_id
WHERE transaction_record.id IS NULL;

DELETE FROM investment_transaction_legs
WHERE NOT EXISTS (
  SELECT 1
  FROM investment_transactions transaction_record
  WHERE transaction_record.id = investment_transaction_legs.transaction_id
);
