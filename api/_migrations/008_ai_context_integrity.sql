-- ============================================
-- MIGRATION 008: AI Context Integrity & Phase 5.2 Go-Live
-- Phase 5.2 — Final AI Input Integrity & Scientific Go-Live
-- ============================================
--
-- Adds AI-specific traceability columns to predictions table:
-- - ai_context_hash: hash of canonical AIContext (RAW values)
-- - ai_input_hash: hash of derived AIInputs (after transformation)
-- - ai_prompt_hash: hash of actual prompt text sent to AI
-- - ai_response_hash: hash of AI response received
-- - ai_prompt_version: version of the system prompt used
-- - ai_model: specific model used for this prediction
-- - ai_trace: full AI trace record (JSONB)
--
-- Extends immutability trigger to cover AI-specific fields.

-- 1. Add AI context hash columns
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS ai_context_hash TEXT;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS ai_input_hash TEXT;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS ai_prompt_hash TEXT;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS ai_response_hash TEXT;

-- 2. Add AI version columns
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS ai_prompt_version TEXT;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS ai_model TEXT;

-- 3. Add full AI trace record (JSONB)
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS ai_trace JSONB;

-- 4. Add scientific collection status
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS scientific_collection_eligible BOOLEAN DEFAULT FALSE;

-- 5. Add version freeze columns
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS version_freeze JSONB;

-- 6. Indexes for AI traceability lookups
CREATE INDEX IF NOT EXISTS idx_predictions_ai_context_hash
ON predictions (ai_context_hash)
WHERE ai_context_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_predictions_ai_input_hash
ON predictions (ai_input_hash)
WHERE ai_input_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_predictions_ai_prompt_version
ON predictions (ai_prompt_version)
WHERE ai_prompt_version IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_predictions_scientific_eligible
ON predictions (scientific_collection_eligible)
WHERE scientific_collection_eligible = TRUE;

-- 7. Extend immutability trigger to cover AI-specific fields
-- We need to replace the existing trigger function with an extended version
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

    -- Rule 5 (Phase 5.2): AI context hash cannot be changed once set
    IF OLD.ai_context_hash IS NOT NULL AND NEW.ai_context_hash IS DISTINCT FROM OLD.ai_context_hash THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'ai_context_hash_change', OLD.ai_context_hash, NEW.ai_context_hash, 'trigger', TRUE);
        NEW.ai_context_hash = OLD.ai_context_hash;
    END IF;

    -- Rule 6 (Phase 5.2): AI input hash cannot be changed once set
    IF OLD.ai_input_hash IS NOT NULL AND NEW.ai_input_hash IS DISTINCT FROM OLD.ai_input_hash THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'ai_input_hash_change', OLD.ai_input_hash, NEW.ai_input_hash, 'trigger', TRUE);
        NEW.ai_input_hash = OLD.ai_input_hash;
    END IF;

    -- Rule 7 (Phase 5.2): AI prompt hash cannot be changed once set
    IF OLD.ai_prompt_hash IS NOT NULL AND NEW.ai_prompt_hash IS DISTINCT FROM OLD.ai_prompt_hash THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'ai_prompt_hash_change', OLD.ai_prompt_hash, NEW.ai_prompt_hash, 'trigger', TRUE);
        NEW.ai_prompt_hash = OLD.ai_prompt_hash;
    END IF;

    -- Rule 8 (Phase 5.2): AI response hash cannot be changed once set
    IF OLD.ai_response_hash IS NOT NULL AND NEW.ai_response_hash IS DISTINCT FROM OLD.ai_response_hash THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'ai_response_hash_change', OLD.ai_response_hash, NEW.ai_response_hash, 'trigger', TRUE);
        NEW.ai_response_hash = OLD.ai_response_hash;
    END IF;

    -- Rule 9 (Phase 5.2): AI trace cannot be changed once set
    IF OLD.ai_trace IS NOT NULL AND NEW.ai_trace IS DISTINCT FROM OLD.ai_trace THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'ai_trace_change',
                LEFT(OLD.ai_trace::TEXT, 200),
                LEFT(NEW.ai_trace::TEXT, 200),
                'trigger', TRUE);
        NEW.ai_trace = OLD.ai_trace;
    END IF;

    -- Rule 10 (Phase 5.2): AI prompt version cannot be changed once set
    IF OLD.ai_prompt_version IS NOT NULL AND NEW.ai_prompt_version IS DISTINCT FROM OLD.ai_prompt_version THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'ai_prompt_version_change', OLD.ai_prompt_version, NEW.ai_prompt_version, 'trigger', TRUE);
        NEW.ai_prompt_version = OLD.ai_prompt_version;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 8. Backfill AI columns for existing predictions with snapshots
-- FIX 5.3.2: Use current valid model name (qwen/qwen3.8-27b) instead of deprecated llama-3.3-70b-versatile
UPDATE predictions
SET ai_prompt_version = '7.0',
    ai_model = 'qwen/qwen3.8-27b'
WHERE feature_snapshot IS NOT NULL
  AND ai_prompt_version IS NULL;

-- 9. Validation notice
DO $$
BEGIN
    RAISE NOTICE 'Phase 5.2 Migration 008 applied successfully.';
    RAISE NOTICE '  - Added ai_context_hash, ai_input_hash, ai_prompt_hash, ai_response_hash columns';
    RAISE NOTICE '  - Added ai_prompt_version, ai_model columns';
    RAISE NOTICE '  - Added ai_trace JSONB column';
    RAISE NOTICE '  - Added scientific_collection_eligible boolean column';
    RAISE NOTICE '  - Added version_freeze JSONB column';
    RAISE NOTICE '  - Extended enforce_snapshot_immutability() trigger with AI-specific rules';
    RAISE NOTICE '  - IMPORTANT: ai_context_hash, ai_input_hash, ai_prompt_hash, ai_response_hash are now IMMUTABLE once set';
    RAISE NOTICE '  - IMPORTANT: ai_trace is now IMMUTABLE once set';
END $$;
