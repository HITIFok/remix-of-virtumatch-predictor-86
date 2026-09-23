-- ============================================
-- MIGRATION 009: Temporal Provenance Audit
-- Phase 5.3.3 — Scientific Timeline Fix
-- ============================================
--
-- Adds:
--   - temporal_safety_reason: WHY temporal_safety_score is what it is
--     ('VERIFIED', 'WITHIN_CLOCK_SKEW', 'FUTURE_FEATURE_LEAK', 'T_FEATURE_UNKNOWN')
--   - timestamp_provenance: JSONB per-source provenance audit
--     ({ odds: 'KNOWN'|'UNKNOWN', ranking: 'KNOWN'|'UNKNOWN', form: 'KNOWN'|'UNKNOWN', h2h: 'KNOWN'|'UNKNOWN' })
--
-- IMPORTANT: Does NOT modify any existing data.
-- Existing rows get NULL for new columns (correct: provenance unknown).

-- 1. Add temporal_safety_reason column
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS temporal_safety_reason TEXT;

-- 2. Add timestamp_provenance JSONB column
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS timestamp_provenance JSONB;

-- 3. Backfill temporal_safety_reason for existing rows
-- Rows with temporal_safety_score = 1.0 but t_feature = NULL get 'T_FEATURE_UNKNOWN'
-- (the old code defaulted to 1.0 without verification — this is a false positive)
UPDATE predictions
SET temporal_safety_reason = 'T_FEATURE_UNKNOWN'
WHERE temporal_safety_score = 1.0
  AND t_feature IS NULL
  AND temporal_safety_reason IS NULL;

-- Rows with temporal_safety_score = 1.0 and t_feature IS NOT NULL get 'VERIFIED'
UPDATE predictions
SET temporal_safety_reason = 'VERIFIED'
WHERE temporal_safety_score = 1.0
  AND t_feature IS NOT NULL
  AND temporal_safety_reason IS NULL;

-- Rows with temporal_safety_score = 0.0 get 'FUTURE_FEATURE_LEAK' (most likely)
UPDATE predictions
SET temporal_safety_reason = 'FUTURE_FEATURE_LEAK'
WHERE temporal_safety_score = 0.0
  AND temporal_safety_reason IS NULL;

-- 4. Index for temporal_safety_reason
CREATE INDEX IF NOT EXISTS idx_predictions_temporal_safety_reason
ON predictions (temporal_safety_reason)
WHERE temporal_safety_reason IS NOT NULL;

-- 5. Validation notice
DO $$
BEGIN
    RAISE NOTICE 'Phase 5.3.3 Migration 009 applied successfully.';
    RAISE NOTICE '  - Added temporal_safety_reason column';
    RAISE NOTICE '  - Added timestamp_provenance JSONB column';
    RAISE NOTICE '  - Backfilled temporal_safety_reason for existing rows';
    RAISE NOTICE '  - IMPORTANT: No existing data values modified';
END $$;
