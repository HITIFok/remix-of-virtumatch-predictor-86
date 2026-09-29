-- ============================================
-- MIGRATION 011: AI Call Status — Preserve Groq Response Traceability
-- Phase 5.3.17.5 — Forensic Audit Fix
-- ============================================
--
-- This migration adds two new columns to the `predictions` table:
--
--   ai_call_status     TEXT      — disambiguates the outcome of the Groq call
--   ai_response_length INTEGER   — length (in characters) of the raw LLM response
--                                  (only set when ai_call_status IN ('PARSE_OK', 'PARSE_FAILED'))
--
-- Allowed values for ai_call_status (CHECK not enforced to preserve legacy NULL):
--
--   NOT_CALLED       — Groq was never invoked (no GROQ_API_KEY, budget exceeded,
--                      or deadline already expired before the call)
--   HTTP_ERROR       — Groq returned a non-2xx HTTP status (4xx/5xx, excluding
--                      404 which triggers model fallback rather than failure)
--   TIMEOUT          — the call timed out (Promise.race or fetch timeout)
--   EMPTY_RESPONSE   — Groq returned 200 OK but content was empty ('')
--   PARSE_FAILED     — Groq returned a non-empty response, but parsePredictions()
--                      could not extract a usable prediction. THE RESPONSE HASH
--                      IS NON-NULL — this is the key fix from Phase 5.3.17.4.
--   PARSE_OK         — Groq returned a non-empty response AND parsePredictions()
--                      succeeded. THE RESPONSE HASH IS NON-NULL.
--   NULL             — Legacy rows (created before migration 011). Interpreted
--                      as LEGACY_UNKNOWN. NOT backfilled.
--
-- Rules (per audit mandate §5 + §18):
--   NULL → value              ALLOWED  (initial enrichment via PATCH)
--   value → same value        ALLOWED  (idempotent)
--   value → different value   BLOCKED
--   value → NULL              BLOCKED
--
-- CRITICAL — DOES NOT MODIFY HISTORICAL DATA.
-- Per audit mandate §14 ("NE PAS CORRIGER L'HISTORIQUE PAR FABRICATION"):
--   - No UPDATE statements
--   - No backfill of any kind
--   - Old rows keep their current NULL values
--   - The trigger only applies to FUTURE UPDATE statements
--
-- Idempotency: uses CREATE OR REPLACE FUNCTION and IF NOT EXISTS where applicable.
-- Re-running this migration is safe.
--
-- ⚠️  THIS MIGRATION IS NOT EXECUTED ON NEON IN PHASE 5.3.17.5.
--     It is committed as a versioned file only. Execution is deferred to a
--     separate deployment phase (5.3.17.6+) once the code path is validated.

-- ═══════════════════════════════════════════════════════════════════
-- 1. Add the new columns
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE predictions ADD COLUMN IF NOT EXISTS ai_call_status TEXT;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS ai_response_length INTEGER;

-- ═══════════════════════════════════════════════════════════════════
-- 2. Extend the immutability trigger function (CREATE OR REPLACE)
--
--    The function enforce_snapshot_immutability() was originally created in
--    migration 007, extended by 008, and extended again by 010. This
--    migration extends it ONE MORE TIME to cover the two new fields.
--
--    IMPORTANT: This is a FULL replacement of the function — it MUST contain
--    ALL the existing rules (from 007, 008, 010) plus the two new ones.
--    If we omit any rule, it will silently disappear.
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
    IF OLD.provenance_status IS NOT NULL AND NEW.provenance_status IS DISTINCT FROM OLD.provenance_status THEN
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
    -- RULES from migration 010 (Phase 5 forensic fix) — kept verbatim
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

    -- Rule 13: scientific_collection_eligible
    IF OLD.scientific_collection_eligible IS NOT NULL AND NEW.scientific_collection_eligible IS DISTINCT FROM OLD.scientific_collection_eligible THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'scientific_eligible_change',
                OLD.scientific_collection_eligible::TEXT,
                NEW.scientific_collection_eligible::TEXT,
                'trigger', TRUE);
        NEW.scientific_collection_eligible = OLD.scientific_collection_eligible;
    END IF;

    -- Rule 14: version_freeze
    IF OLD.version_freeze IS NOT NULL AND NEW.version_freeze IS DISTINCT FROM OLD.version_freeze THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'version_freeze_change',
                LEFT(OLD.version_freeze::TEXT, 200),
                LEFT(NEW.version_freeze::TEXT, 200),
                'trigger', TRUE);
        NEW.version_freeze = OLD.version_freeze;
    END IF;

    -- Rule 15: completeness_score
    IF OLD.completeness_score IS NOT NULL AND NEW.completeness_score IS DISTINCT FROM OLD.completeness_score THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'completeness_score_change',
                OLD.completeness_score::TEXT,
                NEW.completeness_score::TEXT,
                'trigger', TRUE);
        NEW.completeness_score = OLD.completeness_score;
    END IF;

    -- Rule 16: temporal_safety_score
    IF OLD.temporal_safety_score IS NOT NULL AND NEW.temporal_safety_score IS DISTINCT FROM OLD.temporal_safety_score THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'temporal_safety_score_change',
                OLD.temporal_safety_score::TEXT,
                NEW.temporal_safety_score::TEXT,
                'trigger', TRUE);
        NEW.temporal_safety_score = OLD.temporal_safety_score;
    END IF;

    -- Rule 17: timestamp_provenance
    IF OLD.timestamp_provenance IS NOT NULL AND NEW.timestamp_provenance IS DISTINCT FROM OLD.timestamp_provenance THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'timestamp_provenance_change',
                LEFT(OLD.timestamp_provenance::TEXT, 200),
                LEFT(NEW.timestamp_provenance::TEXT, 200),
                'trigger', TRUE);
        NEW.timestamp_provenance = OLD.timestamp_provenance;
    END IF;

    -- Rule 18: temporal_safety_reason
    IF OLD.temporal_safety_reason IS NOT NULL AND NEW.temporal_safety_reason IS DISTINCT FROM OLD.temporal_safety_reason THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'temporal_safety_reason_change',
                LEFT(OLD.temporal_safety_reason::TEXT, 200),
                LEFT(NEW.temporal_safety_reason::TEXT, 200),
                'trigger', TRUE);
        NEW.temporal_safety_reason = OLD.temporal_safety_reason;
    END IF;

    -- Rule 19: ai_provenance_risk
    IF OLD.ai_provenance_risk IS NOT NULL AND NEW.ai_provenance_risk IS DISTINCT FROM OLD.ai_provenance_risk THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'ai_provenance_risk_change',
                LEFT(OLD.ai_provenance_risk::TEXT, 200),
                LEFT(NEW.ai_provenance_risk::TEXT, 200),
                'trigger', TRUE);
        NEW.ai_provenance_risk = OLD.ai_provenance_risk;
    END IF;

    -- ═══════════════════════════════════════════════════════════════════
    -- NEW RULES (Phase 5.3.17.5 — AI Call Status)
    -- ═══════════════════════════════════════════════════════════════════

    -- Rule 20: ai_call_status — immutable once set (NULL → value ALLOWED)
    IF OLD.ai_call_status IS NOT NULL AND NEW.ai_call_status IS DISTINCT FROM OLD.ai_call_status THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'ai_call_status_change',
                LEFT(OLD.ai_call_status::TEXT, 200),
                LEFT(NEW.ai_call_status::TEXT, 200),
                'trigger', TRUE);
        NEW.ai_call_status = OLD.ai_call_status;
    END IF;

    -- Rule 21: ai_response_length — immutable once set (NULL → value ALLOWED)
    IF OLD.ai_response_length IS NOT NULL AND NEW.ai_response_length IS DISTINCT FROM OLD.ai_response_length THEN
        INSERT INTO snapshot_immutability_violations (prediction_id, violation_type, old_value, new_value, attempted_by, blocked)
        VALUES (OLD.id, 'ai_response_length_change',
                OLD.ai_response_length::TEXT,
                NEW.ai_response_length::TEXT,
                'trigger', TRUE);
        NEW.ai_response_length = OLD.ai_response_length;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════════
-- 3. Sanity check: confirm the trigger is still attached
-- ═══════════════════════════════════════════════════════════════════

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
-- 4. Validation notice (NO data modification)
-- ═══════════════════════════════════════════════════════════════════

DO $$
BEGIN
    RAISE NOTICE 'Migration 011 (ai_call_status) applied successfully.';
    RAISE NOTICE '  - Added column: ai_call_status TEXT';
    RAISE NOTICE '  - Added column: ai_response_length INTEGER';
    RAISE NOTICE '  - enforce_snapshot_immutability() extended with 2 new rules:';
    RAISE NOTICE '    ai_call_status_change, ai_response_length_change';
    RAISE NOTICE '  - Rules: NULL→value ALLOWED, value→same ALLOWED,';
    RAISE NOTICE '           value→different BLOCKED, value→NULL BLOCKED';
    RAISE NOTICE '  - CRITICAL: No historical data was modified.';
    RAISE NOTICE '  - CRITICAL: No backfill was performed.';
    RAISE NOTICE '  - Existing rows keep their current NULL values for both columns.';
    RAISE NOTICE '  - NULL ai_call_status is interpreted as LEGACY_UNKNOWN (not NOT_CALLED).';
END $$;
