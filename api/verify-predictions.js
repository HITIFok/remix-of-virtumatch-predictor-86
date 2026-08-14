// Vercel Serverless Function — verify-predictions v22 (ESM)
// Verifies pending predictions using /results API (source of truth)
//
// v22 — API-first by round:
//   1. Fetch /matches for each league → build set of ACTIVE match IDs
//   2. If prediction.match_id NOT in active set → match is finished
//   3. Fetch /results API for the league → find by round number + team names
//   4. DB (match_results) is ONLY used as fallback if API fails
//
// WHY: /results has OFFICIAL final scores. DB (playout) is for early alerts only.

import crypto from 'crypto';
import postgres from 'postgres';
import { setCorsHeaders } from './_lib/cors.js';

const API_BASE = 'https://hg-event-api-prod.sporty-tech.net/api/instantleagues';
const NEON_DATABASE_URL = process.env.NEON_DATABASE_URL;

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

// ─── Utilities ─────────────────────────────────────────────────────────────

function timingSafeEqual(a, b) {
  const encoder = new TextEncoder();
  const aBuf = Buffer.from(encoder.encode(a));
  const bBuf = Buffer.from(encoder.encode(b));
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
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

// ─── Main handler ──────────────────────────────────────────────────────────

export default async function handler(req, res) {
  setCorsHeaders(req, res, 'GET, POST, OPTIONS', 'Content-Type, Authorization, x-cron-key');

  if (req.method === 'OPTIONS') {
    return res.status(204).end('');
  }

  const startTime = Date.now();
  console.log('=== verify-predictions v22 (api-first-by-round) ===');

  try {
    if (!NEON_DATABASE_URL) {
      return res.status(500).json({ error: 'NEON_DATABASE_URL not configured' });
    }

    const sql = postgres(NEON_DATABASE_URL);

    // ── Mode detection: CRON vs CLIENT ──
    const cronKey = req.headers['x-cron-key'] || req.query.cron_key || '';
    const expectedCronKey = process.env.CRON_SECRET || '';
    const isCron = !!(cronKey && expectedCronKey && timingSafeEqual(cronKey, expectedCronKey));

    let deviceId;
    let callerMode;

    if (isCron) {
      callerMode = 'cron';
      console.log('[verify] Mode: CRON (full scan)');
    } else {
      callerMode = 'client';
      try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
        deviceId = body?.deviceId || body?.device_id;
      } catch { /* no body */ }

      if (!deviceId) {
        return res.status(400).json({
          success: false,
          error: 'device_id requis en mode client',
        });
      }

      if (!/^dev-[a-z0-9]+$/i.test(deviceId)) {
        return res.status(400).json({
          success: false,
          error: 'Format device_id invalide',
        });
      }

      console.log(`[verify] Mode: CLIENT (device: ${deviceId})`);
    }

    // ── 1. Fetch pending predictions ──
    let pendingPredictions;
    if (deviceId) {
      pendingPredictions = await sql`
        SELECT * FROM predictions
        WHERE status = 'pending' AND device_id = ${deviceId}
        ORDER BY created_at ASC LIMIT 200
      `;
    } else {
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
    console.error(`[verify] Error (${elapsed}ms):`, error);
    return res.status(500).json({ error: error.message, elapsed });
  }
}
