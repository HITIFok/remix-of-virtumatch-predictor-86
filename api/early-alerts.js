// Vercel Serverless Function — early-alerts v2 (ESM)
// Returns active early result alerts detected by auto-playout v4
// These are results found BEFORE the match officially started
//
// GET /api/early-alerts → active alerts (not dismissed, recent)
// GET /api/early-alerts?all=true → all alerts including dismissed

import { createSql } from './_lib/db.js';
import { setCorsHeaders } from './_lib/cors.js';

/**
 * Ensure early_alerts table exists (self-healing — no dependency on auto-playout).
 */
async function ensureAlertsTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS early_alerts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      league_id TEXT NOT NULL,
      league_name TEXT NOT NULL,
      round_number INTEGER NOT NULL,
      match_id INTEGER NOT NULL,
      home_team TEXT NOT NULL,
      away_team TEXT NOT NULL,
      score_home INTEGER NOT NULL DEFAULT 0,
      score_away INTEGER NOT NULL DEFAULT 0,
      outcome TEXT NOT NULL DEFAULT 'X',
      expected_start TIMESTAMPTZ,
      detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      how_early_seconds INTEGER NOT NULL DEFAULT 0,
      dismissed BOOLEAN NOT NULL DEFAULT FALSE,
      UNIQUE(league_id, round_number, match_id)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_early_alerts_active ON early_alerts(detected_at) WHERE dismissed = FALSE`;
}

export default async function handler(req, res) {
  setCorsHeaders(req, res, 'GET, OPTIONS', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end('');
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const showAll = req.query.all === 'true';

  // Security: ?all=true reveals full detection history — require admin token
  if (showAll) {
    const auth = req.headers['authorization'] || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token || !process.env.ADMIN_TOKEN_SECRET) {
      return res.status(403).json({ error: 'Admin authentication required for full history' });
    }
    // Verify HMAC token (same logic as admin-codes.js)
    const parts = token.split('.');
    if (parts.length !== 2) {
      return res.status(403).json({ error: 'Invalid token format' });
    }
    const [payload, signature] = parts;
    const { createHmac, timingSafeEqual } = await import('crypto');
    let timestamp;
    try {
      timestamp = parseInt(Buffer.from(payload, 'base64url').toString(), 10);
    } catch {
      return res.status(403).json({ error: 'Invalid token' });
    }
    if (isNaN(timestamp) || Date.now() - timestamp > 24 * 60 * 60 * 1000) {
      return res.status(403).json({ error: 'Token expired' });
    }
    const expected = createHmac('sha256', process.env.ADMIN_TOKEN_SECRET)
      .update(payload).digest('base64url');
    try {
      const sigBuf = Buffer.from(signature);
      const expBuf = Buffer.from(expected);
      if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
        return res.status(403).json({ error: 'Invalid token' });
      }
    } catch {
      return res.status(403).json({ error: 'Invalid token' });
    }
  }

  const startTime = Date.now();

  try {
    const sql = createSql();
    await ensureAlertsTable(sql);

    let rows;
    if (showAll) {
      // All alerts (including dismissed)
      rows = await sql`
        SELECT id, league_id, league_name, round_number, match_id,
               home_team, away_team, score_home, score_away, outcome,
               expected_start, detected_at, how_early_seconds, dismissed
        FROM early_alerts
        WHERE detected_at > NOW() - INTERVAL '1 hour'
        ORDER BY detected_at DESC
        LIMIT 50
      `;
    } else {
      // Only active (not dismissed) alerts
      rows = await sql`
        SELECT id, league_id, league_name, round_number, match_id,
               home_team, away_team, score_home, score_away, outcome,
               expected_start, detected_at, how_early_seconds, dismissed
        FROM early_alerts
        WHERE dismissed = FALSE AND detected_at > NOW() - INTERVAL '1 hour'
        ORDER BY how_early_seconds DESC, detected_at DESC
        LIMIT 50
      `;
    }

    await sql.end();

    const alerts = rows.map(row => ({
      id: row.id,
      leagueId: row.league_id,
      leagueName: row.league_name,
      roundNumber: row.round_number,
      matchId: row.match_id,
      homeTeam: row.home_team,
      awayTeam: row.away_team,
      scoreHome: row.score_home,
      scoreAway: row.score_away,
      outcome: row.outcome,
      expectedStart: row.expected_start,
      detectedAt: row.detected_at,
      howEarlySeconds: row.how_early_seconds,
      dismissed: row.dismissed,
    }));

    const elapsed = Date.now() - startTime;

    return res.status(200).json({
      success: true,
      alerts,
      count: alerts.length,
      elapsed,
    });
  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`[early-alerts] Error (${elapsed}ms):`, error);
    return res.status(500).json({ error: 'Internal server error', alerts: [], count: 0 });
  }
}
