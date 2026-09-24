-- ============================================
-- MIGRATION 010: Scientific Integrity — Extended Immutability
-- Forensic Audit Fix — Phase 5
-- ============================================
--
-- This migration extends the immutability trigger (created in 007/008)
-- to cover scientific fields that were NOT previously protected:
--
--   t_feature
--   t_prediction
--   scientific_collection_eligible
--   version_freeze
--   completeness_score
--   temporal_safety_score
--   timestamp_provenance
--   temporal_safety_reason
--   ai_provenance_risk
--
-- Rules (per audit mandate §5):
--   NULL → value              ALLOWED (initial enrichment)
--   value → same value        ALLOWED (idempotent)
--   value → different value   BLOCKED
--   value → NULL              BLOCKED
--
-- CRITICAL — DOES NOT MODIFY HISTORICAL DATA.
-- Per audit mandate §14 ("NE PAS CORRIGER L'HISTORIQUE PAR FABRICATION"):
--   - No UPDATE statements
--   - No backfill of any kind
--   - No retroactive "promotion" of UNKNOWN → PARTIALLY_VALID or RECORDED
--   - Old rows keep their current (possibly NULL or legacy-backfilled) values
--   - The trigger only applies to FUTURE UPDATE statements
--
-- Idempotency: uses CREATE OR REPLACE FUNCTION and IF NOT EXISTS where applicable.
-- Re-running this migration is safe.

-- ═══════════════════════════════════════════════════════════════════
-- 1. Replace the immutability trigger function with the extended version
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION enforce_snapshot_immutability()
RETURNS TRIGGER AS $$
DECLARE
    violation_type TEXT;
BEGIN
    -- ═══════════════════════════════════════════════════════════════════
    -- ORIGINAL RULES (from migrations 006, 007, 008) — kept verbatim
    -- ═══════════════════════════════════════════════════════════════════

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
    -- NOTE: We accept any of the legacy enum values here (VALID, PARTIALLY_VALID,
    -- INVALID, RECORDED, RECONSTRUCTED) and the canonical ones. The downgrade
    -- check uses a helper to convert to a numeric rank.
    IF OLD.provenance_status IS NOT NULL AND NEW.provenance_status IS DISTINCT FROM OLD.provenance_status THEN
        -- Convert each value to a numeric rank so we can compare.
        -- RECORDED=4 (strongest), VALID=4, RECONSTRUCTED=3, PARTIALLY_VALID=3,
        -- UNKNOWN=2, INVALID=1, UNSAFE=0.
        -- A downgrade = strictly lower rank. Equal or higher rank = allowed.
        DECLARE
            old_rank INT;
            new_rank INT;
        BEGIN
            old_rank := CASE OLD.provenance_status
                WHEN 'RECORDED' THEN 4
                WHEN 'VALID' THEN 4
                WHEN 'RECONSTRUCTED' THEN 3
                WHEN 'PARTIALLY_VALID' THEN 3
                WHEN 'UNKNOWN' THEN 2
                WHEN 'INVALID' THEN 1
                WHEN 'UNSAFE' THEN 0
                ELSE 2
            END;
            new_rank := CASE NEW.provenance_status
                WHEN 'RECORDED' THEN 4
                WHEN 'VALID' THEN 4
                WHEN 'RECONSTRUCTED' THEN 3
                WHEN 'PARTIALLY_VALID' THEN 3
                WHEN 'UNKNOWN' THEN 2
                WHEN 'INVALID' THEN 1
                WHEN 'UNSAFE' THEN 0
                ELSE 2
            END;
            IF new_rank < old_rank THEN
                INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
                VALUES (OLD.id, 'provenance_downgrade', OLD.provenance_status, NEW.provenance_status, 'trigger', TRUE);
                NEW.provenance_status = OLD.provenance_status;
            END IF;
        END;
    END IF;

    -- Rule 4: model_version cannot be changed once set
    IF OLD.model_version IS NOT NULL AND NEW.model_version IS DISTINCT FROM OLD.model_version THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'model_version_change', OLD.model_version, NEW.model_version, 'trigger', TRUE);
        NEW.model_version = OLD.model_version;
    END IF;

    -- Rules 5-10 (from migration 008): AI hashes, trace, and prompt version
    IF OLD.ai_context_hash IS NOT NULL AND NEW.ai_context_hash IS DISTINCT FROM OLD.ai_context_hash THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'ai_context_hash_change', OLD.ai_context_hash, NEW.ai_context_hash, 'trigger', TRUE);
        NEW.ai_context_hash = OLD.ai_context_hash;
    END IF;

    IF OLD.ai_input_hash IS NOT NULL AND NEW.ai_input_hash IS DISTINCT FROM OLD.ai_input_hash THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'ai_input_hash_change', OLD.ai_input_hash, NEW.ai_input_hash, 'trigger', TRUE);
        NEW.ai_input_hash = OLD.ai_input_hash;
    END IF;

    IF OLD.ai_prompt_hash IS NOT NULL AND NEW.ai_prompt_hash IS DISTINCT FROM OLD.ai_prompt_hash THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'ai_prompt_hash_change', OLD.ai_prompt_hash, NEW.ai_prompt_hash, 'trigger', TRUE);
        NEW.ai_prompt_hash = OLD.ai_prompt_hash;
    END IF;

    IF OLD.ai_response_hash IS NOT NULL AND NEW.ai_response_hash IS DISTINCT FROM OLD.ai_response_hash THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'ai_response_hash_change', OLD.ai_response_hash, NEW.ai_response_hash, 'trigger', TRUE);
        NEW.ai_response_hash = OLD.ai_response_hash;
    END IF;

    IF OLD.ai_trace IS NOT NULL AND NEW.ai_trace IS DISTINCT FROM OLD.ai_trace THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'ai_trace_change',
                LEFT(OLD.ai_trace::TEXT, 200),
                LEFT(NEW.ai_trace::TEXT, 200),
                'trigger', TRUE);
        NEW.ai_trace = OLD.ai_trace;
    END IF;

    IF OLD.ai_prompt_version IS NOT NULL AND NEW.ai_prompt_version IS DISTINCT FROM OLD.ai_prompt_version THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'ai_prompt_version_change', OLD.ai_prompt_version, NEW.ai_prompt_version, 'trigger', TRUE);
        NEW.ai_prompt_version = OLD.ai_prompt_version;
    END IF;

    IF OLD.ai_model IS NOT NULL AND NEW.ai_model IS DISTINCT FROM OLD.ai_model THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'ai_model_change', OLD.ai_model, NEW.ai_model, 'trigger', TRUE);
        NEW.ai_model = OLD.ai_model;
    END IF;

    -- ═══════════════════════════════════════════════════════════════════
    -- NEW RULES (Phase 5 forensic fix)
    -- These extend immutability to scientific-integrity fields that were
    -- previously unprotected and could be freely overwritten via PATCH.
    -- ═══════════════════════════════════════════════════════════════════

    -- Rule 11: t_feature — once set, cannot change
    IF OLD.t_feature IS NOT NULL AND NEW.t_feature IS DISTINCT FROM OLD.t_feature THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 't_feature_change', OLD.t_feature::TEXT, NEW.t_feature::TEXT, 'trigger', TRUE);
        NEW.t_feature = OLD.t_feature;
    END IF;

    -- Rule 12: t_prediction — once set, cannot change
    IF OLD.t_prediction IS NOT NULL AND NEW.t_prediction IS DISTINCT FROM OLD.t_prediction THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 't_prediction_change', OLD.t_prediction::TEXT, NEW.t_prediction::TEXT, 'trigger', TRUE);
        NEW.t_prediction = OLD.t_prediction;
    END IF;

    -- Rule 13: scientific_collection_eligible — once true, cannot become false
    -- (also: once set, cannot change at all — except NULL → value for initial enrichment)
    IF OLD.scientific_collection_eligible IS NOT NULL AND NEW.scientific_collection_eligible IS DISTINCT FROM OLD.scientific_collection_eligible THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'scientific_eligible_change',
                OLD.scientific_collection_eligible::TEXT,
                NEW.scientific_collection_eligible::TEXT,
                'trigger', TRUE);
        NEW.scientific_collection_eligible = OLD.scientific_collection_eligible;
    END IF;

    -- Rule 14: version_freeze — immutable once set
    IF OLD.version_freeze IS NOT NULL AND NEW.version_freeze IS DISTINCT FROM OLD.version_freeze THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'version_freeze_change',
                LEFT(OLD.version_freeze::TEXT, 200),
                LEFT(NEW.version_freeze::TEXT, 200),
                'trigger', TRUE);
        NEW.version_freeze = OLD.version_freeze;
    END IF;

    -- Rule 15: completeness_score — immutable once set
    IF OLD.completeness_score IS NOT NULL AND NEW.completeness_score IS DISTINCT FROM OLD.completeness_score THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'completeness_score_change',
                OLD.completeness_score::TEXT,
                NEW.completeness_score::TEXT,
                'trigger', TRUE);
        NEW.completeness_score = OLD.completeness_score;
    END IF;

    -- Rule 16: temporal_safety_score — immutable once set
    IF OLD.temporal_safety_score IS NOT NULL AND NEW.temporal_safety_score IS DISTINCT FROM OLD.temporal_safety_score THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'temporal_safety_score_change',
                OLD.temporal_safety_score::TEXT,
                NEW.temporal_safety_score::TEXT,
                'trigger', TRUE);
        NEW.temporal_safety_score = OLD.temporal_safety_score;
    END IF;

    -- Rule 17: timestamp_provenance — immutable once set
    IF OLD.timestamp_provenance IS NOT NULL AND NEW.timestamp_provenance IS DISTINCT FROM OLD.timestamp_provenance THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'timestamp_provenance_change',
                LEFT(OLD.timestamp_provenance::TEXT, 200),
                LEFT(NEW.timestamp_provenance::TEXT, 200),
                'trigger', TRUE);
        NEW.timestamp_provenance = OLD.timestamp_provenance;
    END IF;

    -- Rule 18: temporal_safety_reason — immutable once set
    IF OLD.temporal_safety_reason IS NOT NULL AND NEW.temporal_safety_reason IS DISTINCT FROM OLD.temporal_safety_reason THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'temporal_safety_reason_change',
                LEFT(OLD.temporal_safety_reason::TEXT, 200),
                LEFT(NEW.temporal_safety_reason::TEXT, 200),
                'trigger', TRUE);
        NEW.temporal_safety_reason = OLD.temporal_safety_reason;
    END IF;

    -- Rule 19: ai_provenance_risk — immutable once set
    IF OLD.ai_provenance_risk IS NOT NULL AND NEW.ai_provenance_risk IS DISTINCT FROM OLD.ai_provenance_risk THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'ai_provenance_risk_change',
                LEFT(OLD.ai_provenance_risk::TEXT, 200),
                LEFT(NEW.ai_provenance_risk::TEXT, 200),
                'trigger', TRUE);
        NEW.ai_provenance_risk = OLD.ai_provenance_risk;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════════
-- 2. The trigger itself was already created in migration 007.
--    Since we use CREATE OR REPLACE FUNCTION, the trigger will pick up
--    the new function body automatically — no need to drop/recreate it.
-- ═══════════════════════════════════════════════════════════════════

-- Sanity check: confirm the trigger exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.triggers
        WHERE event_object_table = 'predictions'
        AND trigger_name = 'trg_snapshot_immutability'
    ) THEN
        RAISE NOTICE 'WARNING: trg_snapshot_immutability trigger NOT FOUND. Run migration 007 first.';
    ELSE
        RAISE NOTICE 'trg_snapshot_immutability trigger confirmed present.';
    END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- 3. Add validation notice (NO data modification)
-- ═══════════════════════════════════════════════════════════════════

DO $$
BEGIN
    RAISE NOTICE 'Migration 010 (scientific_integrity) applied successfully.';
    RAISE NOTICE '  - enforce_snapshot_immutability() extended with 9 new rules:';
    RAISE NOTICE '    t_feature, t_prediction, scientific_collection_eligible,';
    RAISE NOTICE '    version_freeze, completeness_score, temporal_safety_score,';
    RAISE NOTICE '    timestamp_provenance, temporal_safety_reason, ai_provenance_risk';
    RAISE NOTICE '  - Rules: NULL→value ALLOWED, value→same ALLOWED,';
    RAISE NOTICE '           value→different BLOCKED, value→NULL BLOCKED';
    RAISE NOTICE '  - CRITICAL: No historical data was modified.';
    RAISE NOTICE '  - CRITICAL: No backfill was performed.';
    RAISE NOTICE '  - Existing rows keep their current values, including NULLs.';
END $$;
