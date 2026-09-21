// Vercel Serverless Function — Snapshot Health Check
// Phase 5 — Section 14: Health Check endpoint

import { setCorsHeaders } from './_lib/cors.js';
import { requireAuth, requireUserAuth } from './_lib/auth.js';
import { createSql, NEON_DATABASE_URL } from './_lib/db.js';
import { successResponse, internalError, unauthorized } from './_lib/errors.js';

export default async function handler(req, res) {
  setCorsHeaders(req, res, 'GET, OPTIONS', 'Authorization, x-device-id');

  if (req.method === 'OPTIONS') {
    return res.status(204).end('');
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  // Require auth (admin or user)
  const userId = await requireUserAuth(req);
  const deviceId = userId ? null : await requireAuth(req);
  if (!userId && !deviceId) {
    return unauthorized(res);
  }

  if (!NEON_DATABASE_URL) {
    return internalError(res, null, 'Server not configured');
  }

  try {
    const sql = createSql();

    // Predictions last 24h
    const stats24h = await sql`
      SELECT
        COUNT(*) as total,
        COUNT(feature_snapshot) as with_snapshot,
        COUNT(*) FILTER (WHERE provenance_status = 'UNKNOWN') as unknown_count,
        COUNT(*) FILTER (WHERE provenance_status = 'UNSAFE') as unsafe_count,
        COUNT(*) FILTER (WHERE provenance_status IN ('VALID', 'PARTIALLY_VALID')) as valid_count
      FROM predictions
      WHERE created_at > NOW() - INTERVAL '24 hours'
    `;

    // Overall stats
    const overallStats = await sql`
      SELECT
        COUNT(*) as total,
        COUNT(feature_snapshot) as with_snapshot,
        COUNT(verified_at) as verified,
        COUNT(*) FILTER (WHERE provenance_status = 'UNKNOWN') as unknown_count,
        COUNT(*) FILTER (WHERE provenance_status = 'UNSAFE') as unsafe_count,
        COUNT(*) FILTER (WHERE provenance_status IN ('VALID', 'PARTIALLY_VALID', 'RECORDED', 'PARTIALLY_VALID')) as valid_count,
        COUNT(*) FILTER (WHERE provenance_status = 'RECONSTRUCTED') as reconstructed_count,
        COUNT(DISTINCT model_version) as model_versions,
        COUNT(DISTINCT feature_version) as feature_versions,
        COUNT(DISTINCT config_version) as config_versions
      FROM predictions
    `;

    // Immutability violations last 24h
    const violations = await sql`
      SELECT COUNT(*) as count
      FROM snapshot_immutability_violations
      WHERE detected_at > NOW() - INTERVAL '24 hours'
    `.catch(() => [{ count: 0 }]);

    // Hash mismatches last 24h
    const hashMismatches = await sql`
      SELECT COUNT(*) as count
      FROM snapshot_audit_log
      WHERE event_type = 'snapshot_hash_mismatch'
        AND created_at > NOW() - INTERVAL '24 hours'
    `.catch(() => [{ count: 0 }]);

    await sql.end();

    const s = stats24h[0];
    const o = overallStats[0];
    const total24h = Number(s.total) || 0;
    const snapshot24h = Number(s.with_snapshot) || 0;
    const totalAll = Number(o.total) || 0;

    // Compute health status
    let health = 'HEALTHY';
    if (Number(violations[0].count) > 0 || Number(hashMismatches[0].count) > 0) {
      health = 'UNHEALTHY';
    } else if (Number(s.unsafe_count) > 0 || (total24h > 0 && snapshot24h / total24h < 0.9)) {
      health = 'DEGRADED';
    }

    return res.status(200).json({
      success: true,
      health: {
        status: health,
        timestamp: new Date().toISOString(),
        last_24h: {
          predictions: total24h,
          snapshots: snapshot24h,
          snapshot_coverage_percent: total24h > 0 ? Math.round(snapshot24h / total24h * 10000) / 100 : 0,
          valid: Number(s.valid_count),
          unknown: Number(s.unknown_count),
          unsafe: Number(s.unsafe_count),
          immutability_violations: Number(violations[0].count),
          hash_mismatches: Number(hashMismatches[0].count),
        },
        overall: {
          total_predictions: totalAll,
          with_snapshot: Number(o.with_snapshot),
          verified: Number(o.verified),
          valid: Number(o.valid_count),
          reconstructed: Number(o.reconstructed_count),
          unknown: Number(o.unknown_count),
          unsafe: Number(o.unsafe_count),
          model_versions: Number(o.model_versions),
          feature_versions: Number(o.feature_versions),
          config_versions: Number(o.config_versions),
        },
      },
    });
  } catch (err) {
    console.error('[snapshot-health] Error:', err.message);
    return res.status(500).json({ success: false, error: 'Health check failed' });
  }
}
