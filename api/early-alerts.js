// Vercel Serverless Function — early-alerts v1 (ESM)
// Returns active early result alerts detected by auto-playout v4
// These are results found BEFORE the match officially started
//
// GET /api/early-alerts → active alerts (not dismissed, recent)
// GET /api/early-alerts?all=true → all alerts including dismissed

import { createSql } from './_lib/db.js';
import { setCorsHeaders } from './_lib/cors.js';

export default async function handler(req, res) {
  setCorsHeaders(req, res, 'GET, OPTIONS', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end('');
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const showAll = req.query.all === 'true';
  const startTime = Date.now();

  try {
    const sql = createSql();

    let rows;
    if (showAll) {
      // All alerts (including dismissed)
      rows = await sql`
        SELECT league_id, league_name, round_number, match_id,
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
        SELECT league_id, league_name, round_number, match_id,
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
    return res.status(500).json({ error: error.message, alerts: [], count: 0 });
  }
}
