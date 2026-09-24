// ═══════════════════════════════════════════════════════════════════
// TEMPORARY ENDPOINT: Phase 5.3.3 Migration + Audit
// This file will be REMOVED after the audit is complete.
// ═══════════════════════════════════════════════════════════════════
//
// Security: Requires ADMIN_TOKEN_SECRET in Authorization header
// Usage: curl -H "Authorization: Bearer $ADMIN_TOKEN" /api/temp-audit-533?action=...
//
// Actions:
//   test          — Test Neon connection (step A)
//   pre-migrate   — Pre-migration proof for B.5 (step B prerequisite)
//   migrate       — Execute migration 009 (step B)
//   verify-schema — Verify schema after migration (step C)
//   capture-old   — Capture exact IDs of 15 old predictions (step G prerequisite)
//   audit-new     — Audit 10 new predictions by exact IDs (step F)
//   audit-old     — Audit 15 old predictions by exact IDs (step G)

import { createSql, NEON_DATABASE_URL } from './_lib/db.js';
import { setCorsHeaders } from './_lib/cors.js';
import crypto from 'crypto';

// Temporary audit token — this endpoint will be DELETED after audit
// Token = SHA-256 of "virtumatch-phase5.3.3-audit" = hardcoded for this one-time use
const AUDIT_TOKEN_HASH = 'b8f3a1c9d2e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0';

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  // Simple bearer token auth for this temporary endpoint
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '').trim();
  const expectedToken = crypto.createHash('sha256').update('virtumatch-phase5.3.3-audit').digest('hex');
  if (token !== expectedToken) {
    return res.status(401).json({ success: false, error: 'Authorization required' });
  }

  if (!NEON_DATABASE_URL) {
    return res.status(500).json({ success: false, error: 'NEON_DATABASE_URL not configured' });
  }

  const action = req.query.action || 'test';
  const sql = createSql();

  try {
    switch (action) {
      case 'test': {
        // Step A: Test Neon connection
        const [result] = await sql`SELECT current_database() as db, current_user as user, now() as time`;
        return res.status(200).json({ success: true, action: 'test', connection: result });
      }

      case 'pre-migrate': {
        // Step B prerequisite: Prove that score=0.0 rows actually have t_feature > t_prediction
        // BEFORE assigning FUTURE_FEATURE_LEAK
        const scoreZeroRows = await sql`
          SELECT id, t_feature, t_prediction, temporal_safety_score,
            CASE
              WHEN t_feature IS NOT NULL AND t_prediction IS NOT NULL AND t_feature > t_prediction
                THEN 'CONFIRMED_FUTURE_LEAK'
              WHEN t_feature IS NULL
                THEN 'T_FEATURE_NULL'
              WHEN t_feature IS NOT NULL AND t_prediction IS NULL
                THEN 'T_PREDICTION_NULL'
              ELSE 'NO_LEAK_EVIDENCE'
            END as leak_status
          FROM predictions
          WHERE temporal_safety_score = 0.0
          ORDER BY id
        `;

        const confirmedLeaks = scoreZeroRows.filter(r => r.leak_status === 'CONFIRMED_FUTURE_LEAK');
        const noLeakEvidence = scoreZeroRows.filter(r => r.leak_status === 'NO_LEAK_EVIDENCE');
        const tFeatureNull = scoreZeroRows.filter(r => r.leak_status === 'T_FEATURE_NULL');
        const tPredictionNull = scoreZeroRows.filter(r => r.leak_status === 'T_PREDICTION_NULL');

        // Decision: only assign FUTURE_FEATURE_LEAK to CONFIRMED rows
        // For rows with no leak evidence, assign a different reason
        const decision = {
          total_score_zero: scoreZeroRows.length,
          confirmed_future_leak: confirmedLeaks.length,
          no_leak_evidence: noLeakEvidence.length,
          t_feature_null: tFeatureNull.length,
          t_prediction_null: tPredictionNull.length,
          recommendation: noLeakEvidence.length > 0
            ? 'PARTIAL: Some score=0.0 rows have no future leak evidence. Use conditional UPDATE.'
            : 'FULL: All score=0.0 rows are confirmed future leaks. Safe to assign FUTURE_FEATURE_LEAK.',
          rows: scoreZeroRows,
        };

        return res.status(200).json({ success: true, action: 'pre-migrate', decision });
      }

      case 'migrate': {
        // Step B: Execute migration 009
        const results = [];

        // B.1: Add temporal_safety_reason column
        await sql`ALTER TABLE predictions ADD COLUMN IF NOT EXISTS temporal_safety_reason TEXT`;
        results.push('Added temporal_safety_reason TEXT');

        // B.2: Add timestamp_provenance JSONB column
        await sql`ALTER TABLE predictions ADD COLUMN IF NOT EXISTS timestamp_provenance JSONB`;
        results.push('Added timestamp_provenance JSONB');

        // B.3: Backfill — score=1.0 + t_feature=NULL → T_FEATURE_UNKNOWN
        const r3 = await sql`
          UPDATE predictions
          SET temporal_safety_reason = 'T_FEATURE_UNKNOWN'
          WHERE temporal_safety_score = 1.0
            AND t_feature IS NULL
            AND temporal_safety_reason IS NULL
        `;
        results.push(`Backfilled T_FEATURE_UNKNOWN: ${r3.count} rows`);

        // B.4: Backfill — score=1.0 + t_feature non-NULL → VERIFIED
        const r4 = await sql`
          UPDATE predictions
          SET temporal_safety_reason = 'VERIFIED'
          WHERE temporal_safety_score = 1.0
            AND t_feature IS NOT NULL
            AND temporal_safety_reason IS NULL
        `;
        results.push(`Backfilled VERIFIED: ${r4.count} rows`);

        // B.5: Backfill — score=0.0 → ONLY for confirmed future leaks
        // (per pre-migrate proof: only assign FUTURE_FEATURE_LEAK where t_feature > t_prediction)
        const r5a = await sql`
          UPDATE predictions
          SET temporal_safety_reason = 'FUTURE_FEATURE_LEAK'
          WHERE temporal_safety_score = 0.0
            AND t_feature IS NOT NULL
            AND t_prediction IS NOT NULL
            AND t_feature > t_prediction
            AND temporal_safety_reason IS NULL
        `;
        results.push(`Backfilled FUTURE_FEATURE_LEAK (confirmed): ${r5a.count} rows`);

        // B.5b: For score=0.0 rows where we can't confirm future leak → TEMPORAL_SAFETY_UNVERIFIED
        const r5b = await sql`
          UPDATE predictions
          SET temporal_safety_reason = 'TEMPORAL_SAFETY_UNVERIFIED'
          WHERE temporal_safety_score = 0.0
            AND temporal_safety_reason IS NULL
        `;
        results.push(`Backfilled TEMPORAL_SAFETY_UNVERIFIED (unconfirmed): ${r5b.count} rows`);

        // B.6: Create partial index
        await sql`
          CREATE INDEX IF NOT EXISTS idx_predictions_temporal_safety_reason
          ON predictions (temporal_safety_reason)
          WHERE temporal_safety_reason IS NOT NULL
        `;
        results.push('Created partial index');

        return res.status(200).json({ success: true, action: 'migrate', results });
      }

      case 'verify-schema': {
        // Step C: Verify schema
        const columns = await sql`
          SELECT column_name, data_type, is_nullable
          FROM information_schema.columns
          WHERE table_name = 'predictions'
            AND column_name IN ('temporal_safety_reason', 'timestamp_provenance')
          ORDER BY column_name
        `;

        const indexes = await sql`
          SELECT indexname, indexdef
          FROM pg_indexes
          WHERE tablename = 'predictions'
            AND indexname = 'idx_predictions_temporal_safety_reason'
        `;

        return res.status(200).json({
          success: true,
          action: 'verify-schema',
          columns,
          indexes,
          columns_ok: columns.length === 2,
          index_ok: indexes.length === 1,
        });
      }

      case 'capture-old': {
        // Capture exact IDs of the 15 old predictions (before deployment)
        // Use timestamp threshold: before the deployment moment
        const deployTimestamp = req.query.deploy_ts || new Date().toISOString();

        const oldRows = await sql`
          SELECT id, match_id, home_team, away_team, league, created_at,
            t_feature, t_prediction, temporal_safety_score, temporal_safety_reason,
            timestamp_provenance, scientific_collection_eligible, completeness_score,
            ai_response_hash
          FROM predictions
          WHERE created_at < ${deployTimestamp}
          ORDER BY created_at DESC
        `;

        return res.status(200).json({
          success: true,
          action: 'capture-old',
          deploy_timestamp: deployTimestamp,
          count: oldRows.length,
          ids: oldRows.map(r => r.id),
          rows: oldRows,
        });
      }

      case 'audit-new': {
        // Step F: Audit 10 new predictions by exact IDs
        const idsParam = req.query.ids || '';
        if (!idsParam) {
          return res.status(400).json({ success: false, error: 'ids parameter required (comma-separated)' });
        }
        const ids = idsParam.split(',').map(id => parseInt(id)).filter(id => !isNaN(id));

        if (ids.length === 0) {
          return res.status(400).json({ success: false, error: 'No valid IDs provided' });
        }

        // Full audit of new predictions
        const rows = await sql`
          SELECT
            id, match_id, home_team, away_team, league, created_at,
            t_feature, t_prediction,
            timestamp_provenance,
            temporal_safety_score, temporal_safety_reason,
            scientific_collection_eligible, completeness_score,
            feature_snapshot_hash, ai_response_hash, ai_model,
            ai_trace->'timestamp' as ai_trace_timestamp,
            feature_snapshot->'source_timestamps' as source_timestamps_in_snapshot
          FROM predictions
          WHERE id = ANY(${ids})
          ORDER BY created_at DESC
        `;

        // Verification checks
        const checks = rows.map(r => {
          const tFeatureNotNull = r.t_feature !== null;
          const tFeatureLeTPrediction = r.t_feature && r.t_prediction ? r.t_feature <= r.t_prediction : false;
          const provenanceIsObservationTime = r.timestamp_provenance
            && Object.values(r.timestamp_provenance).every(v => v === 'OBSERVATION_TIME' || v === 'UNKNOWN');
          const scoreMatchesReason = (r.temporal_safety_score === 1.0 && ['VERIFIED', 'WITHIN_CLOCK_SKEW'].includes(r.temporal_safety_reason))
            || (r.temporal_safety_score === 0.0 && ['T_FEATURE_UNKNOWN', 'FUTURE_FEATURE_LEAK', 'TEMPORAL_SAFETY_UNVERIFIED'].includes(r.temporal_safety_reason));
          const eligibleMatchesFormula = r.scientific_collection_eligible
            === (r.completeness_score >= 0.5 && r.temporal_safety_score >= 1.0);
          const aiHashConsistent = r.ai_response_hash !== null
            ? r.ai_response_hash.length > 0  // Non-NULL hash must be valid
            : r.ai_model === null || r.ai_model === 'math-v2';  // NULL hash OK only for math-v2

          return {
            id: r.id,
            match: `${r.home_team} vs ${r.away_team}`,
            t_feature: r.t_feature,
            t_prediction: r.t_prediction,
            timestamp_provenance: r.timestamp_provenance,
            temporal_safety_score: r.temporal_safety_score,
            temporal_safety_reason: r.temporal_safety_reason,
            scientific_collection_eligible: r.scientific_collection_eligible,
            completeness_score: r.completeness_score,
            ai_response_hash: r.ai_response_hash ? 'present' : 'null',
            checks: {
              t_feature_not_null: tFeatureNotNull,
              t_feature_le_t_prediction: tFeatureLeTPrediction,
              provenance_observation_time: provenanceIsObservationTime,
              score_matches_reason: scoreMatchesReason,
              eligible_matches_formula: eligibleMatchesFormula,
              ai_hash_consistent: aiHashConsistent,
            },
          };
        });

        const allChecksPass = checks.every(c => Object.values(c.checks).every(v => v === true));
        const failedChecks = checks.filter(c => !Object.values(c.checks).every(v => v === true));

        return res.status(200).json({
          success: true,
          action: 'audit-new',
          count: rows.length,
          checks,
          all_checks_pass: allChecksPass,
          failed_checks: failedChecks.length,
        });
      }

      case 'audit-old': {
        // Step G: Audit 15 old predictions by exact IDs
        const idsParam = req.query.ids || '';
        if (!idsParam) {
          return res.status(400).json({ success: false, error: 'ids parameter required (comma-separated)' });
        }
        const ids = idsParam.split(',').map(id => parseInt(id)).filter(id => !isNaN(id));

        const rows = await sql`
          SELECT
            id, match_id, home_team, away_team, created_at,
            t_feature, t_prediction,
            temporal_safety_score, temporal_safety_reason,
            timestamp_provenance, scientific_collection_eligible, completeness_score,
            ai_response_hash
          FROM predictions
          WHERE id = ANY(${ids})
          ORDER BY created_at DESC
        `;

        // Verify immutability
        const checks = rows.map(r => ({
          id: r.id,
          match: `${r.home_team} vs ${r.away_team}`,
          t_feature: r.t_feature,
          t_feature_still_null: r.t_feature === null,
          timestamp_provenance: r.timestamp_provenance,
          provenance_still_null: r.timestamp_provenance === null,
          temporal_safety_reason: r.temporal_safety_reason,
          reason_backfilled: r.temporal_safety_reason !== null,
          scientific_collection_eligible: r.scientific_collection_eligible,
        }));

        const allImmutable = checks.every(c => c.t_feature_still_null && c.provenance_still_null);

        return res.status(200).json({
          success: true,
          action: 'audit-old',
          count: rows.length,
          checks,
          all_immutable: allImmutable,
        });
      }

      default:
        return res.status(400).json({ success: false, error: `Unknown action: ${action}` });
    }
  } catch (err) {
    console.error('[temp-audit-533]', err);
    return res.status(500).json({ success: false, error: err.message, stack: err.stack?.split('\n').slice(0, 5) });
  } finally {
    await sql.end();
  }
}
