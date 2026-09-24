# HISTORICAL DATA POLICY — LEGACY / NOT SCIENTIFICALLY VALIDATED

> Forensic audit Phase 14 — Documentation of historical data status.
> This document is a reference, NOT a SQL migration. No data is modified.

## Policy

Per audit mandate §14 and §22, the system does NOT fabricate historical
data to make older predictions appear scientifically validated.

The previous migrations (007 and 008) already performed the following
backfills BEFORE this audit. These backfills are now part of the historical
record and are NOT reversed by the Phase 5 forensic fix:

### Migration 007 backfills (already applied to production)

1. `UPDATE predictions SET t_prediction = created_at WHERE t_prediction IS NULL`
   - Affects: ALL predictions that existed before migration 007 ran.
   - Status: t_prediction is a fabricated timestamp for these rows.
   - Classification: **LEGACY / NOT SCIENTIFICALLY VALIDATED**
   - Action: These rows must NOT be included in any backtest that requires
     accurate T_prediction timing. Filter them out by
     `t_prediction = created_at` OR `feature_snapshot IS NULL`.

2. `UPDATE predictions SET provenance_status = 'PARTIALLY_VALID'
   WHERE feature_snapshot IS NOT NULL AND provenance_status = 'UNKNOWN'`
   - Affects: ALL predictions with a feature_snapshot that had UNKNOWN provenance.
   - Status: provenance was silently upgraded from UNKNOWN to PARTIALLY_VALID.
   - Classification: **LEGACY / NOT SCIENTIFICALLY VALIDATED**
   - Action: Treat these rows as UNKNOWN for backtest purposes. The
     `PARTIALLY_VALID` value should not be trusted as a real provenance
     classification for these rows.

### Migration 008 backfills (already applied to production)

3. `UPDATE predictions SET ai_prompt_version = '7.0', ai_model = 'qwen/qwen3.8-27b'
   WHERE feature_snapshot IS NOT NULL AND ai_prompt_version IS NULL`
   - Affects: ALL predictions with a feature_snapshot but no real AI trace.
   - Status: ai_prompt_version and ai_model are fabricated values.
   - Classification: **LEGACY / NOT SCIENTIFICALLY VALIDATED**
   - Action: These rows did NOT actually call the Groq LLM with prompt v7.0.
     Treat the AI portion of their snapshot as UNKNOWN. They must NOT be
     used to evaluate AI prompt performance or AI model accuracy.

## How to identify LEGACY rows for backtest exclusion

Any prediction row that matches ANY of the following conditions is LEGACY
and must be excluded from any scientific backtest:

```sql
-- Identify legacy rows
SELECT
  id,
  created_at,
  CASE
    WHEN t_prediction = created_at THEN 'LEGACY_T_PREDICTION_FABRICATED'
    WHEN provenance_status = 'PARTIALLY_VALID' AND feature_snapshot IS NOT NULL
      THEN 'LEGACY_PROVENANCE_SILENTLY_UPGRADED'
    WHEN ai_prompt_version = '7.0' AND ai_response_hash IS NULL
      THEN 'LEGACY_AI_TRACE_FABRICATED'
    WHEN feature_snapshot IS NULL
      THEN 'LEGACY_NO_SNAPSHOT'
    ELSE 'POST_PHASE5'
  END AS row_classification
FROM predictions
ORDER BY created_at DESC;
```

For scientific backtest queries, exclude legacy rows:

```sql
-- Scientific backtest filter (only post-Phase-5 rows)
SELECT * FROM predictions
WHERE
  -- Has a feature_snapshot
  feature_snapshot IS NOT NULL
  -- T_prediction is NOT a fabricated created_at copy
  AND t_prediction IS NOT NULL
  AND t_prediction != created_at
  -- AI hashes are either ALL null (no AI used) or ALL set (AI used)
  AND (
    (ai_context_hash IS NULL AND ai_input_hash IS NULL
     AND ai_prompt_hash IS NULL AND ai_response_hash IS NULL)
    OR
    (ai_context_hash IS NOT NULL AND ai_input_hash IS NOT NULL
     AND ai_prompt_hash IS NOT NULL AND ai_response_hash IS NOT NULL)
  )
  -- provenance is one of the canonical enum values
  AND provenance_status IN ('RECORDED', 'RECONSTRUCTED', 'UNKNOWN', 'UNSAFE')
;
```

## What the Phase 5 forensic fix does NOT do

- Does NOT delete or modify any existing prediction row.
- Does NOT recompute any AI hashes for historical predictions.
- Does NOT replace the previous (incorrect) backfilled values with "correct"
  ones — there is no way to recover the original UNKNOWN state without
  destroying data the audit may want to inspect.
- Does NOT mark any row as READY for scientific collection.

## What the Phase 5 forensic fix DOES do

- For NEW predictions inserted after the fix is deployed:
  - `t_feature` is recomputed server-side from `feature_snapshot.source_timestamps`.
    Client-supplied `t_feature` that doesn't match is logged as
    `CLIENT_T_FEATURE_MISMATCH` and overwritten.
  - `scientific_collection_eligible` is only `true` when AI was actually used
    (i.e. `ai_response_hash` is non-null).
  - `version_freeze.model_version` matches the canonical `MODEL_VERSION`
    constant from `feature-snapshot.ts` (`2.0.0`).
- For the DB trigger (migration 010):
  - Extends immutability to 9 scientific fields not previously protected.
  - Old rows keep their current values (including any backfilled values
    from migrations 007/008).
  - New UPDATE statements that try to change an existing value are blocked.

## Recommendation for analysis scripts

Any script that queries the predictions table for scientific analysis
(backtest, ablation, calibration measurement, etc.) MUST:

1. Filter out LEGACY rows using the criteria above.
2. Treat LEGACY rows as `HISTORICAL / NOT SCIENTIFICALLY VALIDATED`.
3. Never include LEGACY rows in accuracy, calibration, or leakage metrics.
4. Document the count of LEGACY rows separately from the count of
   scientifically valid rows in any report.

A prediction row is considered scientifically valid ONLY if it was inserted
AFTER the Phase 5 forensic fix was deployed AND has:
- `feature_snapshot` IS NOT NULL
- `t_feature` IS NOT NULL (when sources provide timestamps)
- `t_prediction` IS NOT NULL AND `t_prediction != created_at`
- `scientific_collection_eligible = true`
- `version_freeze.model_version = '2.0.0'` (canonical)
- `ai_response_hash` IS NOT NULL (when AI was used)
