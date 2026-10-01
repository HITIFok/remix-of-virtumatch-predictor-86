-- ============================================
-- MIGRATION 012: expected_start — B3 Resolution
-- Phase 5.3.46
-- ============================================
--
-- PURPOSE:
--   Persist the scheduled match start time (expectedStart from Sporty API)
--   as a scientific metadata field. This enables post-hoc verification that
--   a prediction was generated BEFORE the match started:
--     expected_start > t_prediction → PRE_MATCH = TRUE
--
-- SOURCE:
--   Sporty API → m.expectedStart → mapped to match.kickoff in fetch-live.js
--   → passed through savePredictionToDb → POST /api/predictions → DB
--
-- IMMUTABILITY:
--   Same rules as other scientific fields (t_prediction, ai_call_status, etc.):
--     NULL → value: ALLOWED (initial INSERT or enrichment)
--     value → same value: ALLOWED (idempotent)
--     value → different value: BLOCKED
--     value → NULL: BLOCKED
--
-- NO BACKFILL:
--   Legacy predictions keep expected_start = NULL.
--   No substitution with created_at, t_prediction, or any other timestamp.
--   Only NEW predictions (created after this migration) will have
--   expected_start populated (if Sporty provides kickoff/expectedStart).
--
-- NOT ADDED TO:
--   - AIContext / buildAIContext (expected_start is NOT a model feature)
--   - feature_snapshot (expected_start is metadata, not a feature)
--   - D1 / computeScientificEligible (no change to eligibility logic)
--   - hash pipeline (does not affect any hash)
-- ============================================

-- ═══════════════════════════════════════════════════════════════════
-- 1. Add the expected_start column
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE predictions ADD COLUMN IF NOT EXISTS expected_start TIMESTAMPTZ;

-- ═══════════════════════════════════════════════════════════════════
-- 2. Extend the immutability trigger function with Rule 22
--    Pattern follows the same structure as Rules 20/21 in migration 011.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION enforce_snapshot_immutability()
RETURNS TRIGGER AS $$
BEGIN
    -- ═══ Rules from migration 007 (preserved) ═══
    -- Rule 1: feature_snapshot — immutable once set
    IF OLD.feature_snapshot IS NOT NULL AND NEW.feature_snapshot IS DISTINCT FROM OLD.feature_snapshot THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'feature_snapshot_change', LEFT(OLD.feature_snapshot::TEXT, 500), LEFT(NEW.feature_snapshot::TEXT, 500), 'trigger', TRUE);
        NEW.feature_snapshot = OLD.feature_snapshot;
    END IF;

    -- Rule 2: feature_snapshot_hash — immutable once set
    IF OLD.feature_snapshot_hash IS NOT NULL AND NEW.feature_snapshot_hash IS DISTINCT FROM OLD.feature_snapshot_hash THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'feature_snapshot_hash_change', OLD.feature_snapshot_hash, NEW.feature_snapshot_hash, 'trigger', TRUE);
        NEW.feature_snapshot_hash = OLD.feature_snapshot_hash;
    END IF;

    -- Rule 3: prediction_hash — immutable once set
    IF OLD.prediction_hash IS NOT NULL AND NEW.prediction_hash IS DISTINCT FROM OLD.prediction_hash THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'prediction_hash_change', OLD.prediction_hash, NEW.prediction_hash, 'trigger', TRUE);
        NEW.prediction_hash = OLD.prediction_hash;
    END IF;

    -- Rule 4: model_version — immutable once set
    IF OLD.model_version IS NOT NULL AND NEW.model_version IS DISTINCT FROM OLD.model_version THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'model_version_change', OLD.model_version, NEW.model_version, 'trigger', TRUE);
        NEW.model_version = OLD.model_version;
    END IF;

    -- Rule 5: feature_version — immutable once set
    IF OLD.feature_version IS NOT NULL AND NEW.feature_version IS DISTINCT FROM OLD.feature_version THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'feature_version_change', OLD.feature_version, NEW.feature_version, 'trigger', TRUE);
        NEW.feature_version = OLD.feature_version;
    END IF;

    -- Rule 6: config_version — immutable once set
    IF OLD.config_version IS NOT NULL AND NEW.config_version IS DISTINCT FROM OLD.config_version THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'config_version_change', OLD.config_version, NEW.config_version, 'trigger', TRUE);
        NEW.config_version = OLD.config_version;
    END IF;

    -- Rule 7: calibration_version — immutable once set
    IF OLD.calibration_version IS NOT NULL AND NEW.calibration_version IS DISTINCT FROM OLD.calibration_version THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'calibration_version_change', OLD.calibration_version, NEW.calibration_version, 'trigger', TRUE);
        NEW.calibration_version = OLD.calibration_version;
    END IF;

    -- Rule 8: dataset_version — immutable once set
    IF OLD.dataset_version IS NOT NULL AND NEW.dataset_version IS DISTINCT FROM OLD.dataset_version THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'dataset_version_change', OLD.dataset_version, NEW.dataset_version, 'trigger', TRUE);
        NEW.dataset_version = OLD.dataset_version;
    END IF;

    -- Rule 9: snapshot_timestamp — immutable once set
    IF OLD.snapshot_timestamp IS NOT NULL AND NEW.snapshot_timestamp IS DISTINCT FROM OLD.snapshot_timestamp THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'snapshot_timestamp_change', OLD.snapshot_timestamp::TEXT, NEW.snapshot_timestamp::TEXT, 'trigger', TRUE);
        NEW.snapshot_timestamp = OLD.snapshot_timestamp;
    END IF;

    -- Rule 10: provenance_status — immutable once set
    IF OLD.provenance_status IS NOT NULL AND NEW.provenance_status IS DISTINCT FROM OLD.provenance_status THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'provenance_status_change', OLD.provenance_status, NEW.provenance_status, 'trigger', TRUE);
        NEW.provenance_status = OLD.provenance_status;
    END IF;

    -- ═══ Rules from migration 008 (preserved) ═══
    -- Rule 11: ai_context_hash — immutable once set
    IF OLD.ai_context_hash IS NOT NULL AND NEW.ai_context_hash IS DISTINCT FROM OLD.ai_context_hash THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'ai_context_hash_change', OLD.ai_context_hash, NEW.ai_context_hash, 'trigger', TRUE);
        NEW.ai_context_hash = OLD.ai_context_hash;
    END IF;

    -- Rule 12: ai_input_hash — immutable once set
    IF OLD.ai_input_hash IS NOT NULL AND NEW.ai_input_hash IS DISTINCT FROM OLD.ai_input_hash THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'ai_input_hash_change', OLD.ai_input_hash, NEW.ai_input_hash, 'trigger', TRUE);
        NEW.ai_input_hash = OLD.ai_input_hash;
    END IF;

    -- Rule 13: ai_prompt_hash — immutable once set
    IF OLD.ai_prompt_hash IS NOT NULL AND NEW.ai_prompt_hash IS DISTINCT FROM OLD.ai_prompt_hash THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'ai_prompt_hash_change', OLD.ai_prompt_hash, NEW.ai_prompt_hash, 'trigger', TRUE);
        NEW.ai_prompt_hash = OLD.ai_prompt_hash;
    END IF;

    -- Rule 14: version_freeze — immutable once set
    IF OLD.version_freeze IS NOT NULL AND NEW.version_freeze IS DISTINCT FROM OLD.version_freeze THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'version_freeze_change', LEFT(OLD.version_freeze::TEXT, 500), LEFT(NEW.version_freeze::TEXT, 500), 'trigger', TRUE);
        NEW.version_freeze = OLD.version_freeze;
    END IF;

    -- ═══ Rules from migration 009 (preserved) ═══
    -- Rule 15: completeness_score — immutable once set
    IF OLD.completeness_score IS NOT NULL AND NEW.completeness_score IS DISTINCT FROM OLD.completeness_score THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'completeness_score_change', OLD.completeness_score::TEXT, NEW.completeness_score::TEXT, 'trigger', TRUE);
        NEW.completeness_score = OLD.completeness_score;
    END IF;

    -- Rule 16: temporal_safety_score — immutable once set
    IF OLD.temporal_safety_score IS NOT NULL AND NEW.temporal_safety_score IS DISTINCT FROM OLD.temporal_safety_score THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'temporal_safety_score_change', OLD.temporal_safety_score::TEXT, NEW.temporal_safety_score::TEXT, 'trigger', TRUE);
        NEW.temporal_safety_score = OLD.temporal_safety_score;
    END IF;

    -- Rule 17: temporal_safety_reason — immutable once set
    IF OLD.temporal_safety_reason IS NOT NULL AND NEW.temporal_safety_reason IS DISTINCT FROM OLD.temporal_safety_reason THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'temporal_safety_reason_change', OLD.temporal_safety_reason, NEW.temporal_safety_reason, 'trigger', TRUE);
        NEW.temporal_safety_reason = OLD.temporal_safety_reason;
    END IF;

    -- Rule 18: timestamp_provenance — immutable once set
    IF OLD.timestamp_provenance IS NOT NULL AND NEW.timestamp_provenance IS DISTINCT FROM OLD.timestamp_provenance THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'timestamp_provenance_change', LEFT(OLD.timestamp_provenance::TEXT, 500), LEFT(NEW.timestamp_provenance::TEXT, 500), 'trigger', TRUE);
        NEW.timestamp_provenance = OLD.timestamp_provenance;
    END IF;

    -- Rule 19: ai_provenance_risk — immutable once set
    IF OLD.ai_provenance_risk IS NOT NULL AND NEW.ai_provenance_risk IS DISTINCT FROM OLD.ai_provenance_risk THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'ai_provenance_risk_change', OLD.ai_provenance_risk, NEW.ai_provenance_risk, 'trigger', TRUE);
        NEW.ai_provenance_risk = OLD.ai_provenance_risk;
    END IF;

    -- ═══ Rules from migration 010 (preserved) ═══
    -- Rule 20: scientific_collection_eligible — immutable once set
    IF OLD.scientific_collection_eligible IS NOT NULL AND NEW.scientific_collection_eligible IS DISTINCT FROM OLD.scientific_collection_eligible THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'scientific_collection_eligible_change',
                OLD.scientific_collection_eligible::TEXT,
                NEW.scientific_collection_eligible::TEXT,
                'trigger', TRUE);
        NEW.scientific_collection_eligible = OLD.scientific_collection_eligible;
    END IF;

    -- Rule 21: t_feature — immutable once set
    IF OLD.t_feature IS NOT NULL AND NEW.t_feature IS DISTINCT FROM OLD.t_feature THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 't_feature_change', OLD.t_feature::TEXT, NEW.t_feature::TEXT, 'trigger', TRUE);
        NEW.t_feature = OLD.t_feature;
    END IF;

    -- Rule 22: t_prediction — immutable once set
    IF OLD.t_prediction IS NOT NULL AND NEW.t_prediction IS DISTINCT FROM OLD.t_prediction THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 't_prediction_change', OLD.t_prediction::TEXT, NEW.t_prediction::TEXT, 'trigger', TRUE);
        NEW.t_prediction = OLD.t_prediction;
    END IF;

    -- ═══ Rules from migration 011 (preserved) ═══
    -- Rule 23: ai_call_status — immutable once set (NULL → value ALLOWED)
    IF OLD.ai_call_status IS NOT NULL AND NEW.ai_call_status IS DISTINCT FROM OLD.ai_call_status THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'ai_call_status_change',
                LEFT(OLD.ai_call_status::TEXT, 200),
                LEFT(NEW.ai_call_status::TEXT, 200),
                'trigger', TRUE);
        NEW.ai_call_status = OLD.ai_call_status;
    END IF;

    -- Rule 24: ai_response_length — immutable once set (NULL → value ALLOWED)
    IF OLD.ai_response_length IS NOT NULL AND NEW.ai_response_length IS DISTINCT FROM OLD.ai_response_length THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'ai_response_length_change',
                OLD.ai_response_length::TEXT,
                NEW.ai_response_length::TEXT,
                'trigger', TRUE);
        NEW.ai_response_length = OLD.ai_response_length;
    END IF;

    -- ═══ Rule from migration 012 (NEW) ═══
    -- Rule 25: expected_start — immutable once set (NULL → value ALLOWED)
    -- Phase 5.3.46: Persist Sporty API's expectedStart as scientific metadata.
    -- NULL → value: ALLOWED (initial INSERT or enrichment via PATCH)
    -- value → same value: ALLOWED (idempotent)
    -- value → different value: BLOCKED
    -- value → NULL: BLOCKED
    IF OLD.expected_start IS NOT NULL AND NEW.expected_start IS DISTINCT FROM OLD.expected_start THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'expected_start_change',
                OLD.expected_start::TEXT,
                NEW.expected_start::TEXT,
                'trigger', TRUE);
        NEW.expected_start = OLD.expected_start;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════════
-- 3. Validation notice (NO data modification)
-- ═══════════════════════════════════════════════════════════════════

DO $$
BEGIN
    RAISE NOTICE 'Migration 012 (expected_start) applied successfully.';
    RAISE NOTICE '  - Added column: expected_start TIMESTAMPTZ';
    RAISE NOTICE '  - enforce_snapshot_immutability() extended with Rule 25: expected_start_change';
    RAISE NOTICE '  - Rules: NULL→value ALLOWED, value→same ALLOWED,';
    RAISE NOTICE '           value→different BLOCKED, value→NULL BLOCKED';
    RAISE NOTICE '  - CRITICAL: No historical data was modified.';
    RAISE NOTICE '  - CRITICAL: No backfill was performed.';
    RAISE NOTICE '  - Existing rows keep their current NULL values.';
    RAISE NOTICE '  - Only NEW predictions will have expected_start populated.';
END $$;
