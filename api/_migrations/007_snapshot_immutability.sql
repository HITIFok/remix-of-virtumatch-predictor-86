-- ============================================
-- MIGRATION 007: Snapshot Immutability & Phase 5 Enhancements
-- Phase 5 — Production Snapshot + Dataset Scientifique
-- ============================================
--
-- IMPORTANT: This migration enforces snapshot immutability.
-- - feature_snapshot cannot be UPDATEd once set
-- - feature_snapshot_hash cannot be changed
-- - provenance_status cannot be downgraded (RECORDED → UNKNOWN forbidden)
-- - Adds t_prediction, t_feature columns for three-temporal-timestamp system
-- - Adds dataset_split column for TRAIN/VALIDATION/TEST
-- - Adds completeness_score and temporal_safety_score columns
-- - Adds immutability violation logging table

-- 1. Add three temporal timestamp columns (Section 2)
-- T_prediction: when the prediction was produced
-- T_feature: when the feature source data was available
-- T_snapshot: already exists as snapshot_timestamp (when snapshot was recorded)
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS t_prediction TIMESTAMP WITH TIME ZONE;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS t_feature TIMESTAMP WITH TIME ZONE;

-- 2. Add dataset split column (Section 17)
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS dataset_split TEXT;
-- Values: 'TRAIN', 'VALIDATION', 'TEST', NULL (unassigned)
-- Check constraint: only valid values
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_predictions_dataset_split'
    ) THEN
        ALTER TABLE predictions ADD CONSTRAINT chk_predictions_dataset_split
        CHECK (dataset_split IS NULL OR dataset_split IN ('TRAIN', 'VALIDATION', 'TEST'));
    END IF;
END $$;

-- 3. Add completeness and temporal safety scores (Section 6)
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS completeness_score REAL;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS temporal_safety_score REAL;

-- 4. Add AI provenance audit columns (Section 8)
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS ai_provenance_risk TEXT;
-- Values: 'NONE', 'PROMPT_INTEGRATES_ODDS', 'PROMPT_INTEGRATES_FUTURE', 'UNKNOWN'

-- 5. Create immutability violation log table (Section 4)
CREATE TABLE IF NOT EXISTS snapshot_immutability_violations (
    id SERIAL PRIMARY KEY,
    prediction_id INTEGER NOT NULL REFERENCES predictions(id),
    violation_type TEXT NOT NULL,
    -- 'snapshot_update_attempt', 'hash_change_attempt', 'provenance_downgrade'
    old_value TEXT,
    new_value TEXT,
    attempted_by TEXT,
    -- 'api', 'script', 'migration', 'unknown'
    detected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    blocked BOOLEAN DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_immutability_violations_prediction
ON snapshot_immutability_violations (prediction_id);

CREATE INDEX IF NOT EXISTS idx_immutability_violations_detected
ON snapshot_immutability_violations (detected_at DESC);

-- 6. Create snapshot audit log table (Section 13)
CREATE TABLE IF NOT EXISTS snapshot_audit_log (
    id SERIAL PRIMARY KEY,
    event_type TEXT NOT NULL,
    -- 'snapshot_created', 'snapshot_failed', 'snapshot_incomplete',
    -- 'snapshot_unknown', 'snapshot_unsafe', 'snapshot_hash_mismatch',
    -- 'snapshot_immutability_violation', 'prediction_created', 'prediction_verified',
    -- 'leakage_detected'
    prediction_id INTEGER,
    details JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_snapshot_audit_event
ON snapshot_audit_log (event_type);

CREATE INDEX IF NOT EXISTS idx_snapshot_audit_created
ON snapshot_audit_log (created_at DESC);

-- 7. Enforce immutability via trigger (Section 4)
-- Prevent UPDATE of feature_snapshot once it's set
CREATE OR REPLACE FUNCTION enforce_snapshot_immutability()
RETURNS TRIGGER AS $$
DECLARE
    violation_type TEXT;
BEGIN
    -- Rule 1: feature_snapshot cannot be changed once set
    IF OLD.feature_snapshot IS NOT NULL AND NEW.feature_snapshot IS DISTINCT FROM OLD.feature_snapshot THEN
        violation_type := 'snapshot_update_attempt';
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, violation_type,
                LEFT(OLD.feature_snapshot::TEXT, 200),
                LEFT(NEW.feature_snapshot::TEXT, 200),
                'trigger', TRUE);
        -- Block the change: restore original value
        NEW.feature_snapshot = OLD.feature_snapshot;
    END IF;

    -- Rule 2: feature_snapshot_hash cannot be changed once set
    IF OLD.feature_snapshot_hash IS NOT NULL AND NEW.feature_snapshot_hash IS DISTINCT FROM OLD.feature_snapshot_hash THEN
        violation_type := 'hash_change_attempt';
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, violation_type, OLD.feature_snapshot_hash, NEW.feature_snapshot_hash, 'trigger', TRUE);
        NEW.feature_snapshot_hash = OLD.feature_snapshot_hash;
    END IF;

    -- Rule 3: provenance cannot be downgraded
    -- RECORDED > RECONSTRUCTED > UNKNOWN > UNSAFE (downgrade = going right)
    -- Forbidden: RECORDED→RECONSTRUCTED, RECORDED→UNKNOWN, RECORDED→UNSAFE, RECONSTRUCTED→UNKNOWN, RECONSTRUCTED→UNSAFE
    IF OLD.provenance_status = 'VALID' AND NEW.provenance_status IN ('PARTIALLY_VALID', 'INVALID', 'UNKNOWN') THEN
        violation_type := 'provenance_downgrade';
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, violation_type, OLD.provenance_status, NEW.provenance_status, 'trigger', TRUE);
        NEW.provenance_status = OLD.provenance_status;
    END IF;

    IF OLD.provenance_status = 'PARTIALLY_VALID' AND NEW.provenance_status IN ('INVALID', 'UNKNOWN') THEN
        violation_type := 'provenance_downgrade';
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, violation_type, OLD.provenance_status, NEW.provenance_status, 'trigger', TRUE);
        NEW.provenance_status = OLD.provenance_status;
    END IF;

    -- Rule 4: model_version cannot be changed once set
    IF OLD.model_version IS NOT NULL AND NEW.model_version IS DISTINCT FROM OLD.model_version THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'model_version_change', OLD.model_version, NEW.model_version, 'trigger', TRUE);
        NEW.model_version = OLD.model_version;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists, then create
DROP TRIGGER IF EXISTS trg_snapshot_immutability ON predictions;
CREATE TRIGGER trg_snapshot_immutability
BEFORE UPDATE ON predictions
FOR EACH ROW
EXECUTE FUNCTION enforce_snapshot_immutability();

-- 8. Indexes for new columns
CREATE INDEX IF NOT EXISTS idx_predictions_t_prediction
ON predictions (t_prediction)
WHERE t_prediction IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_predictions_t_feature
ON predictions (t_feature)
WHERE t_feature IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_predictions_dataset_split
ON predictions (dataset_split)
WHERE dataset_split IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_predictions_completeness
ON predictions (completeness_score)
WHERE completeness_score IS NOT NULL;

-- 9. Backfill t_prediction from created_at for existing rows
UPDATE predictions
SET t_prediction = created_at
WHERE t_prediction IS NULL AND created_at IS NOT NULL;

-- 10. Set default provenance for existing rows with snapshots
UPDATE predictions
SET provenance_status = 'PARTIALLY_VALID'
WHERE feature_snapshot IS NOT NULL
  AND provenance_status = 'UNKNOWN';

-- 11. Validation notice
DO $$
BEGIN
    RAISE NOTICE 'Phase 5 Migration 007 applied successfully.';
    RAISE NOTICE '  - Added t_prediction, t_feature columns (three-temporal-timestamp system)';
    RAISE NOTICE '  - Added dataset_split column with check constraint';
    RAISE NOTICE '  - Added completeness_score, temporal_safety_score columns';
    RAISE NOTICE '  - Added ai_provenance_risk column';
    RAISE NOTICE '  - Created snapshot_immutability_violations table';
    RAISE NOTICE '  - Created snapshot_audit_log table';
    RAISE NOTICE '  - Created enforce_snapshot_immutability() trigger';
    RAISE NOTICE '  - IMPORTANT: feature_snapshot is now IMMUTABLE once set';
    RAISE NOTICE '  - IMPORTANT: feature_snapshot_hash is now IMMUTABLE once set';
    RAISE NOTICE '  - IMPORTANT: provenance cannot be downgraded';
END $$;
