// Vercel Serverless Function — Dataset Export
// Phase 5 — Section 19: Export dataset for analysis
//
// NEVER exports: secrets, tokens, credentials, personal data

import { setCorsHeaders } from './_lib/cors.js';
import { requireUserAuth } from './_lib/auth.js';
import { createSql, NEON_DATABASE_URL } from './_lib/db.js';
import { successResponse, internalError, unauthorized, invalidInput } from './_lib/errors.js';

const MAX_EXPORT = 5000;

export default async function handler(req, res) {
  setCorsHeaders(req, res, 'GET, OPTIONS', 'Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).end('');
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  // Require user auth (admin-level operation)
  const userId = await requireUserAuth(req);
  if (!userId) {
    return unauthorized(res);
  }

  if (!NEON_DATABASE_URL) {
    return internalError(res, null, 'Server not configured');
  }

  try {
    const sql = createSql();

    // Query parameters
    const split = req.query.split; // 'TRAIN', 'VALIDATION', 'TEST', or undefined (all)
    const provenance = req.query.provenance; // filter by provenance
    const limit = Math.min(parseInt(req.query.limit || '1000', 10), MAX_EXPORT);

    // Build query conditions
    const conditions = [];
    if (split && ['TRAIN', 'VALIDATION', 'TEST'].includes(split)) {
      conditions.push(sql`AND dataset_split = ${split}`);
    }
    if (provenance && ['RECORDED', 'RECONSTRUCTED', 'UNKNOWN', 'UNSAFE', 'VALID', 'PARTIALLY_VALID', 'INVALID'].includes(provenance)) {
      conditions.push(sql`AND provenance_status = ${provenance}`);
    }

    // Export predictions with snapshots only
    const rows = await sql`
      SELECT
        id,
        home_team,
        away_team,
        league,
        odd_home,
        odd_draw,
        odd_away,
        prob_home,
        prob_draw,
        prob_away,
        prediction,
        confidence,
        actual_outcome,
        created_at,
        t_prediction,
        t_feature,
        snapshot_timestamp,
        feature_snapshot,
        model_version,
        feature_version,
        config_version,
        calibration_version,
        dataset_version,
        feature_snapshot_hash,
        prediction_hash,
        provenance_status,
        dataset_split,
        completeness_score,
        temporal_safety_score
      FROM predictions
      WHERE feature_snapshot IS NOT NULL
        ${sql.unsafe(conditions.map(c => c.text).join(' '))}
      ORDER BY created_at ASC
      LIMIT ${limit}
    `;

    await sql.end();

    // Transform for export (remove sensitive data)
    const exported = rows.map(row => ({
      id: row.id,
      home_team: row.home_team,
      away_team: row.away_team,
      league: row.league,
      odds: {
        home: row.odd_home,
        draw: row.odd_draw,
        away: row.odd_away,
      },
      probabilities: {
        home: row.prob_home,
        draw: row.prob_draw,
        away: row.prob_away,
      },
      prediction: row.prediction,
      confidence: row.confidence,
      actual_outcome: row.actual_outcome,
      timestamps: {
        prediction: row.t_prediction || row.created_at,
        feature: row.t_feature,
        snapshot: row.snapshot_timestamp,
      },
      versions: {
        model: row.model_version,
        feature: row.feature_version,
        config: row.config_version,
        calibration: row.calibration_version,
        dataset: row.dataset_version,
      },
      integrity: {
        snapshot_hash: row.feature_snapshot_hash,
        prediction_hash: row.prediction_hash,
      },
      provenance: row.provenance_status,
      dataset_split: row.dataset_split,
      completeness_score: row.completeness_score,
      temporal_safety_score: row.temporal_safety_score,
      // Feature snapshot summary (not full dump — too large for export)
      feature_summary: summarizeSnapshot(row.feature_snapshot),
    }));

    return res.status(200).json({
      success: true,
      dataset: {
        exported_count: exported.length,
        split_filter: split || 'ALL',
        provenance_filter: provenance || 'ALL',
        limit,
        purpose: 'AUDIT_AND_ANALYSIS_ONLY',
      },
      predictions: exported,
    });
  } catch (err) {
    console.error('[dataset-export] Error:', err.message);
    return res.status(500).json({ success: false, error: 'Export failed' });
  }
}

/**
 * Summarize a feature snapshot for export (not full dump).
 * Never includes raw AI prompts or internal data.
 */
function summarizeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;

  return {
    has_odds: !!snapshot.odds,
    has_form_home: !!(snapshot.form && snapshot.form.home),
    has_form_away: !!(snapshot.form && snapshot.form.away),
    has_h2h: !!snapshot.h2h,
    has_stats_home: !!(snapshot.stats && snapshot.stats.home),
    has_stats_away: !!(snapshot.stats && snapshot.stats.away),
    has_ai: !!snapshot.ai,
    has_anti_trap: !!snapshot.anti_trap,
    has_derived: !!snapshot.derived,
    has_coefficients: !!snapshot.coefficients,
    schema_version: snapshot.schema_version,
  };
}
