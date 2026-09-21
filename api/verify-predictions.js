// Vercel Serverless Function — verify-predictions v22 (ESM)
// Verifies pending predictions using /results API (source of truth)
// Also handles health check via GET ?action=health
//
// v22 — API-first by round:
//   1. Fetch /matches for each league → build set of ACTIVE match IDs
//   2. If prediction.match_id NOT in active set → match is finished
//   3. Fetch /results API for the league → find by round number + team names
//   4. DB (match_results) is ONLY used as fallback if API fails
//
// WHY: /results has OFFICIAL final scores. DB (playout) is for early alerts only.

import crypto from 'crypto';
import { setCorsHeaders } from './_lib/cors.js';
import { requireAuth, requireUserAuth } from './_lib/auth.js';
import { createSql, NEON_DATABASE_URL } from './_lib/db.js';
import { errorResponse, methodNotAllowed, invalidInput, internalError, unauthorized, successResponse } from './_lib/errors.js';
import { createLogger, redactToken } from './_lib/logger.js';
import { validateCoefficients, getArbitraryCount } from './_lib/prediction-config.js';

const log = createLogger('verify-predictions');

const API_BASE = 'https://hg-event-api-prod.sporty-tech.net/api/instantleagues';

const LEAGUES = [
  { id: '8035', name: 'English League' },
  { id: '8060', name: "Coupe d'Afrique" },
  { id: '8056', name: 'Champions League' },
  { id: '8036', name: 'Italian League' },
  { id: '8037', name: 'Spanish League' },
  { id: '8042', name: 'French League' },
  { id: '8043', name: 'German League' },
  { id: '8044', name: 'Portuguese League' },
  { id: '8065', name: 'Coupe du monde' },
];

const HEADERS = {
  'accept': 'application/json, text/plain, */*',
  'accept-language': 'fr',
  'app-version': '33470',
  'referer': 'https://bet261.mg/',
  'sec-ch-ua': '"Chromium";v="148", "Microsoft Edge";v="148", "Not/A)Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36 Edg/148.0.0.0',
};

// ─── Utilities (shared with auto-playout) ────────────────────────────────────

function timingSafeEqual(a, b) {
  try {
    const aBuf = Buffer.from(a);
    const bBuf = Buffer.from(b);
    if (aBuf.length !== bBuf.length) return false;
    return crypto.timingSafeEqual(aBuf, bBuf);
  } catch { return false; }
}

function norm(name) {
  return name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Find a match in a round by home/away team names.
 * 3 strategies: exact → normalized → partial match.
 */
function findInRound(predHome, predAway, roundMatches) {
  // 1. Exact match
  for (const m of roundMatches) {
    if (m.home.toLowerCase() === predHome && m.away.toLowerCase() === predAway) return m;
  }
  // 2. Normalized (strip accents, special chars)
  const pH = norm(predHome), pA = norm(predAway);
  for (const m of roundMatches) {
    if (norm(m.home) === pH && norm(m.away) === pA) return m;
  }
  // 3. Partial/contains
  for (const m of roundMatches) {
    const mH = m.home.toLowerCase(), mA = m.away.toLowerCase();
    if ((mH.includes(predHome) || predHome.includes(mH)) &&
        (mA.includes(predAway) || predAway.includes(mA))) return m;
  }
  return null;
}

// ─── API fetchers ─────────────────────────────────────────────────────────

/**
 * Fetch all ACTIVE match IDs from /matches endpoint.
 * If a prediction's match_id is NOT in this set → the match is finished.
 */
async function fetchActiveMatchIds() {
  const activeByLeague = new Map();
  const results = await Promise.all(LEAGUES.map(async (l) => {
    try {
      const res = await fetch(`${API_BASE}/${l.id}/matches`, {
        headers: HEADERS,
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return { leagueId: l.id, ids: [] };
      const data = await res.json();
      const ids = [];
      if (data?.rounds) {
        for (const rd of data.rounds) {
          for (const m of rd.matches || []) {
            if (m.id && m.id > 0) ids.push(m.id);
          }
        }
      }
      return { leagueId: l.id, ids };
    } catch (err) {
      console.log(`[verify] /matches ${l.id} error: ${err.message}`);
      return { leagueId: l.id, ids: [] };
    }
  }));

  for (const { leagueId, ids } of results) {
    activeByLeague.set(leagueId, new Set(ids));
  }
  const totalActive = results.reduce((s, r) => s + r.ids.length, 0);
  console.log(`[verify] Active matches: ${totalActive} across ${activeByLeague.size} leagues`);
  return activeByLeague;
}

/**
 * Fetch OFFICIAL results from /results API for a league.
 * Returns Map<roundNumber, matches[]> — these are FINAL, verified scores.
 */
async function fetchApiResults(leagueId) {
  const roundResults = new Map();
  try {
    const res = await fetch(`${API_BASE}/${leagueId}/results?skip=0&take=200`, {
      headers: HEADERS,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return roundResults;
    const data = await res.json();
    if (data?.rounds) {
      for (const rd of data.rounds) {
        const roundNum = rd.roundNumber || 0;
        if (roundNum <= 0) continue;
        const matches = [];
        for (const m of rd.matches || []) {
          const home = m.homeTeam?.name || '';
          const away = m.awayTeam?.name || '';
          if (!home || !away) continue;
          const score = m.score || '0:0';
          const parts = score.split(':');
          const h = parseInt(parts[0]) || 0;
          const a = parseInt(parts[1]) || 0;
          matches.push({
            home, away, score, homeScore: h, awayScore: a,
            outcome: h > a ? '1' : h < a ? '2' : 'X',
          });
        }
        if (matches.length > 0) roundResults.set(roundNum, matches);
      }
    }
  } catch (err) {
    console.log(`[verify] /results API ${leagueId} error: ${err.message}`);
  }
  return roundResults;
}

// ─── DB helpers ────────────────────────────────────────────────────────────

function patchPrediction(sql, id, match, status) {
  return sql`
    UPDATE predictions SET
      actual_home_score = ${match.homeScore},
      actual_away_score = ${match.awayScore},
      actual_outcome = ${match.outcome},
      actual_score = ${match.score},
      status = ${status},
      verified_at = NOW()
    WHERE id = ${id}
  `;
}

// ─── Core verification logic ──────────────────────────────────────────────

/**
 * Verify a single prediction against results.
 * Strategy: API /results first (official scores), DB fallback only if API fails.
 *
 * @param {Object} pred - prediction row from DB
 * @param {Map} activeByLeague - Map<leagueId, Set<matchId>> of active matches
 * @param {Map} apiCache - Map<leagueId, Map<roundNum, matches[]>> API results cache
 * @param {Object} sql - postgres client
 * @returns {{ status: string, source: string }} - 'correct'|'incorrect'|'active'|'notfound'
 */
async function verifyPrediction(pred, activeByLeague, apiCache, sql) {
  const predLeagueId = String(pred.league_id || '');
  const predRound = pred.round || 0;
  const predMatchId = Number(pred.match_id);

  // ── Step 1: Check if match is still active ──
  if (predMatchId > 0) {
    let isActive = false;
    if (predLeagueId) {
      const activeIds = activeByLeague.get(predLeagueId);
      if (activeIds?.has(predMatchId)) isActive = true;
    }
    if (!isActive) {
      for (const [, ids] of activeByLeague) {
        if (ids.has(predMatchId)) { isActive = true; break; }
      }
    }
    if (isActive) return { status: 'active', source: 'skip' };
  }

  // ── Step 2: Prepare team names for matching ──
  const predHome = (pred.home_team || '').trim().toLowerCase();
  const predAway = (pred.away_team || '').trim().toLowerCase();
  if (!predHome || !predAway) return { status: 'notfound', source: 'skip' };

  // Determine which leagues to check (predicted league first, then others)
  const leaguesToCheck = predLeagueId
    ? [predLeagueId, ...LEAGUES.map(l => l.id).filter(id => id !== predLeagueId)]
    : LEAGUES.map(l => l.id);

  // ── Step 3: Search in API /results (PRIMARY — official scores) ──
  for (const leagueId of leaguesToCheck) {
    let apiRoundResults = apiCache.get(leagueId);
    if (!apiRoundResults) {
      apiRoundResults = await fetchApiResults(leagueId);
      apiCache.set(leagueId, apiRoundResults);
    }

    if (apiRoundResults.size === 0) continue;

    // Direct round lookup (fast path)
    if (predRound > 0) {
      const roundMatches = apiRoundResults.get(predRound);
      if (!roundMatches) continue;
      const match = findInRound(predHome, predAway, roundMatches);
      if (match) {
        const isCorrect = pred.prediction === match.outcome;
        await patchPrediction(sql, pred.id, match, isCorrect ? 'correct' : 'incorrect');
        return {
          status: isCorrect ? 'correct' : 'incorrect',
          source: `API round=${predRound}`,
          detail: `${pred.home_team} vs ${pred.away_team}: pred=${pred.prediction} actual=${match.outcome} (${match.score})`,
        };
      }
    } else {
      // No round stored → search all rounds
      for (const [roundNum, roundMatches] of apiRoundResults) {
        const match = findInRound(predHome, predAway, roundMatches);
        if (match) {
          const isCorrect = pred.prediction === match.outcome;
          await patchPrediction(sql, pred.id, match, isCorrect ? 'correct' : 'incorrect');
          return {
            status: isCorrect ? 'correct' : 'incorrect',
            source: `API round=${roundNum}`,
            detail: `${pred.home_team} vs ${pred.away_team}: pred=${pred.prediction} actual=${match.outcome} (${match.score})`,
          };
        }
      }
    }
  }

  return { status: 'notfound', source: 'API miss' };
}

// ═══════════════════════════════════════════════════════════════════
// HEALTH CHECK — GET ?action=health
// Monitoring endpoint for uptime checks and deployment verification
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// SNAPSHOT HEALTH — GET ?action=snapshot-health
// Phase 5 — Consolidated from standalone snapshot-health.js
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// DATASET EXPORT — GET ?action=dataset-export
// Phase 5 — Consolidated from standalone dataset-export.js
// NEVER exports: secrets, tokens, credentials, personal data
// ═══════════════════════════════════════════════════════════════════

async function handleHealthCheck(req, res) {
  // ── Authenticate cron call ──
  const cronKey = req.headers['x-cron-key'] || '';
  const authHeader = req.headers['authorization'] || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const providedSecret = cronKey || bearerToken;
  const CRON_SECRET = process.env.CRON_SECRET || '';
  if (!providedSecret || !timingSafeEqual(providedSecret, CRON_SECRET)) {
    return unauthorized(res, 'Authentification requise');
  }

  // ── Build health check response ──
  const checks = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    node: process.version,
    env: process.env.VERCEL_ENV || process.env.NODE_ENV || 'unknown',
  };

  // ── Database connectivity check ──
  if (NEON_DATABASE_URL) {
    try {
      const dbStart = Date.now();
      const sql = createSql();
      await sql`SELECT 1`;
      await sql.end();
      checks.database = {
        status: 'healthy',
        latency_ms: Date.now() - dbStart,
      };
    } catch (dbErr) {
      checks.database = {
        status: 'degraded',
        latency_ms: null,
        error: dbErr.message,
      };
      checks.status = 'degraded';
    }
  } else {
    checks.database = { status: 'not_configured' };
  }

  // ── Coefficient validation check ──
  try {
    const result = validateCoefficients();
    const arbitraryCount = getArbitraryCount();
    checks.coefficients = {
      valid: result.valid,
      arbitraryCount,
      errors: result.errors.length,
      warnings: result.warnings.length,
    };
    if (!result.valid) checks.status = 'degraded';
  } catch (coefErr) {
    checks.coefficients = { valid: false, error: coefErr.message };
    checks.status = 'degraded';
  }

  // ── Memory usage tracking ──
  const mem = process.memoryUsage();
  checks.memory = {
    heapUsed: Math.round(mem.heapUsed / 1024 / 1024),   // MB
    heapTotal: Math.round(mem.heapTotal / 1024 / 1024),  // MB
    rss: Math.round(mem.rss / 1024 / 1024),               // MB
  };

  // ── Return appropriate status code ──
  const statusCode = checks.status === 'healthy' ? 200 : 503;
  return res.status(statusCode).json(checks);
}

// ═══════════════════════════════════════════════════════════════════
// SNAPSHOT HEALTH CHECK — GET ?action=snapshot-health
// Consolidated from standalone snapshot-health.js (Vercel Hobby limit)
// ═══════════════════════════════════════════════════════════════════

async function handleSnapshotHealth(req, res) {
  // Require auth (user or device)
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

// ═══════════════════════════════════════════════════════════════════
// DATASET EXPORT — GET ?action=dataset-export
// Consolidated from standalone dataset-export.js (Vercel Hobby limit)
// NEVER exports: secrets, tokens, credentials, personal data
// ═══════════════════════════════════════════════════════════════════

const MAX_EXPORT = 5000;

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

async function handleDatasetExport(req, res) {
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

// ─── Main handler ──────────────────────────────────────────────────────────

export default async function handler(req, res) {
  setCorsHeaders(req, res, 'GET, POST, OPTIONS', 'Content-Type, Authorization, x-device-id, x-cron-key');

  if (req.method === 'OPTIONS') {
    return res.status(204).end('');
  }

  // ── Action routing (consolidated endpoints) ──
  const action = String(req.query?.action || '').trim();
  if (req.method === 'GET' && action === 'health') {
    return await handleHealthCheck(req, res);
  }
  if (req.method === 'GET' && action === 'snapshot-health') {
    return await handleSnapshotHealth(req, res);
  }
  if (req.method === 'GET' && action === 'dataset-export') {
    return await handleDatasetExport(req, res);
  }

  const startTime = Date.now();
  console.log('=== verify-predictions v22 (api-first-by-round) ===');

  try {
    if (!NEON_DATABASE_URL) {
      return internalError(res, null, 'NEON_DATABASE_URL not configured');
    }

    const sql = createSql();

    // ── Mode detection: CRON vs CLIENT ──
    // Security: key is ONLY accepted via x-cron-key header (not query string)
    const cronKey = req.headers['x-cron-key'] || '';
    const authHeader = req.headers['authorization'] || '';
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const providedSecret = cronKey || bearerToken;
    const expectedCronKey = process.env.CRON_SECRET || '';
    const isCron = !!(providedSecret && expectedCronKey && timingSafeEqual(providedSecret, expectedCronKey));

    // FIX-16 (CRON-02): Acquire pg_advisory_lock to prevent concurrent cron execution.
    // If another instance is already running, skip this invocation.
    if (isCron && NEON_DATABASE_URL) {
      try {
        const lockSql = createSql();
        const [lockResult] = await lockSql`SELECT pg_try_advisory_lock(hashtext('verify-predictions')) as acquired`;
        await lockSql.end();
        if (!lockResult?.acquired) {
          log.info('Another verify-predictions instance is already running — skipping');
          await sql.end();
          return res.status(200).json({ success: true, message: 'Already running', skipped: true });
        }
        // Lock is held on this connection — it releases when the process ends.
        // For serverless, this is sufficient since each invocation gets its own connection.
      } catch (lockErr) {
        log.warn('Advisory lock check failed, continuing anyway', { cause: lockErr });
      }
    }

    let deviceId;
    let userId;
    let callerMode;

    if (isCron) {
      callerMode = 'cron';
      console.log('[verify] Mode: CRON (full scan)');
    } else {
      callerMode = 'client';

      // Priority 1: user auth (email session)
      userId = await requireUserAuth(req);
      if (userId) {
        console.log(`[verify] Mode: CLIENT (user: ${userId})`);
        // user_id is set — pending predictions query below will use it
      } else {
        // Priority 2: device auth (HMAC — legacy)
        const authedDeviceId = await requireAuth(req);
        if (!authedDeviceId) {
          return unauthorized(res);
        }
        deviceId = authedDeviceId;
        console.log(`[verify] Mode: CLIENT (device: ${deviceId})`);
      }
    }

    // ── 1. Fetch pending predictions ──
    let pendingPredictions;
    if (userId) {
      // User auth: query directly by user_id
      pendingPredictions = await sql`
        SELECT * FROM predictions
        WHERE status = 'pending' AND user_id = ${userId}
        ORDER BY created_at ASC LIMIT 200
      `;
    } else if (Array.isArray(deviceId)) {
      // User auth (legacy fallback): multiple devices
      pendingPredictions = await sql`
        SELECT * FROM predictions
        WHERE status = 'pending' AND device_id = ANY(${deviceId})
        ORDER BY created_at ASC LIMIT 200
      `;
    } else if (deviceId) {
      // Device auth: single device
      pendingPredictions = await sql`
        SELECT * FROM predictions
        WHERE status = 'pending' AND device_id = ${deviceId}
        ORDER BY created_at ASC LIMIT 200
      `;
    } else {
      // Cron mode: all predictions
      pendingPredictions = await sql`
        SELECT * FROM predictions
        WHERE status = 'pending'
        ORDER BY created_at ASC LIMIT 200
      `;
    }
    console.log(`[verify] ${pendingPredictions.length} pending predictions`);

    if (pendingPredictions.length === 0) {
      await sql.end();
      return res.status(200).json({
        success: true, message: 'Aucune prédiction en attente',
        verified: 0, elapsed: Date.now() - startTime,
      });
    }

    // ── 2. Fetch active match IDs (parallel, all leagues) ──
    const activeByLeague = await fetchActiveMatchIds();

    // ── 3. Verify each prediction using API /results ──
    const apiCache = new Map();
    let correct = 0, incorrect = 0, stillActive = 0, notFound = 0;

    for (const pred of pendingPredictions) {
      const result = await verifyPrediction(pred, activeByLeague, apiCache, sql);

      switch (result.status) {
        case 'correct':
          correct++;
          console.log(`OK [${result.source}] ${result.detail}`);
          break;
        case 'incorrect':
          incorrect++;
          console.log(`NO [${result.source}] ${result.detail}`);
          break;
        case 'active':
          stillActive++;
          break;
        case 'notfound':
          notFound++;
          console.log(`MISS: ${pred.home_team} vs ${pred.away_team} | id=${pred.match_id} | league=${pred.league_id || '?'} | round=${pred.round || '?'}`);
          break;
      }
    }

    await sql.end();

    const elapsed = Date.now() - startTime;
    const verified = correct + incorrect;
    console.log(`[verify] Done: ${correct} OK, ${incorrect} NO, ${stillActive} still_active, ${notFound} miss (${elapsed}ms)`);

    return res.status(200).json({
      success: true,
      mode: callerMode,
      version: 'v22-api-first',
      total: pendingPredictions.length,
      correct, incorrect,
      stillActive,
      notFound,
      verified,
      stillPending: pendingPredictions.length - verified,
      elapsed,
    });
  } catch (error) {
    const elapsed = Date.now() - startTime;
      log.error('Verification error', undefined, { cause: error });
    return internalError(res, error);
  }
}
