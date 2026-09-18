-- ============================================
-- MIGRATION 006: Feature Snapshot & Traceability
-- Phase 3 — Feature Snapshot, Provenance, Reproducibility
-- ============================================
--
-- IMPORTANT: This migration is RETROCOMPATIBLE.
-- - All new columns are NULLABLE (existing predictions get NULL)
-- - No existing data is deleted or modified
-- - Old predictions without snapshots remain functional
-- - New predictions will have feature_snapshot populated
--
-- Rule: feature_snapshot = NULL means UNKNOWN provenance (not SAFE)

-- 1. Add feature_snapshot JSONB column
-- Stores the complete feature snapshot at prediction time
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS feature_snapshot JSONB;

-- 2. Add model versioning columns
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS model_version TEXT;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS feature_version TEXT;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS config_version TEXT;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS calibration_version TEXT;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS dataset_version TEXT;

-- 3. Add hash columns for reproducibility
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS feature_snapshot_hash TEXT;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS prediction_hash TEXT;

-- 4. Add snapshot timestamp (when the snapshot was captured)
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS snapshot_timestamp TIMESTAMP WITH TIME ZONE;

-- 5. Add provenance summary column (cached for fast queries)
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS provenance_status TEXT;
-- Values: 'VALID', 'PARTIALLY_VALID', 'INVALID', 'UNKNOWN' (for legacy predictions)

-- 6. GIN index for JSONB queries on feature_snapshot
CREATE INDEX IF NOT EXISTS idx_predictions_feature_snapshot
ON predictions USING GIN (feature_snapshot jsonb_path_ops);

-- 7. Index on feature_snapshot_hash for reproducibility checks
CREATE INDEX IF NOT EXISTS idx_predictions_snapshot_hash
ON predictions (feature_snapshot_hash)
WHERE feature_snapshot_hash IS NOT NULL;

-- 8. Index on model_version for version-based queries
CREATE INDEX IF NOT EXISTS idx_predictions_model_version
ON predictions (model_version)
WHERE model_version IS NOT NULL;

-- 9. Index on provenance_status for backtest validity queries
CREATE INDEX IF NOT EXISTS idx_predictions_provenance
ON predictions (provenance_status)
WHERE provenance_status IS NOT NULL;

-- 10. Partial index: predictions WITH feature snapshots (for backtest A)
CREATE INDEX IF NOT EXISTS idx_predictions_with_snapshot
ON predictions (created_at DESC)
WHERE feature_snapshot IS NOT NULL;

-- 11. Partial index: predictions WITHOUT feature snapshots (legacy)
CREATE INDEX IF NOT EXISTS idx_predictions_without_snapshot
ON predictions (created_at DESC)
WHERE feature_snapshot IS NULL;

-- 12. Set provenance_status for existing predictions (all UNKNOWN since no snapshot)
UPDATE predictions
SET provenance_status = 'UNKNOWN'
WHERE feature_snapshot IS NULL AND provenance_status IS NULL;

-- 13. Validation comment
DO $$
BEGIN
    RAISE NOTICE 'Phase 3 Migration 006 applied successfully.';
    RAISE NOTICE '  - feature_snapshot JSONB column added (nullable for retrocompatibility)';
    RAISE NOTICE '  - Model versioning columns added (5 columns)';
    RAISE NOTICE '  - Reproducibility hash columns added (2 columns)';
    RAISE NOTICE '  - GIN + B-tree indexes created (6 indexes)';
    RAISE NOTICE '  - Existing predictions: provenance_status = UNKNOWN';
    RAISE NOTICE '  - New predictions: feature_snapshot will be populated at creation time';
END $$;
